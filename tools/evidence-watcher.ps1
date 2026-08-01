<#
  evidence-watcher.ps1
  ----------------------------------------------------------------------------
  RIBRE証憑ウォッチャー（常駐監視・タスクスケジューラ実行用）

  ブラウザを閉じていても、指定フォルダに置かれた証憑（領収書・請求書）の
  PDF/PNG/JPEGを検出し、既存の /api/mf/ingest-mail エンドポイントへ
  tools/gmail-ingest.gs と同じペイロード仕様でアップロードするスクリプト。

  サーバー側（api/mf/ingest-mail.js）はOCR→Storage控え保存→台帳記録まで
  行うが、状態は必ず status='pending'（承認待ち）。このスクリプトが
  MFクラウドBoxへ直接送信することは絶対に無い（承認制はサーバー側の実装で
  担保されており、このスクリプトはそれを変えない）。

  設定ファイル: %APPDATA%\ribre-evidence-watcher\config.json
  状態ファイル: %APPDATA%\ribre-evidence-watcher\sent.json （送信済みハッシュ台帳）
  ログファイル: %APPDATA%\ribre-evidence-watcher\watcher.log

  Windows PowerShell 5.1 専用（&&/||・三項演算子等のPS7構文は使用しない）。
  このファイル自体はUTF-8(BOM付き)で保存すること（5.1はBOM無しUTF-8スクリプトの
  日本語コメント/文字列を正しく解釈できないことがあるため）。
#>

[CmdletBinding()]
param()

# ---------------------------------------------------------------------------
# 定数・基本設定
# ---------------------------------------------------------------------------

# TLS1.2を明示（Windows PowerShell 5.1は既定でTLS1.0/1.1になっている環境があり、
# 本番のVercel/HTTPSエンドポイントへの接続に失敗することがあるため）
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # 古い.NET Frameworkで列挙値が無い場合などは無視して続行（HTTPのモック環境等）
}

$BaseDir    = Join-Path $env:APPDATA 'ribre-evidence-watcher'
$ConfigPath = Join-Path $BaseDir 'config.json'
$StatePath  = Join-Path $BaseDir 'sent.json'
$LogPath    = Join-Path $BaseDir 'watcher.log'
$LogPathOld = Join-Path $BaseDir 'watcher.log.1'

$AllowedExtensions = @('.pdf', '.png', '.jpg', '.jpeg')
$MaxFileBytes       = 3MB          # 3MB超はスキップ（Vercelのボディ上限対策。gmail-ingest.gsと同じ方針）
$MaxLogBytes        = 1MB          # ログローテーションのしきい値
$MaxStateEntries    = 1000         # 状態ファイルの上限件数（古いものから削除）
$MaxFileNameLength  = 255          # サーバー側 MAX_FILE_NAME_LENGTH と同じ

if (-not (Test-Path -LiteralPath $BaseDir)) {
  New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# ログ
# ---------------------------------------------------------------------------

function Rotate-LogIfNeeded {
  if (Test-Path -LiteralPath $LogPath) {
    $item = Get-Item -LiteralPath $LogPath
    if ($item.Length -gt $MaxLogBytes) {
      Move-Item -LiteralPath $LogPath -Destination $LogPathOld -Force
    }
  }
}

function Write-WatcherLog {
  param(
    [string]$FileName,
    [string]$Result,
    [string]$Detail = ''
  )
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "{0}`t{1}`t{2}`t{3}" -f $ts, $FileName, $Result, $Detail
  try {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  } catch {
    # ログ書き込み失敗は致命的にしない（他ファイルの処理は継続する）
  }
}

Rotate-LogIfNeeded

# ---------------------------------------------------------------------------
# 設定読み込み
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Write-Host '========================================================'
  Write-Host '証憑ウォッチャーの設定ファイルが見つかりません。'
  Write-Host ('  想定パス: {0}' -f $ConfigPath)
  Write-Host ''
  Write-Host 'tools\evidence-watcher-install.ps1 を実行して初期設定を行ってください。'
  Write-Host '（右クリック→PowerShellで実行、またはコマンドラインから'
  Write-Host ' powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\evidence-watcher-install.ps1 ）'
  Write-Host ''
  Write-Host '設定ファイルは次の形式のJSONです（installスクリプトが自動生成します）:'
  Write-Host '  {'
  Write-Host '    "ingestUrl": "https://ribre-sales-system.vercel.app/api/mf/ingest-mail",'
  Write-Host '    "ingestSecret": "（VercelのMAIL_INGEST_SECRETと同じ値）",'
  Write-Host '    "watchDir": "（監視するフォルダの絶対パス）",'
  Write-Host '    "maxAgeDays": 14'
  Write-Host '  }'
  Write-Host '========================================================'
  Write-WatcherLog -FileName '(config)' -Result 'error' -Detail 'config.json が見つかりません'
  exit 1
}

