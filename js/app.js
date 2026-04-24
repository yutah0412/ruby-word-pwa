/**
 * Renderer App - Electron version
 * Supports batch file processing, folder drops, configurable output directory.
 */

(function() {
  const $ = id => document.getElementById(id);

  const state = {
    files: [],         // Array of { path, name, size } - paths are absolute on OS
    outputDir: null,
    processing: false,
    results: [],
  };

  // ===== Init =====
  async function init() {
    // Init theme first (async not needed, it's sync)
    if (window.ThemeManager) {
      window.ThemeManager.init();
    }

    bindEvents();
    await showAppInfo();

    // Initialize settings UI (loads exclusions + custom dict from disk)
    if (window.SettingsManager) {
      try {
        await window.SettingsManager.init();
      } catch (e) {
        console.error('Settings init failed:', e);
      }
    }

    // Initialize history
    if (window.HistoryManager) {
      try {
        await window.HistoryManager.init();
      } catch (e) {
        console.error('History init failed:', e);
      }
    }

    loadDictionary();
  }

  async function showAppInfo() {
    try {
      const info = await window.electronAPI.getAppInfo();
      $('appVersion').textContent = `v${info.version} · ${info.platform}`;
    } catch (e) {
      console.warn('Failed to get app info:', e);
    }
  }

  function loadDictionary() {
    setStatus('辞書を準備中…', 'loading');
    RubyEngine.load(msg => setStatus(msg, 'loading'))
      .then(() => {
        setStatus('準備完了', 'ready');
        updateProcessButton();
      })
      .catch(err => {
        console.error(err);
        setStatus('辞書読み込み失敗', 'error');
        alert('辞書の読み込みに失敗しました:\n\n' + (err.message || err));
      });
  }

  function setStatus(text, state) {
    $('statusText').textContent = text;
    const dot = $('statusDot');
    dot.className = 'dot';
    if (state === 'ready') dot.classList.add('ready');
    if (state === 'error') dot.classList.add('error');
    if (state === 'working') dot.classList.add('working');
  }

  // ===== Event binding =====
  function bindEvents() {
    // Pick files
    $('pickFilesBtn').addEventListener('click', async () => {
      const paths = await window.electronAPI.openFileDialog({
        title: 'Wordファイルを選択',
        folder: false,
      });
      await addFiles(paths);
    });

    // Pick folder
    $('pickFolderBtn').addEventListener('click', async () => {
      const paths = await window.electronAPI.openFileDialog({
        title: 'フォルダを選択',
        folder: true,
      });
      if (paths.length > 0) {
        const docxFiles = await window.electronAPI.listDocxInFolder(paths[0], false);
        await addFiles(docxFiles);
      }
    });

    // Output folder
    $('pickOutputBtn').addEventListener('click', async () => {
      const folder = await window.electronAPI.pickOutputFolder();
      if (folder) {
        state.outputDir = folder;
        $('outputDirInput').value = folder;
      }
    });
    $('clearOutputBtn').addEventListener('click', () => {
      state.outputDir = null;
      $('outputDirInput').value = '';
    });

    // Drag & drop
    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(ev => {
      dz.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('drag-over');
      });
    });
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => e.preventDefault());

    dz.addEventListener('drop', async e => {
      // PWA版：File オブジェクトをシム経由で登録し、仮想パスを取得
      const files = [];
      for (const file of e.dataTransfer.files) {
        if (file && file.name && file.name.toLowerCase().endsWith('.docx')) {
          files.push(file);
        }
      }
      if (files.length === 0) return;

      // シムに登録して仮想パスを得る
      const paths = window.__pwaRegisterDroppedFiles
        ? window.__pwaRegisterDroppedFiles(files)
        : [];

      await addFiles(paths);
    });

    $('processBtn').addEventListener('click', processAllFiles);
    $('newBatchBtn').addEventListener('click', resetUI);

    // Preview modal events
    bindPreviewEvents();

    // Unknown word scan modal events
    bindUnknownEvents();

    // Remember the preview ON/OFF choice across sessions
    const savedPreview = localStorage.getItem('rubyword.preview');
    if (savedPreview !== null) {
      $('optPreview').checked = savedPreview === 'true';
    }
    $('optPreview').addEventListener('change', () => {
      localStorage.setItem('rubyword.preview', $('optPreview').checked);
    });

    // Remember other options too (for convenience)
    ['optHiragana', 'optSkipKana', 'optSkipExisting', 'optRubiKatakana', 'optScanUnknown'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const saved = localStorage.getItem('rubyword.' + id);
      if (saved !== null) el.checked = saved === 'true';
      el.addEventListener('change', () => {
        localStorage.setItem('rubyword.' + id, el.checked);
      });
    });
  }

  // ===== File management =====
  async function addFiles(paths) {
    if (!paths || paths.length === 0) return;

    for (const p of paths) {
      // Skip non-docx
      if (!p.toLowerCase().endsWith('.docx')) continue;
      // Dedupe
      if (state.files.some(f => f.path === p)) continue;
      // Read metadata
      try {
        const info = await window.electronAPI.readFile(p);
        state.files.push({ path: p, name: info.name, size: info.size });
      } catch (err) {
        console.warn('Could not read:', p, err);
      }
    }

    renderFileList();
    updateProcessButton();
  }

  function removeFile(path) {
    state.files = state.files.filter(f => f.path !== path);
    renderFileList();
    updateProcessButton();
  }

  function clearFiles() {
    state.files = [];
    renderFileList();
    updateProcessButton();
  }

  function renderFileList() {
    const list = $('fileList');
    if (state.files.length === 0) {
      list.innerHTML = '';
      return;
    }

    const header = `
      <div class="file-list-header">
        <span>選択中のファイル (${state.files.length})</span>
        <button class="file-list-clear" id="clearAllFiles">すべて削除</button>
      </div>
    `;

    const items = state.files.map(f => `
      <div class="file-item" data-path="${escapeAttr(f.path)}">
        <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
        </svg>
        <span class="file-name" title="${escapeAttr(f.path)}">${escapeHtml(f.name)}</span>
        <span class="file-meta">${formatSize(f.size)}</span>
        <button class="file-remove" data-remove="${escapeAttr(f.path)}" title="除外">×</button>
      </div>
    `).join('');

    list.innerHTML = header + items;

    // Wire up remove buttons
    list.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeFile(btn.dataset.remove);
      });
    });
    const clearBtn = $('clearAllFiles');
    if (clearBtn) clearBtn.addEventListener('click', clearFiles);
  }

  function updateProcessButton() {
    const ready = RubyEngine.isReady() && state.files.length > 0 && !state.processing;
    $('processBtn').disabled = !ready;

    const summary = $('queueSummary');
    if (state.files.length === 0) {
      summary.textContent = 'ファイルが選択されていません';
    } else {
      summary.innerHTML = `<strong>${state.files.length}</strong> 個のファイルを処理します`;
    }
  }

  // ===== Processing =====
  async function processAllFiles() {
    if (state.files.length === 0 || !RubyEngine.isReady()) return;

    const wantPreview = $('optPreview').checked;
    const wantScanUnknown = $('optScanUnknown').checked;

    state.processing = true;
    state.results = [];
    updateProcessButton();
    $('progress').classList.remove('hidden');
    $('panel-results').classList.add('hidden');
    setStatus('処理中…', 'working');

    const total = state.files.length;
    const options = {
      katakana: !$('optHiragana').checked,
      skipKana: $('optSkipKana').checked,
      keepExisting: $('optSkipExisting').checked,
      rubyKatakana: $('optRubiKatakana').checked,
    };

    // ===== Stage 0: Unknown word scan (optional) =====
    // Runs BEFORE tokenization so newly-registered words are reflected
    // in the main process.
    if (wantScanUnknown) {
      setStatus('未知語をスキャン中…', 'working');
      setProgress(0, '未知語スキャンの準備');

      try {
        // Gather plain text from all input files first
        const allParagraphs = [];
        for (let i = 0; i < state.files.length; i++) {
          const file = state.files[i];
          setProgress(
            (i / state.files.length) * 100,
            `(${i + 1}/${state.files.length}) ${file.name} をスキャン中…`
          );
          try {
            const fileInfo = await window.electronAPI.readFile(file.path);
            const zip = await DocxProcessor.load(fileInfo.buffer);
            const paragraphs = await DocxProcessor.extractText(zip);
            // Tag each paragraph with the file index so contexts can be traced
            for (const p of paragraphs) allParagraphs.push(p);
          } catch (e) {
            console.warn('Scan skipped for:', file.name, e);
          }
        }

        // Run the scanner
        setProgress(85, '未知語を抽出中…');
        const settings = window.SettingsManager
          ? window.SettingsManager.getState()
          : { customDict: [], exclusions: [] };
        const unknowns = await UnknownScanner.scan(allParagraphs, {
          existingDict: settings.customDict,
          existingExclusions: settings.exclusions,
        });

        $('progress').classList.add('hidden');

        if (unknowns.length > 0) {
          // Show the modal and wait for user action
          const action = await showUnknownModal(unknowns);
          if (action === 'cancel') {
            // User canceled entire flow
            state.processing = false;
            setStatus('準備完了', 'ready');
            updateProcessButton();
            $('progress').classList.add('hidden');
            return;
          }
          // If action === 'proceed', new dictionary entries have been
          // saved via SettingsManager → RubyEngine auto-synced.
        }
        // No unknowns → silently proceed

        $('progress').classList.remove('hidden');
      } catch (err) {
        console.error('Unknown scan failed:', err);
        // Non-fatal: continue to main processing
        $('progress').classList.remove('hidden');
      }
    }

    // Stage 1: convert all files (but don't save yet). Collect zips + stats.
    const converted = []; // { file, zip, stats, outPath } or { file, error }

    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const baseProgress = i / total;
      const fileFraction = 1 / total;

      setProgress(
        baseProgress * 100,
        `(${i + 1}/${total}) ${file.name} を解析中…`
      );

      try {
        const result = await convertOneFile(file, options, (inner, msg) => {
          setProgress(
            (baseProgress + fileFraction * inner) * 100,
            `(${i + 1}/${total}) ${msg}`
          );
        });
        converted.push({ file, ...result });
      } catch (err) {
        console.error('Failed:', file.name, err);
        converted.push({ file, error: err.message || String(err) });
      }
    }

    // Stage 2: if preview mode, show each file sequentially for user approval.
    // Otherwise skip straight to save.
    if (wantPreview) {
      $('progress').classList.add('hidden');
      setStatus('プレビュー確認中…', 'working');

      for (let i = 0; i < converted.length; i++) {
        const item = converted[i];
        if (item.error) continue; // skip failed conversions in preview loop
        const { decision, deletions, edits, additions } = await showPreviewForFile(item, i, converted.length);
        if (decision === 'cancelAll') {
          for (let j = i; j < converted.length; j++) {
            converted[j].userCanceled = true;
          }
          break;
        } else if (decision === 'skip') {
          converted[i].userCanceled = true;
        } else {
          converted[i].deletions = deletions || [];
          converted[i].edits = edits || [];
          converted[i].additions = additions || [];
        }
      }

      $('progress').classList.remove('hidden');
      setStatus('保存中…', 'working');
    }

    // Stage 3: write approved files to disk
    for (let i = 0; i < converted.length; i++) {
      const item = converted[i];
      if (item.error) {
        state.results.push({
          file: item.file,
          success: false,
          error: item.error,
        });
        continue;
      }
      if (item.userCanceled) {
        state.results.push({
          file: item.file,
          success: false,
          error: 'ユーザーによりスキップされました',
          canceled: true,
        });
        continue;
      }

      setProgress((i / converted.length) * 100, `(${i + 1}/${converted.length}) ${item.file.name} を保存中…`);

      try {
        // Apply user edits (reading changes)
        if (item.edits && item.edits.length > 0) {
          await DocxProcessor.applyRubyEdits(item.zip, item.edits);
        }
        // Apply user-marked deletions
        if (item.deletions && item.deletions.length > 0) {
          await DocxProcessor.applyRubyDeletions(item.zip, item.deletions);
        }
        // Apply user additions (new rubies)
        if (item.additions && item.additions.length > 0) {
          await DocxProcessor.applyRubyAdditions(item.zip, item.additions);
        }

        const outPath = await window.electronAPI.computeOutputPath(item.file.path, state.outputDir);
        const blob = await DocxProcessor.save(item.zip);
        const arrayBuffer = await blob.arrayBuffer();
        await window.electronAPI.writeFile(outPath, new Uint8Array(arrayBuffer));

        const addedCount = item.additions ? item.additions.length : 0;
        const deletedCount = item.deletions ? item.deletions.length : 0;
        const effectiveRubyCount = Math.max(0, item.stats.totalRubied - deletedCount + addedCount);

        state.results.push({
          file: item.file,
          success: true,
          outputPath: outPath,
          rubiedCount: effectiveRubyCount,
          paragraphs: item.stats.paragraphs,
          deletedCount,
          addedCount,
          editedCount: item.edits ? item.edits.length : 0,
        });

        // Add to history
        if (window.HistoryManager) {
          window.HistoryManager.addEntry({
            inputPath: item.file.path,
            outputPath: outPath,
            fileName: item.file.name,
            rubiedCount: effectiveRubyCount,
            paragraphs: item.stats.paragraphs,
            options: options,
          });
        }
      } catch (err) {
        state.results.push({
          file: item.file,
          success: false,
          error: err.message || String(err),
        });
      }
    }

    setProgress(100, '完了');
    state.processing = false;
    setStatus('準備完了', 'ready');
    renderResults();
    $('panel-results').classList.remove('hidden');
    updateProcessButton();

    setTimeout(() => $('progress').classList.add('hidden'), 1200);
  }

  /**
   * Convert one file to a rubied docx (in memory), without saving.
   * Returns { zip, stats, originalParagraphs }
   */
  async function convertOneFile(file, options, onInnerProgress) {
    onInnerProgress && onInnerProgress(0.05, `${file.name} を読み込み中`);
    const fileInfo = await window.electronAPI.readFile(file.path);

    onInnerProgress && onInnerProgress(0.15, `${file.name} を解析中`);
    const zip = await DocxProcessor.load(fileInfo.buffer);

    // Extract original text for preview comparison
    const originalParagraphs = await DocxProcessor.extractText(zip);

    const stats = await DocxProcessor.processZip(
      zip,
      RubyEngine,
      options,
      (msg, pct) => {
        onInnerProgress && onInnerProgress(0.2 + pct * 0.75, `${file.name}: ${msg}`);
      }
    );

    onInnerProgress && onInnerProgress(1.0, `${file.name} 完了`);

    return { zip, stats, originalParagraphs };
  }

  function setProgress(pct, msg) {
    $('progressFill').style.width = pct + '%';
    $('progressText').textContent = msg;
  }

  // ===== Preview Modal =====
  // State owned by the preview modal during one invocation:
  let previewState = null;

  /**
   * Show the preview modal for a single converted file.
   * Returns a Promise<'save' | 'skip' | 'cancelAll', deletions>
   */
  function showPreviewForFile(item, index, total) {
    return new Promise((resolve) => {
      previewState = {
        item,
        index,
        total,
        currentView: 'rubied',
        editMode: 'delete', // 'delete' | 'edit' | 'add'

        // Set of "paraIdx:segIdx" keys marked for deletion
        markedDeletions: new Set(),
        // Map of "paraIdx:segIdx" → new reading string (for edits)
        editedReadings: new Map(),
        // Array of { paraIdx, text, ruby, insertBeforeSegIdx } — new rubies to add
        addedRubies: [],

        // Set of currently-selected ruby keys (not yet deleted)
        selection: new Set(),
        // Anchor for shift-click range selection
        lastClickedKey: null,
        resolve,
      };

      // Title + subtitle
      $('previewTitle').textContent = item.file.name;
      $('previewSubtitle').textContent = total > 1
        ? `(${index + 1}/${total}) プレビュー`
        : 'プレビュー';

      // Stats
      const s = item.stats;
      $('previewStats').innerHTML =
        `<strong>${s.totalRubied.toLocaleString()}</strong> 箇所にルビを追加 · ` +
        `<strong>${s.paragraphs.toLocaleString()}</strong> 段落`;

      // Pagination footer (for batch)
      if (total > 1) {
        const remaining = total - index - 1;
        $('previewPagination').innerHTML = remaining > 0
          ? `このファイルを承認すると、次の ${remaining} 件のプレビューへ進みます`
          : '最後のファイルです';
      } else {
        $('previewPagination').innerHTML = '';
      }

      // Save button label
      $('previewSaveLabel').textContent =
        total > 1 && index < total - 1
          ? 'この内容で保存して次へ'
          : 'この内容で保存';

      // Reset view toggle
      document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'rubied');
      });

      // Render preview
      renderPreview('rubied');

      // Show modal
      $('previewModal').classList.remove('hidden');
    });
  }

  function renderPreview(view) {
    const preview = $('previewContent');
    if (!previewState) return;

    const { item } = previewState;
    previewState.currentView = view;

    if (view === 'rubied') {
      preview.classList.add('editable');
      $('editModeBar').style.display = '';
      // Reapply current mode class
      preview.classList.remove('mode-delete', 'mode-edit', 'mode-add');
      preview.classList.add('mode-' + (previewState.editMode || 'delete'));
    } else {
      preview.classList.remove('editable', 'mode-delete', 'mode-edit', 'mode-add');
      $('editModeBar').style.display = 'none';
    }

    if (view === 'original') {
      const paras = item.originalParagraphs || [];
      if (paras.length === 0) {
        preview.innerHTML = '<div class="preview-empty">（本文なし）</div>';
        return;
      }
      preview.innerHTML = paras
        .map(p => `<p>${escapeHtml(p) || '&nbsp;'}</p>`)
        .join('');
      return;
    }

    // Rubied view
    const segs = item.stats && item.stats.previewSegments;
    if (!segs || segs.length === 0) {
      preview.innerHTML = '<div class="preview-empty">（本文なし）</div>';
      return;
    }

    // Build HTML, interleaving added rubies at their insertion points.
    const addedByPara = new Map(); // paraIdx → [addedRuby, ...]
    for (const a of previewState.addedRubies) {
      if (!addedByPara.has(a.paraIdx)) addedByPara.set(a.paraIdx, []);
      addedByPara.get(a.paraIdx).push(a);
    }

    const html = segs.map((paraSegs, paraIdx) => {
      if (!paraSegs || paraSegs.length === 0) return '<p>&nbsp;</p>';
      let rubyCounter = 0;
      const addedHere = (addedByPara.get(paraIdx) || []).slice().sort((a, b) => a.insertBeforeSegIdx - b.insertBeforeSegIdx);
      let addedIdx = 0;

      let parts = [];

      for (const seg of paraSegs) {
        if (seg.ruby) {
          const segIdx = rubyCounter;
          // Inject any added rubies that should come before this seg
          while (addedIdx < addedHere.length && addedHere[addedIdx].insertBeforeSegIdx <= segIdx) {
            const a = addedHere[addedIdx++];
            parts.push(`<ruby class="ruby-added" data-added="${paraIdx}:${rubyCounter}">${escapeHtml(a.text)}<rt>${escapeHtml(a.ruby)}</rt></ruby>`);
          }

          rubyCounter++;
          const key = `${paraIdx}:${segIdx}`;
          const classes = [];
          if (previewState.markedDeletions.has(key)) classes.push('to-delete');
          if (previewState.selection.has(key)) classes.push('selected');

          // Apply edit if present
          const editedReading = previewState.editedReadings.get(key);
          const rubyText = editedReading !== undefined ? editedReading : seg.ruby;
          if (editedReading !== undefined) classes.push('edited');

          const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
          parts.push(`<ruby data-key="${key}"${cls}>${escapeHtml(seg.text)}<rt>${escapeHtml(rubyText)}</rt></ruby>`);
        } else {
          parts.push(escapeHtml(seg.text));
        }
      }

      // Inject any remaining added rubies at the end
      while (addedIdx < addedHere.length) {
        const a = addedHere[addedIdx++];
        parts.push(`<ruby class="ruby-added" data-added="${paraIdx}:${rubyCounter}">${escapeHtml(a.text)}<rt>${escapeHtml(a.ruby)}</rt></ruby>`);
      }

      return `<p>${parts.join('') || '&nbsp;'}</p>`;
    }).join('');

    preview.innerHTML = html;
    $('previewContent').parentElement.scrollTop = 0;

    attachRubyClickHandlers();
    updateSelectionBar();
  }

  function attachRubyClickHandlers() {
    const preview = $('previewContent');
    preview.querySelectorAll('ruby[data-key]').forEach(el => {
      el.addEventListener('click', e => handleRubyClick(e, el));
    });
  }

  function handleRubyClick(e, el) {
    if (!previewState) return;
    const key = el.dataset.key;
    if (!key) return;

    const mode = previewState.editMode;

    // In edit mode: open the edit popup on any ruby click
    if (mode === 'edit') {
      openRubyEditPopup(el, key);
      return;
    }

    // In add mode: ignore ruby clicks (the user should click plain text instead)
    if (mode === 'add') {
      return;
    }

    // Default: delete mode
    const sel = previewState.selection;

    if (e.shiftKey && previewState.lastClickedKey) {
      const allRubies = Array.from($('previewContent').querySelectorAll('ruby[data-key]'));
      const fromIdx = allRubies.findIndex(r => r.dataset.key === previewState.lastClickedKey);
      const toIdx = allRubies.findIndex(r => r.dataset.key === key);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        for (let i = lo; i <= hi; i++) {
          sel.add(allRubies[i].dataset.key);
          allRubies[i].classList.add('selected');
        }
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (sel.has(key)) { sel.delete(key); el.classList.remove('selected'); }
      else { sel.add(key); el.classList.add('selected'); }
      previewState.lastClickedKey = key;
    } else {
      // Plain click: toggle delete mark
      if (previewState.markedDeletions.has(key)) {
        previewState.markedDeletions.delete(key);
        el.classList.remove('to-delete');
      } else {
        previewState.markedDeletions.add(key);
        el.classList.add('to-delete');
        sel.delete(key);
        el.classList.remove('selected');
      }
      previewState.lastClickedKey = key;
    }

    updateSelectionBar();
  }

  // ===== Edit mode & Ruby popup =====
  function setEditMode(mode) {
    if (!previewState) return;
    previewState.editMode = mode;
    const preview = $('previewContent');
    preview.classList.remove('mode-delete', 'mode-edit', 'mode-add');
    preview.classList.add('mode-' + mode);

    document.querySelectorAll('.edit-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update hint text
    const hint = $('editModeHint');
    const hints = {
      delete: 'ルビをクリックで削除マーク（Shift/⌘で複数選択）',
      edit:   'ルビをクリックで読みを編集',
      add:    '本文をドラッグして範囲選択 → ルビを追加',
    };
    hint.textContent = hints[mode] || '';

    // Selection bar only in delete mode
    if (mode !== 'delete') {
      previewState.selection.clear();
      $('previewContent').querySelectorAll('ruby.selected').forEach(el => el.classList.remove('selected'));
    }
    updateSelectionBar();
    hideRubyPopup();
  }

  function openRubyEditPopup(rubyEl, key) {
    const popup = $('rubyPopup');
    const rect = rubyEl.getBoundingClientRect();
    const modalRect = document.querySelector('.modal').getBoundingClientRect();

    // Position relative to the modal (which is the popup's offsetParent)
    const top = rect.bottom - modalRect.top + 6;
    const left = Math.min(
      rect.left - modalRect.left,
      modalRect.width - 290  // keep within modal
    );

    popup.style.top = top + 'px';
    popup.style.left = Math.max(10, left) + 'px';
    popup.classList.remove('hidden');

    // Populate
    const baseText = rubyEl.childNodes[0].textContent;
    const rt = rubyEl.querySelector('rt');
    const currentReading = rt ? rt.textContent : '';

    $('rubyPopupTitle').textContent = 'ルビを編集';
    $('rubyPopupTarget').textContent = baseText;
    $('rubyPopupReading').value = currentReading;
    $('rubyPopupReading').focus();
    $('rubyPopupReading').select();
    $('rubyPopupRemove').classList.remove('hidden');

    // Store context
    popup.dataset.context = JSON.stringify({ type: 'edit', key, baseText });
  }

  function openRubyAddPopup(baseText, paraIdx, insertBeforeSegIdx, rect) {
    const popup = $('rubyPopup');
    const modalRect = document.querySelector('.modal').getBoundingClientRect();

    const top = rect.bottom - modalRect.top + 6;
    const left = Math.min(
      rect.left - modalRect.left,
      modalRect.width - 290
    );
    popup.style.top = top + 'px';
    popup.style.left = Math.max(10, left) + 'px';
    popup.classList.remove('hidden');

    $('rubyPopupTitle').textContent = 'ルビを追加';
    $('rubyPopupTarget').textContent = baseText;
    $('rubyPopupReading').value = '';
    $('rubyPopupReading').focus();
    $('rubyPopupRemove').classList.add('hidden');

    popup.dataset.context = JSON.stringify({ type: 'add', paraIdx, insertBeforeSegIdx, baseText });
  }

  function hideRubyPopup() {
    $('rubyPopup').classList.add('hidden');
  }

  function applyRubyPopup() {
    const popup = $('rubyPopup');
    const ctx = JSON.parse(popup.dataset.context || '{}');
    const reading = $('rubyPopupReading').value.trim();
    if (!reading) {
      if (window.SettingsManager) window.SettingsManager.showToast('読みを入力してください', 'error');
      return;
    }
    if (!/^[\u3040-\u30ff\u30fc]+$/.test(reading)) {
      if (window.SettingsManager) window.SettingsManager.showToast('ひらがな・カタカナで入力してください', 'error');
      return;
    }

    if (ctx.type === 'edit') {
      previewState.editedReadings.set(ctx.key, reading);
      // Remove from deletion if present
      previewState.markedDeletions.delete(ctx.key);
    } else if (ctx.type === 'add') {
      previewState.addedRubies.push({
        paraIdx: ctx.paraIdx,
        insertBeforeSegIdx: ctx.insertBeforeSegIdx,
        text: ctx.baseText,
        ruby: reading,
      });
    }

    hideRubyPopup();
    renderPreview('rubied');
  }

  function removeRubyFromPopup() {
    const popup = $('rubyPopup');
    const ctx = JSON.parse(popup.dataset.context || '{}');
    if (ctx.type === 'edit') {
      previewState.markedDeletions.add(ctx.key);
      previewState.editedReadings.delete(ctx.key);
    }
    hideRubyPopup();
    renderPreview('rubied');
  }

  // Add-mode handler: when the user has selected text in plain content,
  // show a floating "ルビを追加" confirmation
  function handleAddModeSelection() {
    if (!previewState || previewState.editMode !== 'add') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideRubyPopup(); return; }
    const selText = sel.toString();
    if (!selText || selText.length === 0) return;

    // Find the enclosing <p> and ensure the selection is entirely within
    // a plain text region (not inside a ruby element, not crossing paragraphs)
    const range = sel.getRangeAt(0);
    const startP = findAncestorP(range.startContainer);
    const endP = findAncestorP(range.endContainer);
    if (!startP || startP !== endP) {
      return; // skip cross-paragraph or outside-preview selections
    }
    // Check not inside a ruby
    if (findAncestorRuby(range.startContainer) || findAncestorRuby(range.endContainer)) {
      return;
    }

    // Determine the paragraph index from the <p>'s position
    const allPs = Array.from($('previewContent').querySelectorAll('p'));
    const paraIdx = allPs.indexOf(startP);
    if (paraIdx < 0) return;

    // Determine insertBeforeSegIdx: how many rubies come before the selection?
    const rubies = Array.from(startP.querySelectorAll('ruby'));
    let insertBefore = rubies.length;
    for (let i = 0; i < rubies.length; i++) {
      if (range.compareBoundaryPoints(Range.START_TO_START, makeRangeAtNode(rubies[i])) < 0) {
        insertBefore = i;
        break;
      }
    }

    // Use bounding rect of the selection
    const rect = range.getBoundingClientRect();
    openRubyAddPopup(selText, paraIdx, insertBefore, rect);

    // Clear selection so popup input gets focus cleanly
    sel.removeAllRanges();
  }

  function findAncestorP(node) {
    let cur = node.nodeType === 1 ? node : node.parentNode;
    while (cur && cur !== $('previewContent')) {
      if (cur.nodeType === 1 && cur.tagName === 'P') return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  function findAncestorRuby(node) {
    let cur = node.nodeType === 1 ? node : node.parentNode;
    while (cur && cur !== $('previewContent')) {
      if (cur.nodeType === 1 && cur.tagName === 'RUBY') return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  function makeRangeAtNode(node) {
    const r = document.createRange();
    r.selectNode(node);
    return r;
  }

  function updateSelectionBar() {
    if (!previewState) return;
    const count = previewState.selection.size;
    const bar = $('selectionBar');
    $('selCount').textContent = count;
    if (count > 0) bar.classList.remove('hidden');
    else bar.classList.add('hidden');
  }

  function selectAllRubies() {
    if (!previewState) return;
    const preview = $('previewContent');
    preview.querySelectorAll('ruby[data-key]').forEach(el => {
      if (previewState.markedDeletions.has(el.dataset.key)) return;
      previewState.selection.add(el.dataset.key);
      el.classList.add('selected');
    });
    updateSelectionBar();
  }

  function clearSelection() {
    if (!previewState) return;
    previewState.selection.clear();
    $('previewContent').querySelectorAll('ruby.selected').forEach(el => el.classList.remove('selected'));
    updateSelectionBar();
  }

  function deleteSelectedRubies() {
    if (!previewState) return;
    for (const key of previewState.selection) {
      previewState.markedDeletions.add(key);
    }
    previewState.selection.clear();
    // Update UI
    $('previewContent').querySelectorAll('ruby.selected').forEach(el => {
      el.classList.remove('selected');
      el.classList.add('to-delete');
    });
    updateSelectionBar();
  }

  function closePreview(decision) {
    if (!previewState) return;
    const resolve = previewState.resolve;

    const deletions = Array.from(previewState.markedDeletions).map(key => {
      const [paraIdx, segIdx] = key.split(':').map(Number);
      return { paraIdx, segIdx };
    });

    const edits = Array.from(previewState.editedReadings.entries()).map(([key, reading]) => {
      const [paraIdx, segIdx] = key.split(':').map(Number);
      return { paraIdx, segIdx, reading };
    });

    const additions = previewState.addedRubies.slice();

    previewState = null;
    $('previewModal').classList.add('hidden');
    hideRubyPopup();
    resolve({ decision, deletions, edits, additions });
  }

  function bindPreviewEvents() {
    $('previewSaveBtn').addEventListener('click', () => closePreview('save'));

    // Selection bar actions
    $('selAllBtn').addEventListener('click', selectAllRubies);
    $('selClearBtn').addEventListener('click', clearSelection);
    $('selDeleteBtn').addEventListener('click', deleteSelectedRubies);

    // Edit mode tabs
    document.querySelectorAll('.edit-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setEditMode(btn.dataset.mode));
    });

    // Ruby popup events
    $('rubyPopupClose').addEventListener('click', hideRubyPopup);
    $('rubyPopupCancel').addEventListener('click', hideRubyPopup);
    $('rubyPopupApply').addEventListener('click', applyRubyPopup);
    $('rubyPopupRemove').addEventListener('click', removeRubyFromPopup);
    $('rubyPopupReading').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyRubyPopup(); }
      if (e.key === 'Escape') { e.preventDefault(); hideRubyPopup(); }
    });

    // Add mode: listen for text selection
    document.addEventListener('selectionchange', () => {
      if (!previewState || previewState.editMode !== 'add') return;
      // Debounce
      clearTimeout(window._addSelTimer);
      window._addSelTimer = setTimeout(handleAddModeSelection, 200);
    });
    $('previewCancelBtn').addEventListener('click', () => {
      if (!previewState) return;
      // If batch mode with more files, ask if they want to skip only this or cancel all
      const { total, index } = previewState;
      if (total > 1 && index < total - 1) {
        const remaining = total - index;
        const choice = confirm(
          `${remaining} 件のプレビューが残っています。\n\n` +
          'OK：このファイルだけスキップして次へ進む\n' +
          'キャンセル：残りすべてをキャンセル'
        );
        closePreview(choice ? 'skip' : 'cancelAll');
      } else {
        closePreview('cancelAll');
      }
    });
    $('previewClose').addEventListener('click', () => closePreview('cancelAll'));

    // View toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderPreview(btn.dataset.view);
      });
    });

    // Close on backdrop click (but not when clicking inside modal)
    $('previewModal').addEventListener('click', e => {
      if (e.target === $('previewModal')) {
        closePreview('cancelAll');
      }
    });

    // ESC key to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && previewState) {
        closePreview('cancelAll');
      }
    });
  }

  // ===== Results =====
  function renderResults() {
    const list = $('resultList');
    const items = state.results.map(r => {
      if (r.success) {
        const extras = [];
        if (r.deletedCount > 0) extras.push(`<span style="color:var(--warn)">${r.deletedCount}件削除</span>`);
        if (r.editedCount > 0) extras.push(`<span style="color:var(--accent)">${r.editedCount}件編集</span>`);
        if (r.addedCount > 0) extras.push(`<span style="color:var(--ok)">${r.addedCount}件追加</span>`);
        const extraMsg = extras.length ? ' · ' + extras.join(' · ') : '';
        return `
          <div class="result-item success">
            <svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <div class="result-body">
              <div class="result-name">${escapeHtml(r.file.name)}</div>
              <div class="result-meta">${r.rubiedCount.toLocaleString()} 箇所にルビ${extraMsg} · ${escapeHtml(r.outputPath)}</div>
            </div>
            <button class="result-action" data-show="${escapeAttr(r.outputPath)}">場所を開く</button>
          </div>
        `;
      } else if (r.canceled) {
        return `
          <div class="result-item canceled">
            <svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <div class="result-body">
              <div class="result-name">${escapeHtml(r.file.name)}</div>
              <div class="result-meta">スキップされました</div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="result-item error">
            <svg class="result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div class="result-body">
              <div class="result-name">${escapeHtml(r.file.name)}</div>
              <div class="result-meta">エラー: ${escapeHtml(r.error)}</div>
            </div>
          </div>
        `;
      }
    }).join('');

    list.innerHTML = items;

    list.querySelectorAll('[data-show]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.electronAPI.showInFolder(btn.dataset.show);
      });
    });
  }

  function resetUI() {
    state.files = [];
    state.results = [];
    renderFileList();
    $('panel-results').classList.add('hidden');
    $('progress').classList.add('hidden');
    updateProcessButton();
  }

  // ===== Helpers =====
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ===== Unknown Word Scan Modal =====
  let unknownState = null;

  /**
   * Show the unknown-word scan modal.
   * Returns a Promise<'proceed' | 'cancel'>.
   * On 'proceed', any rows the user selected (with valid readings)
   * are appended to the custom dictionary.
   */
  function showUnknownModal(unknowns) {
    return new Promise((resolve) => {
      unknownState = {
        items: unknowns.map((u, i) => ({
          index: i,
          word: u.word,
          category: u.category,
          count: u.count,
          contexts: u.contexts,
          reading: u.reading || '',
          isGuess: !!u.guess,
          selected: !!u.reading, // Pre-select those with a guess
        })),
        filter: 'all',
        resolve,
      };

      // Populate header
      $('unknownStats').innerHTML =
        `<strong>${unknowns.length}</strong> 件の未知語を検出 · ` +
        `<span style="color:var(--ink-3)">推定読みを確認して辞書に登録できます</span>`;
      $('unknownSubtitle').textContent = `処理前スキャン`;

      // Compute category counts
      updateUnknownCounts();

      renderUnknownList();
      $('unknownModal').classList.remove('hidden');
    });
  }

  function updateUnknownCounts() {
    if (!unknownState) return;
    const counts = { all: 0, '人名': 0, '専門用語': 0, 'その他': 0 };
    for (const it of unknownState.items) {
      counts.all++;
      counts[it.category] = (counts[it.category] || 0) + 1;
    }
    document.querySelectorAll('[data-count]').forEach(el => {
      el.textContent = counts[el.dataset.count] || 0;
    });
  }

  function renderUnknownList() {
    if (!unknownState) return;
    const list = $('unknownList');
    const items = filteredUnknownItems();

    if (items.length === 0) {
      list.innerHTML = `
        <div class="unknown-empty">
          <svg class="unknown-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <div class="unknown-empty-title">該当する未知語はありません</div>
          <div class="unknown-empty-desc">別のカテゴリを選ぶか、スキップして処理を続行してください</div>
        </div>
      `;
      updateSelCount();
      return;
    }

    list.innerHTML = items.map(it => {
      const catClass = 'cat-' + it.category;
      const selectedCls = it.selected ? 'selected' : '';
      const checkedCls = it.selected ? 'checked' : '';
      const ctx = it.contexts[0] || '';
      return `
        <div class="unknown-item ${selectedCls}" data-idx="${it.index}">
          <div class="unknown-check ${checkedCls}" data-check="${it.index}"></div>
          <div>
            <div class="unknown-word">${escapeHtml(it.word)}</div>
            <div class="unknown-word-sub">${it.count}箇所</div>
          </div>
          <div class="unknown-cat-chip ${catClass}">${escapeHtml(it.category)}</div>
          <div class="unknown-reading-wrap">
            <span class="unknown-reading-label">読み</span>
            <input type="text" class="unknown-reading-input" data-reading="${it.index}"
                   value="${escapeAttr(it.reading)}"
                   placeholder="ひらがなで入力">
            ${it.isGuess && it.reading ? '<span class="unknown-guess-badge">推定</span>' : '<span class="unknown-guess-badge hidden-badge">推定</span>'}
          </div>
          <div class="unknown-context" title="${escapeAttr(ctx)}">"${escapeHtml(ctx)}"</div>
          <select class="unknown-select" data-cat="${it.index}">
            <option value="人名" ${it.category==='人名'?'selected':''}>人名</option>
            <option value="地名" ${it.category==='地名'?'selected':''}>地名</option>
            <option value="専門用語" ${it.category==='専門用語'?'selected':''}>専門用語</option>
            <option value="固有名詞" ${it.category==='固有名詞'?'selected':''}>固有名詞</option>
            <option value="その他" ${it.category==='その他'?'selected':''}>その他</option>
          </select>
        </div>
      `;
    }).join('');

    // Wire handlers
    list.querySelectorAll('[data-check]').forEach(el => {
      el.addEventListener('click', () => toggleUnknownItem(parseInt(el.dataset.check, 10)));
    });
    list.querySelectorAll('.unknown-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.unknown-reading-input') || e.target.closest('.unknown-select')) return;
        if (e.target.classList.contains('unknown-check')) return;
        toggleUnknownItem(parseInt(row.dataset.idx, 10));
      });
    });
    list.querySelectorAll('[data-reading]').forEach(input => {
      input.addEventListener('input', e => {
        const idx = parseInt(input.dataset.reading, 10);
        const item = unknownState.items[idx];
        if (!item) return;
        item.reading = e.target.value;
        item.isGuess = false; // user edited → no longer guess
        // Toggle guess badge without re-render
        const badge = input.parentElement.querySelector('.unknown-guess-badge');
        if (badge) badge.classList.add('hidden-badge');
        // Auto-select if reading has a value
        if (item.reading.trim() && !item.selected) {
          item.selected = true;
          updateRowVisual(idx);
          updateSelCount();
        }
      });
    });
    list.querySelectorAll('[data-cat]').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(sel.dataset.cat, 10);
        const item = unknownState.items[idx];
        if (!item) return;
        item.category = e.target.value;
        updateUnknownCounts();
      });
    });

    updateSelCount();
  }

  function filteredUnknownItems() {
    if (!unknownState) return [];
    if (unknownState.filter === 'all') return unknownState.items;
    return unknownState.items.filter(it => it.category === unknownState.filter);
  }

  function toggleUnknownItem(idx) {
    if (!unknownState) return;
    const item = unknownState.items[idx];
    if (!item) return;
    item.selected = !item.selected;
    updateRowVisual(idx);
    updateSelCount();
  }

  function updateRowVisual(idx) {
    const row = $('unknownList').querySelector(`.unknown-item[data-idx="${idx}"]`);
    if (!row) return;
    const item = unknownState.items[idx];
    row.classList.toggle('selected', item.selected);
    const check = row.querySelector('.unknown-check');
    if (check) check.classList.toggle('checked', item.selected);
  }

  function updateSelCount() {
    if (!unknownState) return;
    const cnt = unknownState.items.filter(it => it.selected && it.reading.trim()).length;
    $('unknownSelCount').textContent = cnt;
    $('unknownApplyLabel').textContent = cnt > 0
      ? `${cnt}件を辞書に登録して続行`
      : '選択なしで続行';
  }

  function bindUnknownEvents() {
    // Close
    $('unknownClose').addEventListener('click', () => closeUnknownModal('cancel'));
    $('unknownSkipAll').addEventListener('click', () => closeUnknownModal('proceed'));

    // Apply (register selected)
    $('unknownApply').addEventListener('click', async () => {
      if (!unknownState) return;
      const toRegister = unknownState.items.filter(it => it.selected && it.reading.trim());

      if (toRegister.length > 0) {
        // Validate readings
        for (const it of toRegister) {
          if (!/^[\u3040-\u30ff\u30fc]+$/.test(it.reading.trim())) {
            if (window.SettingsManager) {
              window.SettingsManager.showToast(
                `「${it.word}」の読みがひらがな/カタカナではありません`, 'error'
              );
            }
            return;
          }
        }
        // Add each entry through SettingsManager so RubyEngine is synced
        if (window.SettingsManager) {
          let added = 0, updated = 0;
          for (const it of toRegister) {
            const r = window.SettingsManager.addCustomEntry(
              it.word, it.reading.trim(), it.category
            );
            if (r && r.ok) {
              if (r.updated) updated++; else added++;
            }
          }
          window.SettingsManager.showToast(
            `${added}件登録${updated ? ` / ${updated}件更新` : ''}しました`, 'success'
          );
        }
      }
      closeUnknownModal('proceed');
    });

    // Select all / none
    $('unknownSelectAll').addEventListener('click', () => {
      if (!unknownState) return;
      for (const it of filteredUnknownItems()) {
        if (it.reading.trim()) it.selected = true;
      }
      renderUnknownList();
    });
    $('unknownSelectNone').addEventListener('click', () => {
      if (!unknownState) return;
      for (const it of filteredUnknownItems()) it.selected = false;
      renderUnknownList();
    });

    // Category tabs
    document.querySelectorAll('.unknown-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!unknownState) return;
        document.querySelectorAll('.unknown-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        unknownState.filter = btn.dataset.cat;
        renderUnknownList();
      });
    });

    // Backdrop click
    $('unknownModal').addEventListener('click', e => {
      if (e.target === $('unknownModal')) {
        closeUnknownModal('cancel');
      }
    });

    // ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && unknownState) {
        closeUnknownModal('cancel');
      }
    });
  }

  function closeUnknownModal(decision) {
    if (!unknownState) return;
    const resolve = unknownState.resolve;
    unknownState = null;
    $('unknownModal').classList.add('hidden');
    // Reset category tab to "all"
    document.querySelectorAll('.unknown-cat').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === 'all');
    });
    resolve(decision);
  }

  // ===== Public API for other modules =====
  window.App = {
    async loadFilesForReprocess(paths) {
      // Switch to process tab
      const processTab = document.querySelector('.tab[data-tab="process"]');
      if (processTab) processTab.click();
      // Clear any existing selections to make it clear this is a reprocess
      state.files = [];
      renderFileList();
      await addFiles(paths);
      if (window.SettingsManager) {
        window.SettingsManager.showToast('履歴からファイルを読み込みました', 'success');
      }
    },
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
