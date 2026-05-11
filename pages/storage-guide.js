/* RIBRE — Storage guide split (ver560-ver600) */

/* RIBRE — Storage/Cloud pages 移行（Phase7: ver560 の最終定義を pages 側へ集約） */
function ver560Render(rows) {
  const box = document.getElementById('organize56List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 800)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver560Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver560ShowOverview() {
  ver560Set('ver560Status', '表示OK');
  ver560Render([
    { type: '概要', msg: 'RIBRE 売上管理システムは、売上CSV・配送照合・OCR/AI登録・Supabase本番DB・Storage・同期・分析・バックアップ・操作ログまで対応しています。' },
    { type: 'DB', msg: 'Supabase: sales / purchases / staffs / sync_logs / audit_logs を使用' },
    { type: 'Storage', msg: 'Storage: evidence / ocr / csv bucket に画像・PDF・CSVを保存' },
    { type: 'AI', msg: 'AI自動登録: Storage証憑または画像から売上/仕入/送料/経費候補を作成' },
    { type: '同期', msg: '自動同期: sync_logs に端末データを保存し、複数端末で読み込み' },
    { type: '監査', msg: '操作ログ: audit_logs に主要操作を記録' },
    { type: '注意', level: 'warn', msg: '現在は index.html に多くの機能が入っています。次フェーズで安全に分割していきます。' }
  ]);
}
function ver560ShowCodexGuide() {
  ver560Set('ver560Status', 'Codex用');
  ver560Render([
    { type: '1', msg: 'GitHubの ribre-sales-system リポジトリをCodex/Cursorで開く' },
    { type: '2', msg: '最初の依頼は「この巨大なindex.htmlを機能ごとに安全に分割してください」がおすすめ' },
    { type: '3', msg: '分割候補: services/supabase.js, services/storage.js, services/ai.js, services/sync.js, services/audit.js' },
    { type: '4', msg: '画面候補: pages/dashboard.js, pages/sales.js, pages/ocr.js, pages/settings.js, pages/reports.js' },
    { type: '5', msg: 'CSS候補: styles/base.css, styles/mobile.css' },
    { type: '注意', level: 'warn', msg: '一度に全部React化せず、まずはファイル分割→動作確認→UI整理の順が安全です。' }
  ]);
}
function ver560ShowRefactorPlan() {
  ver560Set('ver560Status', '分割計画');
  ver560Render([
    { type: 'Step1', msg: '現状維持版を main-backup.html として残す' },
    { type: 'Step2', msg: 'Supabase設定・ログイン処理を services/supabase.js へ分離' },
    { type: 'Step3', msg: 'CSV読込・出力処理を services/csv.js へ分離' },
    { type: 'Step4', msg: 'Storage保存処理を services/storage.js へ分離' },
    { type: 'Step5', msg: 'AI OCR/AI分類を services/ai.js へ分離' },
    { type: 'Step6', msg: '自動同期・監査ログを services/sync.js / services/audit.js へ分離' },
    { type: 'Step7', msg: '画面ごとに pages/ へ分離' },
    { type: 'Step8', msg: '初心者モードをトップページ化して、詳細機能は管理者メニューへ格納' }
  ]);
}
function ver560ShowBeginnerFlow() {
  ver560Set('ver560Status', '初心者用');
  ver560Render([
    { type: '今日やること', msg: '1. ログイン → 2. CSV取込またはAI自動登録 → 3. 配送照合 → 4. データ確認 → 5. 日次レポート' },
    { type: '売上CSV', msg: 'ヤフオクCSVを取り込む場合は「ヤフオクCSV」画面を使います。' },
    { type: '証憑', msg: '画像やPDFは「Storage保存」→「AI自動登録」の順で登録します。' },
    { type: '配送', msg: 'ヤマト/佐川CSVは「配送照合」で読み込みます。' },
    { type: '確認', msg: '月締め前に「データ確認」と「修正タスク」を確認します。' },
    { type: '保存', msg: '重要作業後は「本番バックアップ」でJSON保存します。' },
    { type: '迷ったら', level: 'warn', msg: 'スタッフは「日次レポート」「AI自動登録」「配送照合」だけ覚えればOKです。管理者は本番DB・Storage・操作ログも確認します。' }
  ]);
}
function ver560DocsText() {
  return `RIBRE 売上管理システム Ver60.0 引き継ぎメモ

主要機能:
- ヤフオク売上CSV取込
- 配送CSV照合
- 未一致診断
- AI OCR自動登録
- Supabase本番DB保存
- Supabase Storage保存
- 自動同期
- スタッフ共有
- 本番バックアップ
- 操作ログ
- 日次/週次レポート
- 経営分析

Supabaseテーブル:
- sales
- purchases
- staffs
- sync_logs
- audit_logs

Storage bucket:
- evidence
- ocr
- csv

次の開発方針:
1. index.htmlを安全に機能分割
2. 初心者モード追加
3. スマホ最適化
4. 安定化・エラー対策
5. 商品化準備

Codexに最初に依頼する文:
「このプロジェクトのindex.htmlが巨大化しているので、動作を壊さずに services / pages / styles に分割してください。まずはSupabase、Storage、AI、同期、監査ログを分離し、READMEに構成を書いてください。」
`;
}
function ver560ExportDocs() {
  const blob = new Blob([ver560DocsText()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'RIBRE_handoff_Ver56_0.txt';
  a.click();
  ver560Set('ver560Status', '保存OK');
  ver560Render([{ type: '保存', msg: '引き継ぎメモを保存しました' }]);
}

window.ver560Render = ver560Render;
window.ver560Set = ver560Set;
window.ver560ShowOverview = ver560ShowOverview;
window.ver560ShowCodexGuide = ver560ShowCodexGuide;
window.ver560ShowRefactorPlan = ver560ShowRefactorPlan;
window.ver560ShowBeginnerFlow = ver560ShowBeginnerFlow;
window.ver560DocsText = ver560DocsText;
window.ver560ExportDocs = ver560ExportDocs;

/* RIBRE — Storage/Cloud pages 移行（Phase8: ver570 の最終定義を pages 側へ集約） */
function ver570Render(rows) {
  const box = document.getElementById('beginner57List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver570Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver570TodayFlow() {
  ver570Set('ver570Step', '今日やること');
  ver570Set('ver570Status', '案内中');
  ver570Render([
    { type: 'STEP1', msg: 'ログイン確認' },
    { type: 'STEP2', msg: 'ヤフオクCSV または AI自動登録' },
    { type: 'STEP3', msg: '配送照合（ヤマト/佐川）' },
    { type: 'STEP4', msg: '未一致・修正タスク確認' },
    { type: 'STEP5', msg: '日次レポート確認' },
    { type: 'STEP6', msg: '必要なら本番バックアップ' }
  ]);
}
function ver570SimpleSales() {
  ver570Set('ver570Step', '売上登録');
  ver570Render([
    { type: '方法1', msg: 'ヤフオクCSVを取り込む' },
    { type: '方法2', msg: 'AI自動登録で画像/PDFから登録' },
    { type: '確認', msg: '金額・送料・件数を確認' },
    { type: '注意', level: 'warn', msg: '未一致がある場合は配送照合を行ってください' }
  ]);
}
function ver570SimpleOCR() {
  ver570Set('ver570Step', '画像/PDF登録');
  ver570Render([
    { type: '1', msg: 'Storage保存を開く' },
    { type: '2', msg: '画像/PDFを選択' },
    { type: '3', msg: 'Storageへ保存' },
    { type: '4', msg: 'AI自動登録を開く' },
    { type: '5', msg: 'AI解析 → 候補を登録' }
  ]);
}
function ver570SimpleShipping() {
  ver570Set('ver570Step', '配送確認');
  ver570Render([
    { type: 'ヤマト', msg: 'ヤマトCSVを取り込む' },
    { type: '佐川', msg: '佐川CSVを取り込む' },
    { type: '確認', msg: '未一致件数を確認' },
    { type: '対応', msg: '必要なら手動修正' }
  ]);
}
function ver570SimpleCheck() {
  ver570Set('ver570Step', '最終確認');
  ver570Render([
    { type: '確認1', msg: '日次レポートを見る' },
    { type: '確認2', msg: '未対応タスク確認' },
    { type: '確認3', msg: '利益・送料率確認' },
    { type: '確認4', msg: '本番バックアップ保存' }
  ]);
}
function ver570ManagerMode() {
  ver570Set('ver570Target', '管理者');
  ver570Render([
    { type: '管理者', msg: '本番DB・Storage・同期・監査ログを確認します' },
    { type: '重要', msg: 'バックアップを定期保存してください' },
    { type: '同期', msg: '複数端末は自動同期をON' },
    { type: '監査', msg: '操作ログでスタッフ作業確認可能' },
    { type: '推奨', level: 'warn', msg: 'スタッフには初心者モード中心で運用するのがおすすめです' }
  ]);
}

window.ver570Render = ver570Render;
window.ver570Set = ver570Set;
window.ver570TodayFlow = ver570TodayFlow;
window.ver570SimpleSales = ver570SimpleSales;
window.ver570SimpleOCR = ver570SimpleOCR;
window.ver570SimpleShipping = ver570SimpleShipping;
window.ver570SimpleCheck = ver570SimpleCheck;
window.ver570ManagerMode = ver570ManagerMode;

/* RIBRE — Storage/Cloud pages 移行（Phase9: ver580 の最終定義を pages 側へ集約） */
function ver580Render(rows) {
  const box = document.getElementById('mobile58List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver580Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver580ApplyBase() {
  document.body.classList.add('ver580-mobile');
  localStorage.setItem('ribre_mobile_mode580', '1');
  ver580Set('ver580Mode', 'スマホ');
  ver580Set('ver580Status', '適用OK');
}
function ver580EnableMobile() {
  ver580ApplyBase();

  const style = document.createElement('style');
  style.id = 'ver580-style';
  style.innerHTML = `
body.ver580-mobile{
  font-size:18px;
}
body.ver580-mobile button{
  min-height:54px;
  font-size:17px;
  border-radius:12px;
}
body.ver580-mobile input,
body.ver580-mobile select{
  min-height:50px;
  font-size:17px;
}
body.ver580-mobile .controls{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
body.ver580-mobile .controls button{
  flex:1 1 45%;
}
body.ver580-mobile .grid{
  grid-template-columns:1fr 1fr;
}
body.ver580-mobile .panel{
  padding:14px;
}
body.ver580-mobile .row{
  padding:12px;
  font-size:16px;
}
`;
  const old = document.getElementById('ver580-style');
  if (old) old.remove();
  document.head.appendChild(style);

  ver580Render([
    { type: '適用', msg: 'スマホ向けUIを適用しました' },
    { type: '改善', msg: 'ボタン・入力欄を大きくしました' },
    { type: '改善', msg: '片手操作しやすい配置へ変更' }
  ]);
}
function ver580DisableMobile() {
  document.body.classList.remove('ver580-mobile');
  localStorage.removeItem('ribre_mobile_mode580');
  const old = document.getElementById('ver580-style');
  if (old) old.remove();

  ver580Set('ver580Mode', '通常');
  ver580Set('ver580Hand', 'OFF');
  ver580Set('ver580Button', '通常');
  ver580Set('ver580Status', '通常UI');

  ver580Render([{ type: '解除', msg: '通常UIへ戻しました' }]);
}
function ver580LargeButtons() {
  ver580ApplyBase();

  let style = document.getElementById('ver580-large-style');
  if (style) style.remove();

  style = document.createElement('style');
  style.id = 'ver580-large-style';
  style.innerHTML = `
body.ver580-mobile button{
  min-height:64px !important;
  font-size:19px !important;
  padding:14px !important;
}
`;
  document.head.appendChild(style);

  ver580Set('ver580Button', '大');
  ver580Render([{ type: 'ボタン', msg: '大きいボタンへ変更しました' }]);
}
function ver580CompactMode() {
  let style = document.getElementById('ver580-compact-style');
  if (style) style.remove();

  style = document.createElement('style');
  style.id = 'ver580-compact-style';
  style.innerHTML = `
body.ver580-mobile .panel{
  padding:8px !important;
}
body.ver580-mobile .row{
  padding:8px !important;
  font-size:14px !important;
}
`;
  document.head.appendChild(style);

  ver580Render([{ type: 'コンパクト', msg: '情報量を増やしました' }]);
}
function ver580BottomMenu() {
  let menu = document.getElementById('ver580-bottom-menu');
  if (menu) {
    menu.remove();
    ver580Set('ver580Hand', 'OFF');
    return;
  }

  menu = document.createElement('div');
  menu.id = 'ver580-bottom-menu';
  menu.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#0f172a;padding:10px;display:flex;gap:8px;z-index:9999;';

  const items = [
    ['初心者', 'beginner57'],
    ['OCR', 'aiauto50'],
    ['売上', 'analytics51'],
    ['同期', 'sync54']
  ];

  items.forEach((i) => {
    const b = document.createElement('button');
    b.textContent = i[0];
    b.style.cssText = 'flex:1;background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px;';
    b.onclick = () => {
      try {
        showSec(i[1], b);
      } catch (e) {}
    };
    menu.appendChild(b);
  });

  document.body.appendChild(menu);

  ver580Set('ver580Hand', 'ON');

  ver580Render([{ type: '下部メニュー', msg: '片手操作向け下部メニューを表示しました' }]);
}
function ver580Guide() {
  ver580Render([
    { type: 'おすすめ', msg: 'iPhoneでは「スマホUI ON」を先に押してください' },
    { type: 'OCR', msg: '画像/PDF登録はAI自動登録を使用' },
    { type: '片手操作', msg: '下部メニューで主要機能へ移動可能' },
    { type: 'スタッフ', msg: '初心者モード中心の運用がおすすめ' },
    { type: '管理者', msg: '分析・同期・監査ログはPC推奨' }
  ]);
}

window.ver580Render = ver580Render;
window.ver580Set = ver580Set;
window.ver580ApplyBase = ver580ApplyBase;
window.ver580EnableMobile = ver580EnableMobile;
window.ver580DisableMobile = ver580DisableMobile;
window.ver580LargeButtons = ver580LargeButtons;
window.ver580CompactMode = ver580CompactMode;
window.ver580BottomMenu = ver580BottomMenu;
window.ver580Guide = ver580Guide;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver580InitDone) return;
      window.__ver580InitDone = true;
      if (localStorage.getItem('ribre_mobile_mode580') === '1') {
        try {
          ver580EnableMobile();
        } catch (e) {}
      }
    } catch (e) {}
  }, 1000);
});

