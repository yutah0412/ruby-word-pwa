# 🔄 完全初期化＆新規アカウントでやり直す手順

GitHubアカウントの認証をすべてリセットし、新しいアカウントで最初から
デプロイするための完全手順書です。

---

## 📋 作業の全体像

```
STEP 1  ブラウザ側のGitHubログアウト・Cookie削除
         ↓
STEP 2  git のローカル認証情報を削除（macOS キーチェーン）
         ↓
STEP 3  ローカル git 設定（user.name/email）をリセット
         ↓
STEP 4  pwa-app フォルダの .git ディレクトリを削除（ローカルリポジトリ初期化）
         ↓
STEP 5  新しいGitHubアカウントを作成
         ↓
STEP 6  新規リポジトリ作成 + push
```

---

## STEP 1: ブラウザのGitHub認証をクリア

### macOS Safari
1. Safari → 設定 → プライバシー → 「Webサイトデータを管理」
2. 検索欄に「github」と入力
3. 出てきた `github.com` を選んで「削除」
4. さらに念のため：Safari → 履歴 → 「履歴を消去」

### macOS Chrome / Edge
1. アドレスバーに `chrome://settings/cookies/detail?site=github.com` を入力（EdgeもChromeと同様）
2. 「すべて削除」ボタン
3. 別タブで `chrome://settings/cookies/detail?site=googleusercontent.com` もクリア（Google連携用）
4. さらに https://github.com にアクセスして右上アバターから「Sign out」

### 念押し：GitHubのOAuth連携解除
もし**以前Googleアカウントとリンクしていた**場合：
1. https://myaccount.google.com/permissions にアクセス
2. 「GitHub」が登録されていれば削除

---

## STEP 2: macOS キーチェーンから git 認証情報を削除

`git push` するとキーチェーンにGitHubのトークン/パスワードがキャッシュされています。

### GUI で削除（簡単）
1. 「キーチェーンアクセス」アプリを起動（Spotlightで「キーチェーン」で検索）
2. 左上「ログイン」を選択
3. 右上検索窓で「github」と入力
4. 出てきた項目をすべて選択 → Delete キーで削除
   - `github.com` (インターネットパスワード)
   - `api.github.com`
   - `GitHub for Mac`（もしあれば）

### コマンドで一括削除
```bash
# キーチェーンから github 関連を一括削除
security delete-internet-password -s github.com 2>/dev/null
security delete-internet-password -s api.github.com 2>/dev/null
security delete-internet-password -s gist.github.com 2>/dev/null

# macOS credential helper のキャッシュをクリア
git credential-osxkeychain erase <<EOF
host=github.com
protocol=https
EOF
```

---

## STEP 3: ローカル git の設定をリセット

### 現在の設定を確認
```bash
git config --global --list | grep user
# 出力例：
# user.name=OldName
# user.email=old@example.com
```

### グローバル設定を削除
```bash
git config --global --unset user.name
git config --global --unset user.email
git config --global --unset credential.helper

# 必要なら全体をリセット（注意：git 設定が全部消える）
# rm ~/.gitconfig
```

### 新しいアカウント情報を後で設定（STEP 5でGitHub登録した後）
この段階では入力しません。後で新メールで設定します。

---

## STEP 4: pwa-app フォルダのローカルリポジトリを初期化

### 既存の .git ディレクトリを削除

```bash
cd /path/to/your/project/pwa-app

# .git ディレクトリの存在確認
ls -la | grep git

# あれば削除（これでローカルの git 履歴が消える）
rm -rf .git

# .gitignore は残す
ls -la | grep git
# → .gitignore だけが残っていればOK
```

これで `pwa-app/` は通常のフォルダに戻ります。コードは消えません、
**gitの履歴だけ**が消えます。

---

## STEP 5: 新しい GitHub アカウントを作成

### アカウント作成
1. https://github.com/join にアクセス
2. **メールアドレス**を入力（Gmail以外でもOK、普段使うメールが便利）
3. パスワードを設定
4. ユーザー名を決める（例：`taro-tanaka`, `rubywrd` など）
   - 後で変えられるが、URLに使われるので重要：`https://[username].github.io/ruby-word-pwa/`
