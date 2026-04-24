/**
 * History Manager
 * - Keeps a list of processed files (newest first)
 * - Allows re-processing from history, showing in folder, opening directly
 */

window.HistoryManager = (function() {
  const $ = id => document.getElementById(id);

  const state = {
    entries: [],  // [{ inputPath, outputPath, fileName, rubiedCount, timestamp, theme, options }]
    fileExistenceCache: {},
  };

  let saveTimer = null;

  // ===== Persistence =====
  async function load() {
    try {
      const entries = await window.electronAPI.loadHistory();
      state.entries = Array.isArray(entries) ? entries : [];
    } catch (e) {
      console.error('Failed to load history:', e);
    }
    await checkFileExistence();
    render();
    updateCount();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save().catch(e => console.error('History save failed:', e));
    }, 200);
  }

  async function save() {
    await window.electronAPI.saveHistory(state.entries);
  }

  // ===== Check which files still exist =====
  async function checkFileExistence() {
    const paths = [];
    for (const e of state.entries) {
      if (e.inputPath) paths.push(e.inputPath);
      if (e.outputPath) paths.push(e.outputPath);
    }
    if (paths.length === 0) return;
    try {
      state.fileExistenceCache = await window.electronAPI.checkFilesExist(paths);
    } catch (e) {
      console.warn('File existence check failed:', e);
    }
  }

  // ===== Add entry =====
  function addEntry(entry) {
    // Dedupe: if this exact input+output pair already at the top, just update timestamp
    const newEntry = {
      inputPath: entry.inputPath,
      outputPath: entry.outputPath,
      fileName: entry.fileName,
      rubiedCount: entry.rubiedCount || 0,
      paragraphs: entry.paragraphs || 0,
      timestamp: Date.now(),
      options: entry.options || {},
    };

    // Remove any prior duplicate (same output path)
    state.entries = state.entries.filter(e => e.outputPath !== newEntry.outputPath);
    // Add to front
    state.entries.unshift(newEntry);
    // Cap size
    state.entries = state.entries.slice(0, 50);

    scheduleSave();
    render();
    updateCount();
  }

  function removeEntry(outputPath) {
    state.entries = state.entries.filter(e => e.outputPath !== outputPath);
    scheduleSave();
    render();
    updateCount();
  }

  function clearAll() {
    if (state.entries.length === 0) return;
    if (!confirm('すべての履歴を削除しますか？')) return;
    state.entries = [];
    scheduleSave();
    render();
    updateCount();
  }

  // ===== Render =====
  function render() {
    const list = $('histList');
    if (state.entries.length === 0) {
      list.innerHTML = '<div class="empty-state">まだ履歴はありません</div>';
      return;
    }

    list.innerHTML = state.entries.map(entry => {
      const inputExists = state.fileExistenceCache[entry.inputPath] !== false;
      const outputExists = state.fileExistenceCache[entry.outputPath] !== false;
      const missingClass = !inputExists ? 'history-missing' : '';

      const date = new Date(entry.timestamp);
      const dateStr = formatDate(date);

      return `
        <div class="history-item ${missingClass}" data-out="${escapeAttr(entry.outputPath)}">
          <div class="history-main">
            <div class="history-file">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
                <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
              </svg>
              ${escapeHtml(entry.fileName)}
            </div>
            <div class="history-meta">
              <span>${dateStr}</span>
              <span class="sep">·</span>
              <span><strong>${entry.rubiedCount.toLocaleString()}</strong> 箇所にルビ</span>
              <span class="sep">·</span>
              <span title="${escapeAttr(entry.outputPath)}">${escapeHtml(shortPath(entry.outputPath))}</span>
            </div>
          </div>
          <div class="history-actions">
            ${outputExists ? `
              <button class="history-action" data-act="open" data-path="${escapeAttr(entry.outputPath)}" title="ファイルを開く">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                開く
              </button>
              <button class="history-action" data-act="folder" data-path="${escapeAttr(entry.outputPath)}" title="フォルダで表示">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                フォルダ
              </button>
            ` : ''}
            ${inputExists ? `
              <button class="history-action primary" data-act="reprocess" data-inpath="${escapeAttr(entry.inputPath)}" title="再処理">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                再処理
              </button>
            ` : ''}
            <button class="history-action" data-act="remove" data-path="${escapeAttr(entry.outputPath)}" title="履歴から削除">×</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind action handlers
    list.querySelectorAll('.history-action').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleAction(btn.dataset.act, btn.dataset);
      });
    });
  }

  function updateCount() {
    const el = $('histCount');
    if (el) el.textContent = state.entries.length;
  }

  async function handleAction(act, data) {
    try {
      if (act === 'open') {
        await window.electronAPI.openFile(data.path);
      } else if (act === 'folder') {
        await window.electronAPI.showInFolder(data.path);
      } else if (act === 'reprocess') {
        // Tell app.js to add this file and switch tab
        if (window.App && window.App.loadFilesForReprocess) {
          window.App.loadFilesForReprocess([data.inpath]);
        }
      } else if (act === 'remove') {
        removeEntry(data.path);
      }
    } catch (err) {
      if (window.SettingsManager) {
        window.SettingsManager.showToast('操作に失敗しました: ' + err.message, 'error');
      } else {
        alert('エラー: ' + err.message);
      }
    }
  }

  // ===== Helpers =====
  function formatDate(d) {
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'たった今';
    if (diffMin < 60) return `${diffMin}分前`;
    if (diffHour < 24) return `${diffHour}時間前`;
    if (diffDay < 7) return `${diffDay}日前`;
    // Otherwise full date
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function shortPath(p) {
    if (!p) return '';
    // Show only last 2 segments
    const parts = p.split(/[\\/]/);
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function bind() {
    $('histClearBtn').addEventListener('click', clearAll);
  }

  return {
    init: async function() {
      bind();
      await load();
    },
    addEntry,
    refresh: checkFileExistence,
    render,
  };
})();
