# ルビ振りWord PWA 版

Wordファイル（.docx）の漢字にふりがなを自動で振るProgressive Web App（PWA）。
完全オフライン動作、インストール可能、macOS/Windows/iOS/Androidで動作します。

## 🚀 使い方

### ブラウザで使う
1. https://yutah0412.github.io/ruby-word-pwa/ にアクセス
2. .docx ファイルをドラッグ&ドロップ
3. 「ルビを振って保存」をクリック
4. ダウンロードフォルダに結果が保存されます

### デスクトップアプリとしてインストール（PWA）
1. Chrome / Edge / Safari で上記URLにアクセス
2. アドレスバー右の「インストール」アイコン（⊕）をクリック
3. または「App を追加」（Safari）
4. 以降はLaunchpad/タスクバーから起動できます

## 📂 ディレクトリ構成

```
pwa-app/
├── index.html              メインHTML
├── manifest.json           PWAマニフェスト
├── sw.js                   Service Worker（完全オフライン用）
├── styles.css / themes.css スタイル
├── js/
│   ├── electron-api-shim.js  ElectronAPI互換レイヤー
│   ├── app.js               メインアプリロジック
│   ├── ruby-engine.js       kuromoji ラッパー
│   ├── docx-processor.js    .docx XML 操作
│   ├── settings.js          除外リスト・カスタム辞書
│   ├── history.js           処理履歴
│   ├── theme.js             テーマ切替
│   ├── kanji-readings.js    漢字音訓DB
│   └── unknown-scanner.js   未知語スキャン
├── vendor/                  ← ★要セットアップ
│   ├── jszip.min.js
│   └── kuromoji.js
├── dict/                    ← ★要セットアップ（kuromoji辞書）
│   └── *.dat.gz
└── icons/
    ├── icon.svg
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

## 🛠 初回セットアップ

### STEP 1: vendor ライブラリをコピー

```bash
cd pwa-app
mkdir -p vendor

# jszip を配置
cp ../electron-app/node_modules/jszip/dist/jszip.min.js vendor/

# kuromoji を配置
cp ../electron-app/node_modules/kuromoji/build/kuromoji.js vendor/
```

### STEP 2: 辞書ファイルをコピー（kuromoji 用）

```bash
mkdir -p dict
cp ../electron-app/node_modules/kuromoji/dict/*.dat.gz dict/
```

配置後、`dict/` には以下の12ファイルが入ります（約12MB）：
- base.dat.gz, cc.dat.gz, check.dat.gz
- tid.dat.gz, tid_map.dat.gz, tid_pos.dat.gz
- unk.dat.gz, unk_char.dat.gz, unk_compat.dat.gz
- unk_invoke.dat.gz, unk_map.dat.gz, unk_pos.dat.gz

### STEP 3: PNGアイコンを生成

`icons/icon.svg` は既に用意済み。PNG版を作成するには：

**方法A: macOS標準の sips コマンド（要：一度PDFに変換）**
```bash
cd icons
# SVG → PDF → PNG（要rsvg-convert または ImageMagick）
# 代替: ブラウザでicon.svgを開いてスクショ
```

**方法B: オンラインツール（簡単）**
1. https://cloudconvert.com/svg-to-png にアクセス
2. `icons/icon.svg` をアップロード
3. サイズを 192x192, 512x512 にして変換
4. ダウンロードして `icons/` に配置：
   - `icon-192.png`
   - `icon-512.png`
   - `icon-maskable-512.png`（512をそのまま流用でもOK）

**方法C: ImageMagick**
```bash
brew install imagemagick librsvg
cd icons
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
cp icon-512.png icon-maskable-512.png
```

### STEP 4: ローカル動作確認

PWAはhttps必須のため、ローカルでも簡易HTTPサーバーを立てる必要があります。

```bash
cd pwa-app

# Python 3
python3 -m http.server 8000

# Node.js (npx)
npx serve .

# その他：VSCode拡張「Live Server」でも可
```

ブラウザで http://localhost:8000 にアクセスして動作確認。

⚠️ PWA機能（Service Worker、インストール）は `https://` または `localhost` でのみ動作します。
`file://` プロトコルでは動きません。

## 🌐 GitHub Pages デプロイ

`DEPLOY.md` を参照してください。