try {
  $configRaw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
  $config = $configRaw | ConvertFrom-Json
} catch {
  Write-Host ('設定ファイルの読み込みに失敗しました（JSONとして不正です）: {0}' -f $ConfigPath)
  Write-WatcherLog -FileName '(config)' -Result 'error' -Detail ('config.json 読み込み失敗: ' + $_.Exception.Message)
  exit 1
}

$IngestUrl    = $config.ingestUrl
$IngestSecret = $config.ingestSecret
$WatchDir     = $config.watchDir
$MaxAgeDays   = 14
if ($config.PSObject.Properties.Name -contains 'maxAgeDays' -and $config.maxAgeDays) {
  $MaxAgeDays = [int]$config.maxAgeDays
}

if (-not $IngestUrl -or -not $IngestSecret -or -not $WatchDir) {
  Write-Host '設定ファイルに ingestUrl / ingestSecret / watchDir のいずれかが不足しています。'
  Write-Host 'tools\evidence-watcher-install.ps1 を再実行して設定し直してください。'
  Write-WatcherLog -FileName '(config)' -Result 'error' -Detail 'ingestUrl/ingestSecret/watchDir のいずれかが未設定'
  exit 1
}

if (-not (Test-Path -LiteralPath $WatchDir)) {
  Write-Host ('監視フォルダが見つかりません: {0}' -f $WatchDir)
  Write-WatcherLog -FileName '(config)' -Result 'error' -Detail ('watchDir が存在しない: ' + $WatchDir)
  exit 1
}

# ---------------------------------------------------------------------------
# 状態ファイル（送信済みハッシュ台帳）
# ---------------------------------------------------------------------------

function Load-State {
  $result = @{}
  if (Test-Path -LiteralPath $StatePath) {
    try {
      $raw = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8
      if ($raw -and $raw.Trim()) {
        $obj = $raw | ConvertFrom-Json
        foreach ($prop in $obj.PSObject.Properties) {
          $result[$prop.Name] = @{
            name   = $prop.Value.name
            at     = $prop.Value.at
            result = $prop.Value.result
          }
        }
      }
    } catch {
      # 状態ファイルが壊れていても致命的にしない。サーバー側もcontent_hashで
      # 重複排除するため、状態を失っても再送は安全（duplicate:trueが返るだけ）。
      Write-WatcherLog -FileName '(state)' -Result 'warn' -Detail ('sent.json 読み込み失敗のため空扱いで続行: ' + $_.Exception.Message)
    }
  }
  return $result
}

function Save-State {
  param([hashtable]$State)

  # 件数上限（古いものから削除）
  if ($State.Count -gt $MaxStateEntries) {
    $sorted = $State.GetEnumerator() | Sort-Object { [datetime]$_.Value.at }
    $dropCount = $State.Count - $MaxStateEntries
    $toDrop = $sorted | Select-Object -First $dropCount
    foreach ($entry in $toDrop) {
      $State.Remove($entry.Key)
    }
  }

  # ConvertTo-Jsonへ渡すため、通常のオブジェクト(ハッシュテーブルのハッシュテーブル)として整形
  $ordered = [ordered]@{}
  foreach ($key in $State.Keys) {
    $ordered[$key] = $State[$key]
  }
  $json = $ordered | ConvertTo-Json -Depth 5
  if ($State.Count -eq 0) {
    $json = '{}'
  }
  try {
    # PowerShell 5.1のSet-Content -Encoding utf8はBOM付きUTF-8で書き込む
    Set-Content -LiteralPath $StatePath -Value $json -Encoding utf8
  } catch {
    Write-WatcherLog -FileName '(state)' -Result 'warn' -Detail ('sent.json 書き込み失敗: ' + $_.Exception.Message)
  }
}

$State = Load-State

# ---------------------------------------------------------------------------
# アップロード処理
# ---------------------------------------------------------------------------

