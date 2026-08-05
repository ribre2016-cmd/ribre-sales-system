// ③共有ファイルを証憑としてMFへ添付する機能の安全装置を検証する。
//
// MFの証憑は**送ったら取り消せない**（CLAUDE.md 制約10）。
// したがってここが壊れると、消せないゴミが本番のMFに残る。
// 3つの関門を必ず自動で確かめる:
//   (1) すでに証憑が付いている仕訳には送らない
//   (2) 同じ中身のファイルは二度取り込まない（SHA-256）
//   (3) MFへ送る前にDBでclaimする（制約12。attachEvidenceToJournal 経由であること）
//
// 実行: node tools/test-shared-attach.js
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

console.log('===== (1) すでに証憑が付いている仕訳には送らない =====');
has('仕訳の証憑の有無を見る関数がある', api, /async function journalVoucherState\(/);
has('voucher_file_ids の件数で判定している', api, /voucher_file_ids\) \? j\.voucher_file_ids : \[\][\s\S]{0,120}has_voucher: ids\.length > 0/);
has('付いていたら送らずに返す', api, /if \(state\.has_voucher\)[\s\S]{0,300}already_has_voucher/);
has('確認できなかったときも送らない（安全側）', api, /if \(!state\.ok\)[\s\S]{0,200}journal_check_failed/);
has('確認は取り込みより**先**に行う', api,
  /journalVoucherState\(accessToken, journalId\)[\s\S]*?importSharedFileAsEvidence\(key/);
has('画面でも「証憑あり」は選べない', ui, /if \(j\.has_voucher\)[\s\S]{0,160}chip-gray', text: '証憑あり'/);

console.log('\n===== (2) 同じ中身のファイルは二度取り込まない =====');
has('SHA-256で中身のハッシュを取る', api, /function sha256Hex\(buf\)[\s\S]{0,120}createHash\('sha256'\)/);
has('content_hash で既存を探す', api, /async function findEvidenceByContentHash\(/);
has('見つかったら取り込まない', api, /if \(dup\) \{[\s\S]{0,140}duplicate_file/);
has('重複を確認できなかったら中止する（送らない）', api, /dup_check_failed/);
has('DBのunique制約に当たった場合も重複として扱う', api, /err\.duplicate = res\.status === 409/);
has('保存は上書きしない（x-upsert:false）', api, /'x-upsert': 'false'/);

console.log('\n===== (3) MFへ送る前にDBでclaimする（制約12） =====');
// 直接 postVoucher を呼んでいたら claim を飛ばしている＝二重送信が復活する
has('postVoucher を直接呼んでいない', api, /^(?![\s\S]*\bpostVoucher\()[\s\S]*$/);
has('添付は attachEvidence 経由（中で claim している）', api,
  /const r = await attachEvidence\(accessToken, imported\.evidence\.id, journalId\)/);

console.log('\n===== 記録と権限 =====');
has('成功も失敗も操作履歴に残す', api, /action: 'attach_shared_file'[\s\S]{0,400}result: r\.ok \? 'ok' : 'failed'/);
has('actionの許可リストに入っている', api, /'journal_search', 'attach_shared_file',/);

console.log('\n===== 承認が必要な設定のときは管理者のみ =====');
/* ☠ 証憑は送ったら取り消せないので、承認待ちに積む方式ではなく管理者限定で塞ぐ。
 *   担当者が単独で実行できてはいけない（利用者の指示・2026-08-05）。 */
has('isAdmin を受け取る', api, /async function handleAttachSharedFile\(res, advisor, accessToken, body, opts\)/);
has('ディスパッチが isAdmin を渡している', api, /handleAttachSharedFile\(res, advisor, accessToken, body, \{ isAdmin \}\)/);
has('required のとき担当者は弾かれる', api, /if \(!isAdmin\) \{[\s\S]{0,500}policy === 'required'[\s\S]{0,400}admin_only_when_approval/);
has('弾いたことも操作履歴に残す', api, /error_message: 'admin_only_when_approval'/);
has('弾くのはMFへ送る前（取り込みより先）', api, /admin_only_when_approval[\s\S]*?journalVoucherState\(accessToken, journalId\)/);
has('画面に理由の文言がある', ui, /admin_only_when_approval: '承認が必要な設定のため/);

console.log('\n===== ①登録時に共有ファイルを選べる =====');
has('shared_file_keys を受ける', api, /body\.shared_file_keys\) \? body\.shared_file_keys\.slice\(0, 5\)/);
has('①でも同じ取り込み関数を通す', api, /for \(const sk of sharedKeys\)[\s\S]{0,400}importSharedFileAsEvidence\(key/);
has('画面が shared_file_keys を送る', ui, /payload\.shared_file_keys = sharedKeys/);
has('初期状態は必ずオフ（自動では選ばない）', ui, /cb\.checked = false;\s*\/\/ 初期は必ずオフ/);

console.log('\n===== 取り消せないことを画面に書いているか =====');
has('③の枠に書いてある', ui, /MFへ送った証憑は取り消せません。添付先の仕訳をよくお確かめください/);
has('押す前に確認を出す', ui, /MFへ送った証憑は取り消せません。よろしいですか/);
has('①の欄にも書いてある', ui, /MFへ送った証憑は取り消せませんのでご注意ください/);
has('「証憑あり」に足せない理由を書いてある', ui, /MFでは証憑を後から外せないためです/);

console.log('\n===== 誤解を招いていたラベルを直したか =====');
has('「証憑添付可」という表示をやめた', ui, /^(?![\s\S]*text: f\.attachable \? '証憑添付可')[\s\S]*$/);
has('形式の話だと分かる表示にした', ui, /f\.attachable \? 'PDF・画像' : 'Excelなど'/);

console.log('\n===== 画面を描く順番（制約20と同じ穴を作らない） =====');
has('共有ファイルと証憑の失敗理由は①を描く前に入れる', ui,
  /txwEvidenceLoadFailed = data\.evidence_load_failed[\s\S]{0,200}txwSharedFiles = [\s\S]{0,120}txwRenderUnmatched\(/);

console.log('\n===== 見た目 =====');
has('①の選択欄のCSSがある', html, /\.txw-shared-pick \{/);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
