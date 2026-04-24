# 🔒 コミット履歴から本名を消す手順

GitHubのコミットに表示されている「Author名」を、**GitHub の noreply メール**に置き換えて、本名を完全に消します。

## 📋 全体の流れ

```
STEP 1  GitHub側で「noreply メール」を有効化
         ↓
STEP 2  noreply メールアドレスを確認
         ↓
STEP 3  ローカル git の user.email を noreply に変更
         ↓
STEP 4  過去のコミット全てを書き換え（git filter-repo）
         ↓
STEP 5  force push で GitHub に上書き
         ↓
STEP 6  GitHub 上で本名が消えたか確認
```

**所要時間**：15〜20分

---

## STEP 1: GitHub で「メール非公開」を有効化

1. GitHub 右上アバター → **Settings**
2. 左メニュー **Emails**
3. **Keep my email addresses private** にチェック ✅
4. **Block command line pushes that expose my email** にもチェック ✅
   - これで間違って本名メールで push しそうになった時にブロックされる

---

## STEP 2: noreply メールアドレスを確認

同じ **Settings → Emails** 画面の上部に、以下のような表記があります：

```
You will receive messages at this email address:
yutah0412@users.noreply.github.com

Your commit email:
<ID>+yutah0412@users.noreply.github.com
```

**「Your commit email」の方を使います。** 形式は：

```
<ID>+<username>@users.noreply.github.com
```

例：`81234567+yutah0412@users.noreply.github.com`

この文字列を**完全にコピー**してメモしてください。

---

## STEP 3: ローカル git の設定を更新

### 今後のコミットが noreply メールになるよう設定

```bash
# グローバル設定（全リポジトリで）
git config --global user.name "yutah0412"
git config --global user.email "81234567+yutah0412@users.noreply.github.com"
#                                ↑ STEP 2 で確認した「Your commit email」を貼り付け

# 確認
git config --global user.name
git config --global user.email
```

---

## STEP 4: 過去のコミットを全て書き換え

### 準備：git filter-repo をインストール

`git filter-branch` は非推奨なので、新しい公式推奨ツール `git filter-repo` を使います。

```bash
# Homebrew でインストール
brew install git-filter-repo

# 確認
git filter-repo --help | head -5
```

Homebrew が無い場合：
```bash
# Python pip でインストール
pip3 install git-filter-repo
```

### 実行：履歴を書き換える

```bash
cd pwa-app

# まず念のためバックアップ（別ディレクトリに丸ごとコピー）
cd ..
cp -R pwa-app pwa-app-backup
cd pwa-app

# ========================================
# 履歴の author/committer を書き換え
# ========================================
# 以下を 1 つの大きなコマンドとして実行
# YOUR_NOREPLY_EMAIL を STEP 2 で取得したnoreply メールに置き換え

git filter-repo --force --commit-callback '
# 旧本名メール → noreplyメールに置換（すべて置換するので古いメールが何でもOK）
commit.author_name = b"yutah0412"
commit.author_email = b"YOUR_NOREPLY_EMAIL"
commit.committer_name = b"yutah0412"
commit.committer_email = b"YOUR_NOREPLY_EMAIL"
'
```

**実行例**（noreplyメールが `81234567+yutah0412@users.noreply.github.com` の場合）：

```bash
git filter-repo --force --commit-callback '
commit.author_name = b"yutah0412"
commit.author_email = b"81234567+yutah0412@users.noreply.github.com"
commit.committer_name = b"yutah0412"
commit.committer_email = b"81234567+yutah0412@users.noreply.github.com"
'
```

### 実行中に出る警告

```
NOTE: Repository appears to be a fresh clone; disabling check to ensure
      it's not used concurrently with other operations.
```

→ 問題なし。続行します。

```
Parsed X commits
HEAD is now at ... Initial PWA commit
```

→ 成功。

---

## STEP 5: GitHub に force push

`filter-repo` は履歴を書き換えたので、GitHub 側も強制上書きが必要です。

```bash
# remote の再確認
git remote -v

# もし remote が消えていたら追加し直し
git remote add origin https://github.com/yutah0412/ruby-word-pwa.git

# force push（重要：--force-with-lease で安全に）
git push --force-with-lease origin main
```

**認証ダイアログが出たら**、以前と同じ Personal Access Token を使います。

---

## STEP 6: GitHub で確認

1. https://github.com/yutah0412/ruby-word-pwa/commits/main にアクセス
2. コミット一覧の各 Author を確認
3. **`yutah0412` のみが表示され、本名が消えている**ことを確認
4. アバターをクリックして本名が出ないことも確認

### 「This commit was unverified」という表示について

noreply メールに切り替えた直後、過去のコミットが「unverified」（未検証）になります。問題ありません。GPG 署名設定をしていない限り、多くのGitHubユーザーがこの状態です。

---

## ⚠️ 注意点

### 既にフォークやクローンされている場合
履歴の書き換えは、**他人のクローンとの整合性を壊します**。
個人リポジトリで他にクローンしている人がいなければ問題ありません。

### ローカルの backup について
成功を確認したら、`pwa-app-backup` は削除して構いません：
```bash
rm -rf ../pwa-app-backup
```

### electron-app 側は？
`electron-app` も git 管理している場合、**同じ手順を繰り返す必要**があります。
ただし、public な GitHub にpushしていないなら、ローカルだけ設定を変えれば十分です。

---

## 🐛 トラブルシューティング

### `git filter-repo: command not found`
```bash
# Homebrewで再インストール
brew install git-filter-repo

# パスを確認
which git-filter-repo
```

### push がエラーになる
```
error: failed to push some refs
```

→ まだ古い状態が GitHub にある場合。`--force` または `--force-with-lease` を忘れずに：
```bash
git push --force-with-lease origin main
```

### 間違えてpushした → やり直したい
```bash
# バックアップから復元
cd ..
rm -rf pwa-app
cp -R pwa-app-backup pwa-app
cd pwa-app

# 再度 filter-repo から実行
```

---

## ✅ 完了チェックリスト

- [ ] GitHub Settings → Emails で「Keep my email addresses private」をON
- [ ] `Your commit email` をコピー（`ID+username@users.noreply.github.com`）
- [ ] `git config --global user.email` を noreply メールに更新
- [ ] `git-filter-repo` をインストール
- [ ] `pwa-app` のバックアップを作成
- [ ] `git filter-repo` で履歴を書き換え
- [ ] `git push --force-with-lease origin main` で GitHub を更新
- [ ] GitHub のコミット一覧で本名が消えていることを確認
- [ ] バックアップを削除（任意）

---

## 💡 今後のプロジェクトのために

### グローバル設定を確認しておく
```bash
# これが noreply メールになっていれば、新しいリポジトリでも自動的に本名が出ない
git config --global user.email
# → 81234567+yutah0412@users.noreply.github.com が出ればOK
```

### ローカルリポジトリ個別の設定
特定のリポジトリだけ別メールを使いたい場合：
```bash
cd some-other-repo
git config user.email "different@example.com"  # このリポジトリのみ
```
