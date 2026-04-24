/**
 * Settings UI controller
 * - Manages the Exclusions and Custom Dictionary tabs
 * - Auto-saves to disk on every change
 * - Syncs with RubyEngine via setUserSettings()
 */

window.SettingsManager = (function() {
  const $ = id => document.getElementById(id);

  const state = {
    exclusions: [],        // array of kanji (string)
    customDict: [],        // array of { word, reading, category }
    options: {},
    filterCategory: 'all',
    searchQuery: '',
  };

  let saveTimer = null;

  // ===== Persistence =====
  async function load() {
    try {
      const s = await window.electronAPI.loadSettings();

      // Exclusions: filter out non-string and non-kanji-containing entries.
      // This provides compatibility with older saves (single-char list)
      // and safely ignores any garbage.
      const rawEx = Array.isArray(s.exclusions) ? s.exclusions : [];
      state.exclusions = [];
      const seen = new Set();
      for (const item of rawEx) {
        if (typeof item !== 'string') continue;
        const w = item.trim();
        if (!w || !containsKanji(w)) continue;
        if (seen.has(w)) continue;
        seen.add(w);
        state.exclusions.push(w);
      }
      // Sort: compounds first, then single chars
      state.exclusions.sort((a, b) => b.length - a.length || a.localeCompare(b, 'ja'));

      state.customDict = Array.isArray(s.customDict) ? s.customDict : [];
      state.options = s.options || {};
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    syncToEngine();
    renderExclusions();
    renderCustomDict();
    updateCounts();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save().catch(e => console.error('Auto-save failed:', e));
    }, 300);
  }

  async function save() {
    await window.electronAPI.saveSettings({
      exclusions: state.exclusions,
      customDict: state.customDict,
      options: state.options,
    });
    syncToEngine();
  }

  function syncToEngine() {
    if (window.RubyEngine && window.RubyEngine.setUserSettings) {
      window.RubyEngine.setUserSettings({
        exclusions: state.exclusions,
        customDict: state.customDict,
      });
    }
  }

  // ===== Exclusions =====

  /**
   * Add one or more exclusion entries from input text.
   * Supports:
   *   - Multi-line input: each line is one word
   *   - Comma/space-separated input on a single line
   *   - Single entry
   * Entries must contain at least one kanji; pure hiragana/katakana are rejected.
   */
  function addExclusions(text) {
    if (!text) return 0;

    // Split by newlines, commas, or whitespace (but preserve full words)
    const candidates = text
      .split(/[\n,、，\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let added = 0;
    for (const word of candidates) {
      // Must contain at least one kanji
      if (!containsKanji(word)) continue;
      // Dedupe
      if (state.exclusions.includes(word)) continue;
      state.exclusions.push(word);
      added++;
    }

    if (added > 0) {
      // Keep the list sorted: longer entries first (helpful visual grouping)
      state.exclusions.sort((a, b) => b.length - a.length || a.localeCompare(b, 'ja'));
      scheduleSave();
      renderExclusions();
      updateCounts();
    }
    return added;
  }

  function removeExclusion(word) {
    state.exclusions = state.exclusions.filter(k => k !== word);
    scheduleSave();
    renderExclusions();
    updateCounts();
  }

  function renderExclusions() {
    const list = $('exList');
    if (state.exclusions.length === 0) {
      list.innerHTML = '<div class="empty-state">登録された単語はまだありません</div>';
      return;
    }

    // Group by compound vs single, compounds first
    const compounds = state.exclusions.filter(w => w.length > 1);
    const singles = state.exclusions.filter(w => w.length === 1);

    let html = '';
    if (compounds.length > 0) {
      html += `<div class="ex-group-label">熟語・複合語 <span class="ex-group-count">${compounds.length}</span></div>`;
      html += compounds.map(w => renderExclusionRow(w, 'compound')).join('');
    }
    if (singles.length > 0) {
      if (compounds.length > 0) html += '<div class="ex-group-spacer"></div>';
      html += `<div class="ex-group-label">単漢字 <span class="ex-group-count">${singles.length}</span></div>`;
      html += singles.map(w => renderExclusionRow(w, 'single')).join('');
    }

    list.innerHTML = html;
    list.querySelectorAll('[data-remove-ex]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeExclusion(btn.dataset.removeEx);
      });
    });
  }

  function renderExclusionRow(word, kind) {
    return `
      <div class="ex-row ex-row-${kind}">
        <span class="ex-row-word">${escapeHtml(word)}</span>
        <span class="ex-row-meta">${word.length}文字</span>
        <button class="ex-row-remove" data-remove-ex="${escapeAttr(word)}" title="削除">×</button>
      </div>
    `;
  }

  function containsKanji(str) {
    for (const ch of str) if (isKanji(ch)) return true;
    return false;
  }

  // ===== Custom Dict =====
  function addCustomEntry(word, reading, category) {
    word = (word || '').trim();
    reading = (reading || '').trim();
    category = (category || 'その他').trim();
    if (!word || !reading) return { ok: false, error: '単語と読みは必須です' };

    // Reading must be hiragana (allow katakana too for flexibility)
    if (!/^[\u3040-\u30ff\u30fc]+$/.test(reading)) {
      return { ok: false, error: '読みはひらがなまたはカタカナで入力してください' };
    }

    // Update or add
    const existingIdx = state.customDict.findIndex(e => e.word === word);
    if (existingIdx >= 0) {
      state.customDict[existingIdx] = { word, reading, category };
    } else {
      state.customDict.push({ word, reading, category });
    }
    scheduleSave();
    renderCustomDict();
    updateCounts();
    return { ok: true, updated: existingIdx >= 0 };
  }

  function removeCustomEntry(word) {
    state.customDict = state.customDict.filter(e => e.word !== word);
    scheduleSave();
    renderCustomDict();
    updateCounts();
  }

  function renderCustomDict() {
    const list = $('cdList');
    let filtered = state.customDict;

    if (state.filterCategory !== 'all') {
      filtered = filtered.filter(e => e.category === state.filterCategory);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.word.toLowerCase().includes(q) ||
        e.reading.toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      const msg = state.customDict.length === 0
        ? '登録された単語はまだありません'
        : '該当する単語がありません';
      list.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }

    list.innerHTML = filtered.map(e => `
      <div class="cd-item">
        <span class="cd-item-word" title="${escapeAttr(e.word)}">${escapeHtml(e.word)}</span>
        <span class="cd-item-reading" title="${escapeAttr(e.reading)}">${escapeHtml(e.reading)}</span>
        <span class="cd-item-category cat-${escapeAttr(e.category)}">${escapeHtml(e.category)}</span>
        <button class="cd-item-remove" data-remove-cd="${escapeAttr(e.word)}" title="削除">×</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-remove-cd]').forEach(btn => {
      btn.addEventListener('click', () => removeCustomEntry(btn.dataset.removeCd));
    });
  }

  function updateCounts() {
    $('exCount').textContent = state.exclusions.length;
    $('cdCount').textContent = state.customDict.length;
  }

  // ===== Import / Export =====
  async function exportExclusions(format) {
    try {
      const filePath = await window.electronAPI.exportSettings({
        kind: 'exclusions',
        format,
        data: state.exclusions,
      });
      if (filePath) showToast(`エクスポートしました: ${filePath}`, 'success');
    } catch (e) {
      showToast('エクスポートに失敗しました: ' + e.message, 'error');
    }
  }

  async function exportCustomDict(format) {
    try {
      const filePath = await window.electronAPI.exportSettings({
        kind: 'customDict',
        format,
        data: state.customDict,
      });
      if (filePath) showToast(`エクスポートしました: ${filePath}`, 'success');
    } catch (e) {
      showToast('エクスポートに失敗しました: ' + e.message, 'error');
    }
  }

  async function importExclusions() {
    try {
      const result = await window.electronAPI.importSettings({ kind: 'exclusions' });
      if (!result) return;

      let imported = [];
      if (result.format === 'json') {
        // Accept either array of strings OR object with exclusions field
        if (Array.isArray(result.data)) imported = result.data;
        else if (Array.isArray(result.data.exclusions)) imported = result.data.exclusions;
      } else {
        // CSV: one column per row, may have header "単語" or "漢字"
        const rows = result.data;
        for (const row of rows) {
          const cell = (row[0] || '').trim();
          if (!cell) continue;
          if (cell === '単語' || cell === '漢字') continue; // header
          imported.push(cell);
        }
      }

      let added = 0;
      for (const word of imported) {
        if (typeof word !== 'string') continue;
        const w = word.trim();
        if (!w || !containsKanji(w)) continue;
        if (state.exclusions.includes(w)) continue;
        state.exclusions.push(w);
        added++;
      }
      if (added > 0) {
        state.exclusions.sort((a, b) => b.length - a.length || a.localeCompare(b, 'ja'));
        scheduleSave();
        renderExclusions();
        updateCounts();
      }
      showToast(`${added} 件の単語をインポートしました`, 'success');
    } catch (e) {
      showToast('インポートに失敗しました: ' + e.message, 'error');
    }
  }

  async function importCustomDict() {
    try {
      const result = await window.electronAPI.importSettings({ kind: 'customDict' });
      if (!result) return;

      let entries = [];
      if (result.format === 'json') {
        if (Array.isArray(result.data)) entries = result.data;
        else if (Array.isArray(result.data.customDict)) entries = result.data.customDict;
      } else {
        // CSV: word, reading, category (optional header)
        const rows = result.data;
        for (const row of rows) {
          if (!row[0] || !row[1]) continue;
          if (row[0] === '単語' && row[1] === '読み') continue; // header
          entries.push({
            word: row[0],
            reading: row[1],
            category: row[2] || 'その他',
          });
        }
      }

      let added = 0, updated = 0, skipped = 0;
      for (const e of entries) {
        const r = addCustomEntry(e.word, e.reading, e.category);
        if (r.ok) {
          if (r.updated) updated++;
          else added++;
        } else {
          skipped++;
        }
      }
      showToast(`${added} 件追加 / ${updated} 件更新${skipped ? ` / ${skipped} 件スキップ` : ''}`, 'success');
    } catch (e) {
      showToast('インポートに失敗しました: ' + e.message, 'error');
    }
  }

  // ===== Helpers =====
  function isKanji(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9fff) ||
           (code >= 0x3400 && code <= 0x4dbf) ||
           (code >= 0xf900 && code <= 0xfaff);
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function showToast(msg, kind) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'toast ' + (kind || '') + ' show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // ===== UI binding =====
  function bind() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`);
        if (panel) panel.classList.add('active');
      });
    });

    // Exclusions
    $('exAddBtn').addEventListener('click', () => {
      const input = $('exInput');
      const added = addExclusions(input.value);
      input.value = '';
      input.focus();
      if (added === 0) showToast('追加する漢字が見つかりません', 'error');
      else showToast(`${added} 文字を追加しました`, 'success');
    });
    $('exInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('exAddBtn').click();
    });
    $('exImportBtn').addEventListener('click', importExclusions);
    $('exExportJsonBtn').addEventListener('click', () => exportExclusions('json'));
    $('exExportCsvBtn').addEventListener('click', () => exportExclusions('csv'));

    // Custom dict
    $('cdAddBtn').addEventListener('click', () => {
      const w = $('cdWordInput').value;
      const r = $('cdReadingInput').value;
      const c = $('cdCategoryInput').value;
      const result = addCustomEntry(w, r, c);
      if (result.ok) {
        $('cdWordInput').value = '';
        $('cdReadingInput').value = '';
        $('cdWordInput').focus();
        showToast(result.updated ? '単語を更新しました' : '単語を追加しました', 'success');
      } else {
        showToast(result.error, 'error');
      }
    });
    $('cdReadingInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('cdAddBtn').click();
    });
    $('cdWordInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('cdReadingInput').focus();
    });

    $('cdSearch').addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderCustomDict();
    });
    document.querySelectorAll('.cd-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cd-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filterCategory = btn.dataset.cat;
        renderCustomDict();
      });
    });

    $('cdImportBtn').addEventListener('click', importCustomDict);
    $('cdExportJsonBtn').addEventListener('click', () => exportCustomDict('json'));
    $('cdExportCsvBtn').addEventListener('click', () => exportCustomDict('csv'));

    // Footer
    $('showSettingsLocation').addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI.showSettingsLocation();
    });
  }

  return {
    init: async function() {
      bind();
      await load();
    },
    getState: () => ({ ...state }),
    showToast,
    addCustomEntry,   // exposed for unknown-word scanner flow
    addExclusions,    // exposed for bulk operations
  };
})();
