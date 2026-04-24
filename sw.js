/**
 * Service Worker for ルビ振りWord PWA
 * ==================================
 * 完全オフライン動作のため、初回アクセス時に全リソース（辞書含む）を
 * キャッシュし、2回目以降はネット不要で動作する。
 *
 * 戦略：
 *   - install時：コアファイル（HTML/CSS/JS）を事前キャッシュ
 *   - fetch時：stale-while-revalidate（キャッシュ優先、裏で更新）
 *   - 辞書ファイル（./dict/*.dat.gz）：初回fetch時にキャッシュ追加
 */

const VERSION = 'v1.0.0';
const CACHE_NAME = `rubyword-pwa-${VERSION}`;

// install時に事前キャッシュするコアファイル
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './themes.css',
  './manifest.json',
  './js/electron-api-shim.js',
  './js/theme.js',
  './js/ruby-engine.js',
  './js/docx-processor.js',
  './js/settings.js',
  './js/history.js',
  './js/kanji-readings.js',
  './js/unknown-scanner.js',
  './js/app.js',
  // 外部ライブラリ（CDN or 同梱）
  './vendor/jszip.min.js',
  './vendor/kuromoji.js',
  // 辞書ファイル（完全オフラインのため初回で全キャッシュ）
  './dict/base.dat.gz',
  './dict/cc.dat.gz',
  './dict/check.dat.gz',
  './dict/tid.dat.gz',
  './dict/tid_map.dat.gz',
  './dict/tid_pos.dat.gz',
  './dict/unk.dat.gz',
  './dict/unk_char.dat.gz',
  './dict/unk_compat.dat.gz',
  './dict/unk_invoke.dat.gz',
  './dict/unk_map.dat.gz',
  './dict/unk_pos.dat.gz',
  // アイコン
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ──────────────────────────────────────────────────
// install: プリキャッシュ
// ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 辞書は大きいので個別にキャッシュして、失敗してもinstall自体は成功させる
      const results = await Promise.allSettled(
        CORE_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to precache:', url, err.message);
            throw err;
          })
        )
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[SW] Precache: ${results.length - failed}/${results.length} OK`);
      // 即座にアクティブ化
      return self.skipWaiting();
    })
  );
});

// ──────────────────────────────────────────────────
// activate: 古いキャッシュを削除
// ──────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate', VERSION);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Delete old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────
// fetch: cache-first strategy
// ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // GETのみ
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 同一オリジンのみキャッシュ対象（chrome-extension:// などは除外）
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // キャッシュヒット → 裏で更新しつつ即返却（stale-while-revalidate）
        event.waitUntil(
          fetch(event.request).then((res) => {
            if (res && res.ok) {
              caches.open(CACHE_NAME).then(c => c.put(event.request, res));
            }
          }).catch(() => {})
        );
        return cached;
      }
      // 未キャッシュ → ネット取得 → キャッシュに保存
      return fetch(event.request).then((res) => {
        if (!res || !res.ok || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch((err) => {
        // ネットもない場合：HTMLなら index.html を返す
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        throw err;
      });
    })
  );
});

// ──────────────────────────────────────────────────
// message: キャッシュクリア等の操作
// ──────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0] && event.ports[0].postMessage({ ok: true });
    });
  }
});
