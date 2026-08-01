<#
  evidence-watcher-install.ps1
  ----------------------------------------------------------------------------
  RIBRE証憑ウォッチャー 初期設定スクリプト（対話式・Windows PowerShell 5.1専用）

  やること:
    1. 監視フォルダ・取込先URL・シークレットを対話入力し、
       %APPDATA%\ribre-evidence-watcher\config.json を書き出す
    2. タスクスケジューラに「RIBRE証憑ウォッチャー」タスクを登録する
       （30分おき、現在ログオン中のユーザーとしてのみ実行＝PCが起動して
       ログインしている間だけ動く。これは仕様として問題ない）

  再実行しても安全（既存タスクは一度解除してから登録し直す）。

  停止したいとき:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File evidence-watcher-install.ps1 -Uninstall
    （config.json / sent.json / watcher.log は削除されない）
#>

[CmdletBinding()]
param(
  [switch]$Uninstall
)

$TaskName = 'RIBRE証憑ウォッチャー'
$BaseDir  = Join-Path $env:APPDATA 'ribre-evidence-watcher'
$ConfigPath = Join-Path $BaseDir 'config.json'

# このスクリプト自身の場所から evidence-watcher.ps1 の絶対パスを組み立てる
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$WatcherPs1 = Join-Path $ScriptDir 'evidence-watcher.ps1'

function Remove-ExistingTask {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    return $true
  }
  return $false
}

# ---------------------------------------------------------------------------
# -Uninstall: タスクだけ削除して終了（config/stateは残す）
# ---------------------------------------------------------------------------
if ($Uninstall) {
  Write-Host ('タスクスケジューラから「{0}」を削除します...' -f $TaskName)
  $removed = Remove-ExistingTask
  if ($removed) {
    Write-Host '削除しました。証憑ウォッチャーは今後自動実行されません。'
  } else {
    Write-Host 'タスクは登録されていませんでした（既に停止済みです）。'
  }
  Write-Host ('設定ファイル/状態ファイル/ログは残しています: {0}' -f $BaseDir)
  Write-Host '再度有効化したいときは、このスクリプトを -Uninstall なしで再実行してください。'
  exit 0
}

# ---------------------------------------------------------------------------
# 前提チェック
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $WatcherPs1)) {
  Write-Host ('evidence-watcher.ps1 が見つかりません: {0}' -f $WatcherPs1)
  Write-Host 'tools フォルダの中でこのインストーラーを実行しているか確認してください。'
  exit 1
}

if (-not (Get-Module -ListAvailable -Name ScheduledTasks)) {
  Write-Host 'ScheduledTasks モジュールが見つかりません（Windows 10/11標準搭載のはずです）。'
  Write-Host 'このPCではタスクスケジューラへの自動登録ができません。手動でタスクを作成してください。'
  exit 1
}

Write-Host '===================================================='
Write-Host 'RIBRE証憑ウォッチャー 初期設定'
Write-Host '===================================================='
Write-Host ''
Write-Host 'このスクリプトは、指定フォルダに置いた証憑PDF/画像を'
Write-Host '自動でアップロードする「常駐監視タスク」を設定します。'
Write-Host 'MFクラウドBoxへは自動送信されません（承認制のまま。台帳で確認してから送信します）。'
Write-Host ''

# ---------------------------------------------------------------------------
# 1. 監視フォルダ
# ---------------------------------------------------------------------------

$defaultWatchDir = Join-Path $env:USERPROFILE 'Downloads'
Write-Host ('監視するフォルダを入力してください（Enterで既定値: {0}）' -f $defaultWatchDir)
Write-Host '※ OCRのAPI利用料（gpt-4.1）が新規ファイルごとにかかるため、'
Write-Host '   ダウンロードフォルダ全体のような大きなフォルダより、'
Write-Host '   証憑専用の小さなフォルダをおすすめします。'
$watchDirInput = Read-Host '監視フォルダ'
$watchDir = if ($watchDirInput) { $watchDirInput } else { $defaultWatchDir }
$watchDir = $watchDir.Trim('"')