/* RIBRE — Storage/Cloud pages 移行（Phase10: ver590 の最終定義を pages 側へ集約） */
function ver590Render(rows) {
  const box = document.getElementById('stable59List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver590Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver590Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver590Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver590GetTimer() {
  return window.__ver590TimerPages || null;
}
function ver590SetTimer(timerId) {
  window.__ver590TimerPages = timerId || null;
}
async function ver590HealthCheck() {
  const config = ver590Config();
  const session = ver590Session();

  const rows = [];

  if (config.url && config.key) {
    rows.push({ type: 'DB', msg: 'Supabase設定OK' });
    ver590Set('ver590Db', 'OK');
  } else {
    rows.push({ type: 'DB', level: 'danger', msg: 'Supabase設定不足' });
    ver590Set('ver590Db', 'NG');
  }

  if (session.access_token) {
    rows.push({ type: 'LOGIN', msg: 'ログイン状態OK' });
  } else {
    rows.push({ type: 'LOGIN', level: 'warn', msg: 'ログイン未確認' });
  }

  try {
    const sales = JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]');
    rows.push({ type: 'DATA', msg: '売上データ ' + sales.length + '件' });
  } catch (e) {
    rows.push({ type: 'DATA', level: 'danger', msg: '売上データ破損の可能性' });
  }

  try {
    const storage = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
    rows.push({ type: 'Storage', msg: 'Storage情報 ' + storage.length + '件' });
    ver590Set('ver590Storage', 'OK');
  } catch (e) {
    rows.push({ type: 'Storage', level: 'warn', msg: 'Storage情報なし' });
    ver590Set('ver590Storage', '未確認');
  }

  ver590Set('ver590Status', '診断完了');
  ver590Render(rows);
}
function ver590EnableAutoSave() {
  const running = ver590GetTimer();
  if (running) clearInterval(running);

  const timerId = setInterval(() => {
    try {
      const backup = {
        sales: localStorage.getItem('ribre_full_sales221') || '[]',
        purchases: localStorage.getItem('ribre_full_purchases221') || '[]',
        savedAt: new Date().toISOString()
      };
      localStorage.setItem('ribre_autosave590', JSON.stringify(backup));
    } catch (e) {}
  }, 30000);
  ver590SetTimer(timerId);

  localStorage.setItem('ribre_autosave_enabled590', '1');

  ver590Set('ver590Autosave', 'ON');
  ver590Set('ver590Status', '自動保存中');
  ver590Render([
    { type: '自動保存', msg: '30秒ごとに自動保存します' },
    { type: '保護', msg: 'ブラウザクラッシュ対策ON' }
  ]);
}
function ver590EmergencyBackup() {
  const backup = {
    exportedAt: new Date().toISOString(),
    sales: localStorage.getItem('ribre_full_sales221') || '[]',
    purchases: localStorage.getItem('ribre_full_purchases221') || '[]',
    storage: localStorage.getItem('ribre_storage_files490') || '[]',
    sync: localStorage.getItem('ribre_sync_history540') || '[]'
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'emergency_backup_Ver59_0.json';
  a.click();

  ver590Set('ver590Status', 'バックアップ保存');
  ver590Render([{ type: '緊急保存', msg: '緊急バックアップを保存しました' }]);
}
async function ver590ConnectionCheck() {
  const config = ver590Config();

  if (!config.url) {
    ver590Render([{ type: '接続', level: 'danger', msg: 'Supabase URL未設定' }]);
    return;
  }

  try {
    const r = await fetch(config.url + '/rest/v1/', {
      headers: {
        apikey: config.key
      }
    });

    if (r.ok) {
      ver590Set('ver590Db', '接続OK');
      ver590Render([
        { type: '接続', msg: 'Supabase接続OK' },
        { type: '状態', msg: 'ネットワーク正常' }
      ]);
    } else {
      ver590Render([{ type: '接続', level: 'warn', msg: 'Supabase応答エラー' }]);
    }
  } catch (e) {
    ver590Render([{ type: '接続', level: 'danger', msg: '接続失敗: ' + e.message }]);
  }
}
function ver590RecoveryMode() {
  try {
    const auto = JSON.parse(localStorage.getItem('ribre_autosave590') || '{}');

    if (auto.sales) {
      localStorage.setItem('ribre_full_sales221', auto.sales);
    }

    if (auto.purchases) {
      localStorage.setItem('ribre_full_purchases221', auto.purchases);
    }

    ver590Set('ver590Status', '復旧完了');
    ver590Render([
      { type: '復旧', msg: '自動保存データから復旧しました' },
      { type: '注意', level: 'warn', msg: '必要なら本番DBへ再保存してください' }
    ]);
  } catch (e) {
    ver590Render([{ type: '復旧', level: 'danger', msg: '復旧失敗: ' + e.message }]);
  }
}
function ver590ErrorGuide() {
  ver590Render([
    { type: 'JWT expired', msg: '再ログインしてください' },
    { type: '同期エラー', msg: 'sync_logs のRLS policy確認' },
    { type: 'Storage失敗', msg: 'bucket名とpolicy確認' },
    { type: '読込失敗', msg: '本番DB接続確認' },
    { type: '白画面', msg: '最新バックアップから復旧' },
    { type: '推奨', level: 'warn', msg: '重要作業前はJSONバックアップ推奨' }
  ]);
}

window.ver590Render = ver590Render;
window.ver590Set = ver590Set;
window.ver590Config = ver590Config;
window.ver590Session = ver590Session;
window.ver590HealthCheck = ver590HealthCheck;
window.ver590EnableAutoSave = ver590EnableAutoSave;
window.ver590EmergencyBackup = ver590EmergencyBackup;
window.ver590ConnectionCheck = ver590ConnectionCheck;
window.ver590RecoveryMode = ver590RecoveryMode;
window.ver590ErrorGuide = ver590ErrorGuide;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver590InitDone) return;
      window.__ver590InitDone = true;
      if (localStorage.getItem('ribre_autosave_enabled590') === '1') {
        try {
          ver590EnableAutoSave();
        } catch (e) {}
      }
    } catch (e) {}
  }, 1200);
});