5. メール認証 → 完了

### Personal Access Token (PAT) を発行
パスワードだとpush時に面倒なので、トークンを作っておきます。

1. 右上アバター → **Settings**
2. 左メニュー一番下 → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)**
4. **Generate new token** → **Generate new token (classic)**
5. 設定：
   - **Note**: `ruby-word-pwa`
   - **Expiration**: `90 days` または `No expiration`
   - **Scopes**: ☑️ `repo` だけでOK（全部チェック不要）
6. **Generate token** → **表示されたトークンを必ずコピー**
   - ⚠️ このページを閉じると二度と見られません
   - メモ帳やパスワードマネージャーに保存

---

## STEP 6: 新アカウントでリポジトリ作成 & push

### ① GitHubでリポジトリを作成
1. https://github.com/new
2. **Repository name**: `ruby-word-pwa`
3. **Public** 選択
4. 「Add a README file」などは**全部オフ**（ローカル側にあるため）
5. **Create repository**

### ② ローカルで新しい名前で初期化
```bash
cd /path/to/your/project/pwa-app

# 新しいアカウント情報を設定
git config --global user.name "あなたのGitHubユーザー名"
git config --global user.email "新しいメールアドレス"

# 確認
git config --global user.name
git config --global user.email

# Gitリポジトリを初期化
git init
git branch -M main
git add .
git commit -m "Initial PWA commit"
```

### ③ リモート追加 & push
```bash
# 自分のユーザー名に置き換え
git remote add origin https://github.com/YOUR-USERNAME/ruby-word-pwa.git

# push（初回）
git push -u origin main
```

**認証プロンプトが出たら**：
- **Username**: GitHubのユーザー名
- **Password**: 先ほど発行した **Personal Access Token** を貼り付け
  （⚠️ GitHubのログインパスワードではない）

### ④ GitHub Pages を有効化
1. リポジトリページ → **Settings** タブ
2. 左メニュー **Pages**
3. **Source**: `Deploy from a branch`
4. **Branch**: `main` / `/ (root)` → **Save**
5. 数分後、URLが表示される：
   ```
   https://YOUR-USERNAME.github.io/ruby-word-pwa/
   ```

---

## 🧪 動作確認

1. 表示されたURLにアクセス（初回読み込みは辞書ダウンロードで30秒〜1分）
2. .docx ファイルをドロップして動作確認
3. ブラウザで「インストール」ボタンが出ればPWAとしてインストール可能

---

## 🚨 トラブル時の再リセット

### push 時に古いアカウントで認証されてしまう
```bash
# キーチェーンを再度クリア
security delete-internet-password -s github.com

# remote の認証情報付きURLに変更（一発認証）
cd pwa-app
git remote set-url origin https://YOUR-USERNAME:YOUR-TOKEN@github.com/YOUR-USERNAME/ruby-word-pwa.git
git push -u origin main

# 成功したら token入りURLを元に戻す（安全のため）
git remote set-url origin https://github.com/YOUR-USERNAME/ruby-word-pwa.git
```

### 完全にやり直したい（リポジトリも含めて）
1. GitHubで Settings → 一番下「Danger Zone」→ Delete this repository
2. ローカルで `rm -rf .git`
3. STEP 6 から再実行

---

## 💡 Tips

### GitHub CLI を使うと認証が楽
```bash
brew install gh
gh auth login
```
→ ブラウザが開いて簡単に認証できる。以降の push は認証聞かれない。

### 複数GitHubアカウントを併用したい
もし古いアカウントも使う予定なら、SSH鍵を分けるなどの対応が必要。
一つしか使わないなら今回の方法で十分です。

---

## ✅ 完了チェックリスト

- [ ] ブラウザから古いGitHubをログアウト
- [ ] 「キーチェーンアクセス」で `github` 関連を全削除
- [ ] `git config --global --unset user.name / user.email`
- [ ] `pwa-app/.git` を削除
- [ ] 新しいメールでGitHubアカウント作成
- [ ] Personal Access Token を発行・保存
- [ ] `git init` → commit → push 成功
- [ ] GitHub Pages 有効化
- [ ] URL で動作確認