if (-not (Test-Path -LiteralPath $watchDir)) {
  Write-Host ('フォルダが存在しないため作成します: {0}' -f $watchDir)
  try {
    New-Item -ItemType Directory -Path $watchDir -Force | Out-Null
  } catch {
    Write-Host ('フォルダの作成に失敗しました: {0}' -f $_.Exception.Message)
    exit 1
  }
}
$watchDir = (Resolve-Path -LiteralPath $watchDir).Path

# ---------------------------------------------------------------------------
# 2. 取込先URL
# ---------------------------------------------------------------------------

$defaultIngestUrl = 'https://ribre-sales-system.vercel.app/api/mf/ingest-mail'
Write-Host ''
Write-Host ('取込先URLを入力してください（Enterで既定値: {0}）' -f $defaultIngestUrl)
$ingestUrlInput = Read-Host '取込先URL'
$ingestUrl = if ($ingestUrlInput) { $ingestUrlInput } else { $defaultIngestUrl }

# ---------------------------------------------------------------------------
# 3. シークレット（画面に表示しない）
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'MAIL_INGEST_SECRET の値を入力してください。'
Write-Host '（Vercelダッシュボード → プロジェクト → Settings → Environment Variables'
Write-Host '  の MAIL_INGEST_SECRET と同じ値です。入力内容は画面に表示されません。'
Write-Host '  貼り付け(右クリック等)は通常どおり使えます）'
$secureSecret = Read-Host -AsSecureString '取込シークレット'

$secretPtr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $ingestSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($secretPtr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

if (-not $ingestSecret) {
  Write-Host 'シークレットが空です。設定を中断しました。'
  exit 1
}

# ---------------------------------------------------------------------------
# config.json 書き出し
# ---------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $BaseDir)) {
  New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
}

$config = [ordered]@{
  ingestUrl    = $ingestUrl
  ingestSecret = $ingestSecret
  watchDir     = $watchDir
  maxAgeDays   = 14
}
$configJson = $config | ConvertTo-Json
# PowerShell 5.1のSet-Content -Encoding utf8はBOM付きUTF-8で書き込む
Set-Content -LiteralPath $ConfigPath -Value $configJson -Encoding utf8

Write-Host ''
Write-Host ('設定を保存しました: {0}' -f $ConfigPath)
Write-Host '（シークレットは平文でこのファイルに保存されます。他人がこのPCの'
Write-Host '  このユーザーアカウントにアクセスできない前提の運用です）'

# ---------------------------------------------------------------------------
# タスクスケジューラ登録
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host 'タスクスケジューラに登録します...'

Remove-ExistingTask | Out-Null

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $WatcherPs1)

# 30分おきに無期限で繰り返す。RepetitionDurationを指定しないと環境によっては
# 一定時間で繰り返しが止まってしまうため、明示的に「無期限」を指定する。
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration ([TimeSpan]::MaxValue)

# 現在ログオン中のユーザーとして、ログオンしている間だけ実行する
# （＝PCの電源が入っていてログインしている時だけ動く。仕様として想定通り）
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBattery `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'RIBRE証憑ウォッチャー: 監視フォルダの新着証憑PDF/画像をapi/mf/ingest-mailへ自動送信（承認制・MFへは自動送信しない）' `
    -ErrorAction Stop | Out-Null
} catch {
  Write-Host ('タスクの登録に失敗しました: {0}' -f $_.Exception.Message)
  exit 1
}

Write-Host ''
Write-Host '===================================================='
Write-Host '設定が完了しました。'
Write-Host '===================================================='
Write-Host ('タスク名: {0}（30分おきに自動実行）' -f $TaskName)
Write-Host ('監視フォルダ: {0}' -f $watchDir)
Write-Host ''
Write-Host '※ このタスクはPCの電源が入っていて、このユーザーでログインしている'
Write-Host '   間だけ動作します（スリープ中・ログオフ中・シャットダウン中は動きません）。'
Write-Host '   これは仕様であり、次回ログイン後・PC起動後にまとめて処理されます。'
Write-Host ''
Write-Host '動作確認: 監視フォルダにPDFを置いた後、下記コマンドで手動実行できます。'
Write-Host ('  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $WatcherPs1)
Write-Host ('  → https://ribre-sales-system.vercel.app/mf-evidence.html の台帳に「承認待ち」で載れば成功です。')
Write-Host ''
Write-Host '停止したいとき:'
Write-Host ('  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Uninstall' -f $MyInvocation.MyCommand.Path)