/* RIBRE — Storage/Cloud pages 移行（Phase11: ver600 の最終定義を pages 側へ集約） */
function ver600Render(rows) {
  const box = document.getElementById('product60List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver600Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver600ShowPlan() {
  ver600Set('ver600Status', '表示中');
  ver600Render([
    { type: 'Phase1', msg: '自社運用を安定化' },
    { type: 'Phase2', msg: 'スタッフ共有運用' },
    { type: 'Phase3', msg: '外部ユーザーテスト' },
    { type: 'Phase4', msg: 'SaaS版公開' },
    { type: 'Phase5', msg: '課金・契約管理追加' },
    { type: '重要', level: 'warn', msg: 'まずは自社で毎日使い、実運用で改善を繰り返すのがおすすめです' }
  ]);
}
function ver600ShowPricing() {
  ver600Render([
    { type: 'ライト', msg: '月額 4,980円 / 小規模向け' },
    { type: 'スタンダード', msg: '月額 9,800円 / OCR・同期対応' },
    { type: 'プロ', msg: '月額 29,800円 / 複数店舗・分析強化' },
    { type: 'オプション', msg: 'AI OCR追加従量課金' },
    { type: '推奨', level: 'warn', msg: '最初は紹介制・少人数運用がおすすめ' }
  ]);
}
function ver600ShowFeatures() {
  ver600Render([
    { type: '対応', msg: 'ヤフオクCSV' },
    { type: '対応', msg: '配送照合' },
    { type: '対応', msg: 'AI OCR登録' },
    { type: '対応', msg: 'Storage証憑管理' },
    { type: '対応', msg: '自動同期' },
    { type: '対応', msg: '監査ログ' },
    { type: '対応', msg: '経営分析' },
    { type: '次', level: 'warn', msg: '次は請求管理・契約管理・店舗別管理が必要' }
  ]);
}
function ver600ShowLicense() {
  ver600Render([
    { type: '方式', msg: '店舗ごとにアカウント発行' },
    { type: '権限', msg: '管理者 / スタッフ を分離' },
    { type: '制限', msg: '利用店舗数・Storage容量制御' },
    { type: '契約', msg: '月額更新制' },
    { type: '推奨', level: 'warn', msg: 'Stripeなどで課金管理するのがおすすめ' }
  ]);
}
function ver600ShowDemo() {
  ver600Render([
    { type: 'デモ', msg: 'サンプル売上データを用意' },
    { type: 'デモ', msg: '初心者モード中心で案内' },
    { type: 'デモ', msg: 'OCR→配送照合→日次レポートまで体験' },
    { type: '営業', msg: '中古EC業者へ提案可能' },
    { type: '推奨', level: 'warn', msg: 'まずは知り合い店舗で試験運用がおすすめ' }
  ]);
}
function ver600ExportPlan() {
  const text = `RIBRE 売上管理システム Ver60.0 商品化メモ

現在実装:
- CSV取込
- AI OCR
- Storage
- 本番DB
- 自動同期
- 操作ログ
- 分析
- バックアップ

次に必要:
- 店舗別管理
- 契約管理
- Stripe課金
- SaaS化
- API制限
- 利用量管理

推奨:
まずは自社運用を安定化し、少人数へ試験導入する。
`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'RIBRE_product_plan_Ver60_0.txt';
  a.click();

  ver600Set('ver600Status', '保存OK');
  ver600Render([{ type: '保存', msg: '商品化メモを保存しました' }]);
}

window.ver600Render = ver600Render;
window.ver600Set = ver600Set;
window.ver600ShowPlan = ver600ShowPlan;
window.ver600ShowPricing = ver600ShowPricing;
window.ver600ShowFeatures = ver600ShowFeatures;
window.ver600ShowLicense = ver600ShowLicense;
window.ver600ShowDemo = ver600ShowDemo;
window.ver600ExportPlan = ver600ExportPlan;
