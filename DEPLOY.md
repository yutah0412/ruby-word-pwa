# 🚀 GitHub Pages デプロイ手順

## 前提

- GitHubアカウントをお持ちでいる
- `pwa-app/` の [README.md](README.md) の STEP 1〜3（vendor, dict, icons）が済んでいる

---

## STEP 1: GitHub リポジトリを作成

1. https://github.com/new にアクセス
2. 以下の通り設定：
   - **Repository name**: `ruby-word-pwa`
   - **Description**: `Wordファイルにふりがなを自動で振るPWA`
   - **Public** を選択（GitHub Pagesは無料プランではPublicのみ）
   - **「Add a README file」はチェックしない**（後で自分のREADMEを入れるため）
3. 「Create repository」をクリック

---

## STEP 2: ローカルからpush

```bash
cd pwa-app

# Gitリポジトリを初期化
git init
git add .
git commit -m "Initial PWA commit"

# リモート追加（YOUR-USERNAME を自分のGitHubユーザー名に置き換え）
git branch -M main
git remote add origin https://github.com/yutah0412/ruby-word-pwa.git
git push -u origin main
```

### 認証について
初回push時にGitHubの認証を求められます。以下のいずれかで：

- **Personal Access Token**（推奨）
  1. https://github.com/settings/tokens で「Generate new token (classic)」
  2. Scope: `repo` にチェック
  3. 生成されたトークンをパスワード欄に貼り付け

- **GitHub CLI**
  ```bash
  brew install gh
  gh auth login
  ```

- **SSH鍵**（事前に設定済みの場合）
  ```bash
  git remote set-url origin git@github.com:YOUR-USERNAME/ruby-word-pwa.git
  git push -u origin main
  ```

---

## STEP 3: GitHub Pages を有効化

1. リポジトリのページで **Settings** タブ
2. 左メニュー **Pages** を選択
3. **Source**: `Deploy from a branch`
4. **Branch**: `main` / `/ (root)` を選択 → **Save**
5. 数分後、緑色のバーに以下のURLが表示される：
   ```
   https://YOUR-USERNAME.github.io/ruby-word-pwa/
   ```

---

## STEP 4: アクセスとPWAインストール

1. Safari / Chrome で上記URLにアクセス
2. 初回読み込み時に Service Worker が辞書を含む全リソースをキャッシュ（約12MB）
3. 以降はオフライン動作可能

### PWAとしてインストール（デスクトップアプリ化）

**macOS Safari**:
1. メニュー「ファイル」→「Dockに追加」
2. または共有メニュー → 「Dockに追加」

**macOS Chrome / Edge**:
1. アドレスバー右端の「インストール」アイコン（⊕のような絵）をクリック
2. 「インストール」を押下
3. Launchpadから起動できるようになる

**iOS Safari**:
1. 共有ボタン → 「ホーム画面に追加」

**Android Chrome**:
1. メニュー「ホーム画面に追加」

---

## STEP 5: 更新する場合

コードを変更したら：

```bash
cd pwa-app
git add .
git commit -m "Update: 変更内容"
git push
```

1〜5分でGitHub Pagesに反映されます。

⚠️ **PWA のキャッシュ更新について**
Service Worker が旧バージョンをキャッシュしているため、
ユーザー側で更新を反映するには：

- **sw.js の VERSION を上げる**（例: `v1.0.0` → `v1.0.1`）
- これで次回アクセス時に全キャッシュがクリアされ、新しいバージョンに置き換わる

---

## 🐛 トラブルシューティング

### GitHub Pages が 404 になる
- Settings → Pages で branch が正しく設定されているか確認
- 反映に5〜10分かかることがある

### Service Worker が動かない
- `https://` または `localhost` でアクセスしているか確認
- `file://` では動作しない

### 辞書ファイルが大きすぎてpushできない
```
remote: error: File dict/base.dat.gz is XXX MB; this exceeds GitHub's file size limit of 100.00 MB
```

単一ファイルが100MBを超える場合。通常のkuromoji辞書は各数MBなので発生しないはずですが、もし出たらGit LFSを検討：

```bash
brew install git-lfs
cd pwa-app
git lfs install
git lfs track "dict/*.dat.gz"
git add .gitattributes
git add dict/
git commit -m "Use Git LFS for dict files"
git push
```

### キャッシュを強制クリアしたい（開発時）
ブラウザのDevTools → Application → Service Workers → Unregister
→ Storage → Clear site data
