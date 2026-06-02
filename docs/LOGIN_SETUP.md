# ログイン（Google＋メール）設定手順

かんたんモードのログインを動かすための **Supabase 側の設定** をまとめます。
（コードは実装済み。以下はダッシュボードでの操作です）

前提：Supabaseプロジェクトは既存（sales / purchases などのテーブルあり）。

---

## 0. アプリに接続先が入っているか確認
1. アプリ右上「← フル画面に戻る」→ 設定 を開く
2. **Supabase Project URL** と **anon (publishable) key** が入っているか確認
   - 空なら Supabase ダッシュボード → Project Settings → API から
     - `Project URL`
     - `anon public` key
   - をコピーして保存（`Supabase設定保存`）

---

## 1. メール＋パスワードだけ先に使う場合
上の手順0だけで動きます。かんたんモードのログイン欄でメール/パスワードで「新規登録」→「ログイン」。
（Google設定が後回しでもOK）

---

## 2. Googleログインを有効化する

### 2-1. Google Cloud で OAuth クライアントを作成
1. https://console.cloud.google.com/ → プロジェクト作成（任意の名前）
2. 「APIとサービス」→「OA​uth同意画面」を構成（外部／アプリ名／メール等）
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
   - 種類：**ウェブ アプリケーション**
   - **承認済みのリダイレクト URI** に次を追加（SupabaseのコールバックURL）：
     ```
     https://<あなたのプロジェクト>.supabase.co/auth/v1/callback
     ```
   - 作成後に表示される **クライアント ID** と **クライアント シークレット** を控える

### 2-2. Supabase で Google プロバイダを有効化
1. Supabase ダッシュボード → Authentication → Providers → **Google**
2. **Enable** にして、2-1の **Client ID / Client Secret** を貼り付け → Save

### 2-3. リダイレクト先（戻り先）を許可
Authentication → URL Configuration → **Redirect URLs** に、アプリを開くURLを追加：
```
https://<本番URL>/index.html
https://<本番URL>/
http://localhost:8765/index.html
```
（本番URL = Vercel の公開URL。ローカル確認する場合は localhost も）

---

## 3. 動作確認
1. アプリ → かんたんモード → ホーム上部の「🔵 Googleでログイン」
2. Google認証 → アプリに戻り「ログイン中：あなたのメール」と表示
3. 別のPC/スマホで同じGoogleアカウントでログイン → 同じデータが見えればOK
4. 初回ログイン時、その端末のローカルデータは自動でアカウントへ移行されます

---

## 補足（任意）：再移行の重複防止
売上テーブルに次のユニーク制約があると、再アップロード時に重複しません（任意）：
```sql
-- 既存データと衝突しない場合のみ
alter table sales add constraint sales_user_item_uniq unique (user_email, item_id);
```
※ 制約が無くても、初回移行は1回だけ実行されるよう内部でフラグ管理しています。

---

## トラブル時
- 「Supabase設定してください」→ 手順0のURL/Key未保存
- Googleで戻ってこない/エラー → 2-1の承認済みリダイレクトURI、2-3のRedirect URLsを再確認
- ログインできるがデータが出ない → テーブルのRLS（`supabase_rls_Ver15_0.sql`）が有効か確認
