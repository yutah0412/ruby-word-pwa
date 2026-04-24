/**
 * Electron API Shim for PWA
 * =========================
 * Electron版の window.electronAPI をブラウザAPIで再現する互換レイヤー。
 * 既存の Electron 版モジュール（app.js, settings.js, history.js 等）を
 * ほぼそのまま動作させるためのブリッジ。
 *
 * 主な差分：
 *   - ファイルシステムアクセス → File API / Blob
 *   - ダイアログ → <input type="file"> / ドラッグ&ドロップ
 *   - userData ストレージ → localStorage + IndexedDB
 *   - kuromoji 辞書 → fetch() で ./dict/ から取得
 *   - ファイル出力 → ブラウザダウンロード
 *   - history 内「ファイルを開く」→ 無効（ブラウザからローカルファイルは開けない）
 */

(function() {
  'use strict';

  // ──────────────────────────────────────────────────
  // ローカルストレージベースのsettings/history永続化
  // ──────────────────────────────────────────────────
  const STORAGE_KEYS = {
    settings: 'rubyword.pwa.settings',
    history: 'rubyword.pwa.history',
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Failed to load', key, e);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Failed to save', key, e);
      throw e;
    }
  }

  // ──────────────────────────────────────────────────
  // 選択中ファイルの一時ストア
  // Electron版ではファイルパス(string)をやり取りしていたが、
  // PWAでは File オブジェクトを一時的にキャッシュして
  // 仮想的な「パス」で参照する。
  // ──────────────────────────────────────────────────
  const FILE_STORE = new Map(); // virtualPath -> File
  let fileIdCounter = 0;

  function registerFile(file) {
    const id = ++fileIdCounter;
    const vpath = `pwa://file/${id}/${file.name}`;
    FILE_STORE.set(vpath, file);
    return vpath;
  }

  function getFile(vpath) {
    return FILE_STORE.get(vpath);
  }

  // <input type="file"> をクリックで起動
  function pickFiles(opts = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (opts.multiple !== false) input.multiple = true;
      input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      input.style.display = 'none';

      input.onchange = () => {
        const paths = [];
        for (const f of input.files) {
          paths.push(registerFile(f));
        }
        resolve(paths);
        document.body.removeChild(input);
      };

      // ユーザーがキャンセルした場合のフォールバック
      input.oncancel = () => {
        resolve([]);
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  // ──────────────────────────────────────────────────
  // kuromoji 辞書の取得
  // ./dict/*.dat.gz からfetchで直接取得
  // ──────────────────────────────────────────────────
  const DICT_BASE = './dict/';

  async function readDictFile(fileName) {
    const url = DICT_BASE + fileName;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`辞書ファイルの取得に失敗: ${fileName} (${res.status})`);
    }
    return await res.arrayBuffer();
  }

  // ──────────────────────────────────────────────────
  // ファイル書き出し：ブラウザダウンロードとして保存
  // ──────────────────────────────────────────────────
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  // ──────────────────────────────────────────────────
  // CSV エスケープ（settings export用）
  // ──────────────────────────────────────────────────
  function csvEscape(s) {
    if (s == null) return '';
    s = String(s);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function parseCSV(text) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (ch === '"') { inQuotes = false; i++; continue; }
        field += ch; i++;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { cur.push(field); field = ''; i++; continue; }
        if (ch === '\n' || ch === '\r') {
          cur.push(field); field = '';
          if (cur.length > 0 && !(cur.length === 1 && cur[0] === '')) rows.push(cur);
          cur = [];
          if (ch === '\r' && text[i + 1] === '\n') i += 2;
          else i++;
          continue;
        }
        field += ch; i++;
      }
    }
    if (field !== '' || cur.length > 0) {
      cur.push(field);
      if (!(cur.length === 1 && cur[0] === '')) rows.push(cur);
    }
    return rows;
  }

  // ──────────────────────────────────────────────────
  // electronAPI 互換実装
  // ──────────────────────────────────────────────────
  window.electronAPI = {
    // ----- 辞書 -----
    getDictPath: async () => DICT_BASE,
    readDictFile: readDictFile,

    // ----- ファイルダイアログ -----
    openFileDialog: async (options = {}) => {
      // folder選択はWebでは使えない → 空配列を返す
      if (options.folder) {
        alert('Web版ではフォルダ選択はできません。複数ファイルを直接ドロップまたは選択してください。');
        return [];
      }
      return await pickFiles();
    },

    pickOutputFolder: async () => {
      alert('Web版では出力先フォルダの指定はできません。ブラウザのダウンロードフォルダに保存されます。');
      return null;
    },

    listDocxInFolder: async (folder, recursive) => {
      // フォルダパス取得不可 → 空
      return [];
    },

    // ----- ファイルI/O -----
    readFile: async (filePath) => {
      const file = getFile(filePath);
      if (!file) throw new Error('ファイルが見つかりません: ' + filePath);
      const buffer = await file.arrayBuffer();
      return {
        buffer: buffer,
        name: file.name,
        size: file.size,
      };
    },

    writeFile: async (filePath, data) => {
      // Web版ではダウンロードとして保存
      const filename = filePath.split('/').pop() || 'output.docx';
      const blob = new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      downloadBlob(blob, filename);
      return true;
    },

    computeOutputPath: async (inputPath, outputDir) => {
      // ファイル名だけ生成して返す
      const file = getFile(inputPath);
      const baseName = file ? file.name.replace(/\.docx$/i, '') : 'output';
      return `${baseName}_ルビ付き.docx`;
    },

    // ----- OS連携（Web版では無効） -----
    showInFolder: async (filePath) => {
      alert('Web版ではフォルダ表示機能は使えません。\nダウンロードフォルダをご確認ください。');
      return true;
    },

    openFile: async (filePath) => {
      alert('Web版では履歴からのファイル直接オープンはできません。\nファイルをもう一度ドロップしてください。');
      return true;
    },

    // ----- アプリ情報 -----
    getAppInfo: async () => ({
      version: '1.0.0-pwa',
      platform: navigator.platform || 'web',
      arch: navigator.userAgent.includes('ARM') ? 'arm64' : 'x64',
      isPackaged: true,
      userDataPath: '(localStorage)',
    }),

    // ----- 設定（localStorage使用） -----
    loadSettings: async () => {
      const DEFAULT = {
        exclusions: [],
        customDict: [],
        options: { katakana: false, skipKana: false },
      };
      const s = loadJson(STORAGE_KEYS.settings, DEFAULT);
      return {
        exclusions: s.exclusions || [],
        customDict: s.customDict || [],
        options: { ...DEFAULT.options, ...(s.options || {}) },
      };
    },

    saveSettings: async (settings) => {
      return saveJson(STORAGE_KEYS.settings, settings);
    },

    // ----- 設定 Import/Export -----
    exportSettings: async ({ kind, format, data }) => {
      const defaultNameBase = kind === 'exclusions' ? '除外リスト'
                            : kind === 'customDict' ? 'カスタム辞書'
                            : 'ルビ振り設定';
      const ext = format === 'csv' ? 'csv' : 'json';
      const filename = `${defaultNameBase}.${ext}`;

      let content;
      let mimeType;
      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
      } else {
        mimeType = 'text/csv';
        if (kind === 'exclusions') {
          const header = '単語';
          const rows = (data || []).map(csvEscape);
          content = [header, ...rows].join('\n');
        } else if (kind === 'customDict') {
          const header = '単語,読み,カテゴリ';
          const rows = (data || []).map(entry =>
            [entry.word, entry.reading, entry.category || '']
              .map(csvEscape).join(',')
          );
          content = [header, ...rows].join('\n');
        } else {
          content = JSON.stringify(data, null, 2);
        }
      }

      const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
      downloadBlob(blob, filename);
      return filename;
    },

    importSettings: async ({ kind }) => {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv';
        input.style.display = 'none';

        input.onchange = async () => {
          const file = input.files[0];
          document.body.removeChild(input);
          if (!file) {
            resolve(null);
            return;
          }
          try {
            const text = await file.text();
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'json') {
              resolve({ format: 'json', data: JSON.parse(text) });
            } else {
              resolve({ format: 'csv', data: parseCSV(text), kind });
            }
          } catch (e) {
            reject(new Error('ファイルの解析に失敗しました: ' + e.message));
          }
        };

        input.oncancel = () => {
          resolve(null);
          if (document.body.contains(input)) document.body.removeChild(input);
        };

        document.body.appendChild(input);
        input.click();
      });
    },

    showSettingsLocation: async () => {
      alert('Web版の設定はブラウザのローカルストレージに保存されています。\n'
          + 'DevToolsの Application → Local Storage で確認できます。');
      return '(localStorage)';
    },

    // ----- 履歴（localStorage使用） -----
    loadHistory: async () => {
      return loadJson(STORAGE_KEYS.history, []);
    },

    saveHistory: async (history) => {
      if (!Array.isArray(history)) throw new Error('history must be an array');
      const trimmed = history.slice(0, 50);
      return saveJson(STORAGE_KEYS.history, trimmed);
    },

    checkFilesExist: async (paths) => {
      // Web版ではファイルの存続確認ができない。
      // 仮想パスが FILE_STORE に存在するかで判定（= セッション内で読んだファイル）
      const result = {};
      for (const p of paths || []) {
        result[p] = FILE_STORE.has(p);
      }
      return result;
    },
  };

  // PWA判定：standaloneモードで起動しているか
  window.isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                 window.navigator.standalone === true;

  // ドロップされたFileをシム経由で登録する公開ヘルパー
  window.__pwaRegisterDroppedFiles = function(files) {
    const paths = [];
    for (const f of files) {
      if (f && f.name && f.name.toLowerCase().endsWith('.docx')) {
        paths.push(registerFile(f));
      }
    }
    return paths;
  };

  console.log('[PWA] electronAPI shim installed');
})();