function Get-ContentTypeForExtension {
  param([string]$Extension)
  switch ($Extension.ToLowerInvariant()) {
    '.pdf'  { return 'application/pdf' }
    '.png'  { return 'image/png' }
    '.jpg'  { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    default { return $null }
  }
}

# HTTPエラー応答（4xx/5xx）からステータスコードと本文を取り出す。
# Windows PowerShell 5.1のInvoke-RestMethodは非2xxで System.Net.WebException を
# 投げ、レスポンス本文は例外オブジェクトから手動で読み取る必要がある。
function Get-HttpErrorInfo {
  param($ErrorRecord)
  $info = @{ StatusCode = 0; Body = '' }
  try {
    $response = $ErrorRecord.Exception.Response
    if ($response) {
      $info.StatusCode = [int]$response.StatusCode
      $stream = $response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $info.Body = $reader.ReadToEnd()
        $reader.Close()
      }
    }
  } catch {
    # 読み取り不能なら空のまま返す
  }
  return $info
}

# 1ファイルを /api/mf/ingest-mail へ送信する。
# 戻り値: @{ Outcome = 'sent'|'duplicate'|'failed_4xx'|'retry'; Detail = string }
#   - sent / duplicate       … 状態ファイルに「送信済み」として記録してよい
#   - failed_4xx             … サーバーが恒久的な拒否（400等）。記録して二度と送らない
#   - retry                  … 一時的な失敗（5xx・通信エラー等）。記録しない＝次回再送
function Send-EvidenceFile {
  param(
    [string]$FilePath,
    [string]$FileName,
    [string]$ContentType,
    [byte[]]$Bytes
  )

  $base64 = [Convert]::ToBase64String($Bytes)

  # from/subject はメール取込(tools/gmail-ingest.gs)の項目を流用したUI表示欄。
  # フォルダ監視にはメール送信者/件名が無いため、由来が分かる文字列を入れておく。
  $payload = [ordered]@{
    file_name    = $FileName
    content_type = $ContentType
    file_data    = $base64
    from         = ('folder-watcher@{0}' -f $env:COMPUTERNAME)
    subject      = ('フォルダ監視取込: {0}' -f $FileName)
  }

  # PowerShell 5.1のInvoke-RestMethodに文字列でJSONを渡すと、既定のエンコード
  # （システムのANSIコードページ等）でボディが再エンコードされ、日本語ファイル名が
  # 文字化けすることがある。ConvertTo-Json→UTF-8バイト列に自前で変換してから
  # -Body にbyte[]として渡すことでこれを回避する。
  $json = $payload | ConvertTo-Json -Compress
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)

  $headers = @{ 'x-ingest-secret' = $IngestSecret }

  try {
    $resp = Invoke-RestMethod -Uri $IngestUrl -Method Post -Headers $headers `
      -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -TimeoutSec 120

    if ($resp -and $resp.duplicate -eq $true) {
      return @{ Outcome = 'duplicate'; Detail = 'サーバーが重複と判定(duplicate:true)' }
    }
    if ($resp -and $resp.ok -eq $true) {
      return @{ Outcome = 'sent'; Detail = ('evidence_id=' + $resp.evidence_id) }
    }
    # ok:trueでもduplicate/pendingが無い想定外の応答。念のため成功扱いにはせず再試行。
    return @{ Outcome = 'retry'; Detail = ('想定外の応答: ' + ($resp | ConvertTo-Json -Compress)) }
  } catch {
    $info = Get-HttpErrorInfo -ErrorRecord $_
    $status = $info.StatusCode
    $detail = ('HTTP {0}: {1}' -f $status, $info.Body)

    if ($status -ge 400 -and $status -lt 500) {
      # 400系はファイル内容そのものが原因（不正なJSON/未対応の拡張子/ファイル名不正/
      # ペイロード超過等）で、再送しても同じ結果になる。gmail-ingest.gsの3MBスキップと
      # 同じ考え方で、二度と再試行しないよう「送信済み」扱いにして状態に記録する。
      return @{ Outcome = 'failed_4xx'; Detail = $detail }
    }
    # 401（シークレット不一致等・設定不備の可能性）、5xx、タイムアウト、
    # 名前解決失敗などの一時的/構成上の失敗。ファイルの状態には記録せず、
    # 次回の実行で自動的に再試行する。
    return @{ Outcome = 'retry'; Detail = $detail }
  }
}

# ---------------------------------------------------------------------------
# メイン処理: 監視フォルダのスキャン
# ---------------------------------------------------------------------------

$cutoff = (Get-Date).AddDays(-1 * $MaxAgeDays)

$candidates = @()
try {
  $candidates = Get-ChildItem -LiteralPath $WatchDir -File -ErrorAction Stop |
    Where-Object { $AllowedExtensions -contains $_.Extension.ToLowerInvariant() -and $_.LastWriteTime -ge $cutoff }
} catch {
  Write-Host ('監視フォルダの読み取りに失敗しました: {0}' -f $_.Exception.Message)
  Write-WatcherLog -FileName '(scan)' -Result 'error' -Detail ('フォルダ読み取り失敗: ' + $_.Exception.Message)
  exit 1
}

$stateDirty = $false

foreach ($file in $candidates) {
  $fileName = $file.Name

  # ファイル名の長さチェック（サーバー側 MAX_FILE_NAME_LENGTH と同じ基準で事前判定。
  # 超過は通信せずに恒久失敗として扱う＝毎回リトライしない）
  if ($fileName.Length -gt $MaxFileNameLength) {
    Write-WatcherLog -FileName $fileName -Result 'skip_invalid_name' -Detail ('ファイル名が長すぎます(' + $fileName.Length + '文字)')
    continue
  }

  $contentType = Get-ContentTypeForExtension -Extension $file.Extension
  if (-not $contentType) {
    continue
  }

  # 書き込み中のファイル（コピー中等）を誤って送らないよう、読み取り失敗は
  # 「まだロックされている」とみなしてこの回はスキップし、次回リトライする。
  $bytes = $null
  try {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  } catch {
    Write-WatcherLog -FileName $fileName -Result 'skip_locked' -Detail ('読み取り失敗（次回リトライ）: ' + $_.Exception.Message)
    continue
  }

  if (-not $bytes -or $bytes.Length -eq 0) {
    Write-WatcherLog -FileName $fileName -Result 'skip_empty' -Detail '空ファイルのためスキップ（次回リトライ）'
    continue
  }

  # SHA-256でコンテンツハッシュを計算（状態ファイルのキー）。
  # サーバー側も content_hash で重複排除するため、この状態ファイルを失っても
  # 再送は安全（duplicate:trueが返って状態が復元されるだけ）。
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hashBytes = $sha256.ComputeHash($bytes)
  $sha256.Dispose()
  $hashHex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })

  if ($State.ContainsKey($hashHex)) {
    # 送信済み・恒久失敗・サイズ超過スキップ済みのいずれか。何もしない。
    continue
  }

  if ($bytes.Length -gt $MaxFileBytes) {
    Write-WatcherLog -FileName $fileName -Result 'skip_oversize' -Detail ('{0} bytes > 上限{1} bytes（3MB超はVercelのボディ上限のため送信不可。mf-evidence.htmlから手動登録してください）' -f $bytes.Length, [int]$MaxFileBytes)
    $State[$hashHex] = @{ name = $fileName; at = (Get-Date).ToString('o'); result = 'skipped_oversize' }
    $stateDirty = $true
    continue
  }

  $result = Send-EvidenceFile -FilePath $file.FullName -FileName $fileName -ContentType $contentType -Bytes $bytes

  switch ($result.Outcome) {
    'sent' {
      Write-WatcherLog -FileName $fileName -Result 'sent' -Detail $result.Detail
      $State[$hashHex] = @{ name = $fileName; at = (Get-Date).ToString('o'); result = 'sent' }
      $stateDirty = $true
    }
    'duplicate' {
      Write-WatcherLog -FileName $fileName -Result 'duplicate' -Detail $result.Detail
      $State[$hashHex] = @{ name = $fileName; at = (Get-Date).ToString('o'); result = 'duplicate' }
      $stateDirty = $true
    }
    'failed_4xx' {
      Write-WatcherLog -FileName $fileName -Result 'failed' -Detail $result.Detail
      $State[$hashHex] = @{ name = $fileName; at = (Get-Date).ToString('o'); result = 'failed_4xx' }
      $stateDirty = $true
    }
    default {
      # retry: 状態に記録しない＝次回の実行で自動的に再送される
      Write-WatcherLog -FileName $fileName -Result 'retry_later' -Detail $result.Detail
    }
  }
}

if ($stateDirty) {
  Save-State -State $State
}

exit 0
