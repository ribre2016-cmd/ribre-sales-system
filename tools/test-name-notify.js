// 税理士の表示名と、ログイン通知の検証。
//
// なぜ必要か:
//   通知は「鳴りすぎる」と誰も読まなくなり、「鳴らない」と意味がない。
//   1日1回の判定と、通知の失敗が本処理（画面の表示）を壊さないことを
//   実際に関数を動かして確かめる。
//   名前は権限（社内メンバーのみ）と、招待の名前が既存の名前を消さないことが要点。
//
// 実行: node tools/test-name-notify.js
'use strict';

const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'mf', 'tax-workspace.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');

let ng = 0;
function has(label, src, re) {
  const ok = re.test(src);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

console.log('===== 表示名の配管 =====');
has('発行画面に名前の入力がある', html, /id="txwInviteNameInput"/);
has('発行時に note として送る', ui, /invite_create', \{ note: \(\(nameInput && nameInput\.value\) \|\| ''\)\.trim\(\) \}/);
has('招待一覧に「渡す相手」列がある', ui, /'渡す相手', '発行日時'/);
has('登録時に招待の名前を表示名にする', api, /const inviteName = String\(\(rows\[0\] && rows\[0\]\.note\) \|\| ''\)/);
has('名前が空なら送らない（既存の名前を消さない）', api, /if \(inviteName\) advisorPatch\.name = inviteName;/);
has('税理士一覧に名前の列がある', ui, /'名前', 'メール', '登録日時'/);
has('未設定のときは（未設定）と出す', ui, /a\.name \|\| '（未設定）'/);
has('名前を変えるボタンがある', ui, /text: '名前を変える'/);
has('右上を「名前（メール）」にする', ui, /data\.advisor\.name \+ '（' \+ data\.advisor\.email \+ '）'/);

console.log('\n===== 表示名の権限 =====');
has('advisor_set_name は社内メンバーだけ',
  api, /action === 'advisor_set_name'\) \{\s*\n\s*if \(!isMember\)/);
has('許可リストに入っている', api, /'advisor_set_role', 'advisor_set_name',/);
has('MEMBER_ONLY の配列には入っていない（届かなくなる罠）',
  api, /^(?![\s\S]*MEMBER_ONLY = \[[^\]]*advisor_set_name)[\s\S]*$/);
has('変更は操作履歴に残す', api, /action: 'advisor_set_name',\s*\n\s*result: 'ok'/);
has('名前は60文字で切る', api, /\.trim\(\)\.slice\(0, 60\)/);

console.log('\n===== ログイン通知の作り =====');
has('社内メンバーは鳴らさない', api, /if \(!isMember\) await notifyAdvisorLoginOnce\(advisor\);/);
has('トークン未設定なら黙って何もしない', api, /if \(!CHATWORK_API_TOKEN \|\| !CHATWORK_ROOM_ID\) return false;/);
has('通知の失敗は握って本処理を続ける', api, /console\.error\('login通知に失敗（本処理は続行）'/);
has('初回登録もその場で知らせる', api, /様が招待リンクから登録しました（管理者）/);
has('登録の通知が失敗しても登録は成功扱い（notifyの後にres）',
  api, /notifyChatwork\('\[info\]\[title\]税理士ワークスペース\[\/title\]'\s*\n\s*\+ who \+ ' 様が招待リンクから登録しました[\s\S]{0,200}res\.status\(r\.ok \? 200 : 200\)\.json\(r\);/);

/* ④操作履歴のラベル表と、実際に記録している action の突き合わせ。
 * 足し忘れると英語のまま出る（approve_journalize 等が長らく生で出ていた）。 */
console.log('\n===== 操作履歴のラベル漏れ =====');
{
  const recorded = [...new Set([...api.matchAll(/recordAction\(\{[\s\S]{0,200}?action: '([a-z_]+)'/g)].map((m) => m[1]))];
  const seg = /var labels = \{([\s\S]*?)\};/.exec(ui);
  const labeled = new Set(seg ? [...seg[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]) : []);
  const missing = recorded.filter((a) => !labeled.has(a));
  ck('記録している全action（' + recorded.length + '個）にラベルがある', missing, []);
}

/* ---- 1日1回の判定を実際に動かす ---- */
console.log('\n===== ログイン通知: 1日1回の判定（実駆動） =====');
function pick(head) {
  const i = api.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  const rest = api.slice(i);
  return rest.slice(0, rest.indexOf('\n}\n') + 3);
}
global.SUPABASE_URL = 'https://x.supabase.co';
global.supabaseHeaders = () => ({});
let queried = [];
let recorded = [];
let notified = [];
let fetchRows = [];
let fetchOk = true;
global.fetch = async (url) => {
  queried.push(String(url));
  return { ok: fetchOk, json: async () => fetchRows };
};
global.recordAction = async (row) => { recorded.push(row); };
global.notifyChatwork = async (text) => { notified.push(text); return true; };
const notifyOnce = eval('(' + pick('async function notifyAdvisorLoginOnce(') + ')');

(async () => {
  // 1) 今日まだ通知していない → 記録して鳴らす
  queried = []; recorded = []; notified = []; fetchRows = []; fetchOk = true;
  await notifyOnce({ email: 'sensei@example.com', name: '山田太郎' });
  ck('初回: 記録する', recorded.map((r) => r.action), ['login']);
  ck('初回: 鳴らす', notified.length, 1);
  ck('名前つきで知らせる', /山田太郎（sensei@example\.com）/.test(notified[0] || ''), true);
  ck('日本時間の日付で数える（+09:00起点）',
    /created_at=gte\.[^&]*T15%3A00%3A00/.test(queried[0]) || /T15:00:00/.test(decodeURIComponent(queried[0])), true);

  // 2) 今日すでに通知済み → 何もしない
  queried = []; recorded = []; notified = []; fetchRows = [{ id: 1 }];
  await notifyOnce({ email: 'sensei@example.com', name: '山田太郎' });
  ck('2回目: 記録しない', recorded.length, 0);
  ck('2回目: 鳴らさない', notified.length, 0);

  // 3) 判定の取得に失敗 → 鳴らさない（二重通知より安全側）
  queried = []; recorded = []; notified = []; fetchRows = []; fetchOk = false;
  await notifyOnce({ email: 'sensei@example.com', name: null });
  ck('確認できないときは鳴らさない', notified.length, 0);

  // 4) 名前が無い人はメールで知らせる
  queried = []; recorded = []; notified = []; fetchRows = []; fetchOk = true;
  await notifyOnce({ email: 'noname@example.com', name: null });
  ck('名前なしはメールだけで知らせる', /noname@example\.com 様/.test(notified[0] || ''), true);

  // 5) 途中で例外が起きても投げ返さない（listを壊さない）
  global.fetch = async () => { throw new Error('network down'); };
  let threw = false;
  try { await notifyOnce({ email: 'x@example.com', name: null }); } catch (e) { threw = true; }
  ck('例外を外へ投げない', threw, false);

  console.log('\n===== 結果 =====');
  console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
  process.exit(ng === 0 ? 0 : 1);
})();
