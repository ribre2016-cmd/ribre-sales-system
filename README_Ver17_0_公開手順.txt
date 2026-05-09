売上管理ツール Ver17.0 公開URL対応版

内容:
- index.html 化
- Vercel設定 vercel.json 追加
- Netlify設定 netlify.toml 追加
- start_local.bat は index.html 起動へ修正

Vercelで公開する手順:
1. GitHubで新しいリポジトリを作る
2. このZIPの中身を全部アップロード
3. Vercelで New Project
4. GitHubリポジトリを選ぶ
5. Deployを押す
6. 公開URLが発行される

Supabase側であとで行うこと:
1. Supabaseを開く
2. Authentication
3. URL Configuration
4. Site URL に VercelのURLを入れる
5. Redirect URLs に VercelのURLを追加

注意:
- service_role key は絶対に入れない
- 公開後も使うのは Project URL と Publishable key
- RLSは有効のままでOK
