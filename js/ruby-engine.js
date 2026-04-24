/**
 * Ruby Engine (Electron version) - wraps kuromoji.js
 *
 * kuromoji.js normally loads dict files via XHR. In Electron we instead
 * read them via IPC (as ArrayBuffers) and feed them into kuromoji's
 * internal loader so no network is required.
 */

window.RubyEngine = (function() {
  let tokenizer = null;
  let ready = false;
  let loadPromise = null;

  // ===== User settings (exclusions + custom dict) =====
  // These are set via setUserSettings() by the app layer.
  let exclusionWords = [];               // Array<string> of words (single-kanji or compound) to skip
  let exclusionWordsSortedKeys = [];     // sorted by length DESC for longest-match
  let customDict = new Map();            // Map<word, {reading, category}>
  let customDictSortedKeys = [];         // word list, sorted by length desc for longest-match

  function setUserSettings(settings) {
    settings = settings || {};

    // Exclusions: deduplicate, filter out empty strings
    const rawEx = settings.exclusions || [];
    const seen = new Set();
    exclusionWords = [];
    for (const w of rawEx) {
      if (typeof w !== 'string' || w.length === 0) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      exclusionWords.push(w);
    }
    // Sort by length DESC for longest-match
    exclusionWordsSortedKeys = exclusionWords.slice().sort((a, b) => b.length - a.length);

    customDict = new Map();
    const entries = settings.customDict || [];
    for (const entry of entries) {
      if (entry && typeof entry.word === 'string' && typeof entry.reading === 'string'
          && entry.word.length > 0 && entry.reading.length > 0) {
        customDict.set(entry.word, {
          reading: entry.reading,
          category: entry.category || '',
        });
      }
    }
    customDictSortedKeys = Array.from(customDict.keys()).sort((a, b) => b.length - a.length);
  }

  function getCustomDictSize() { return customDict.size; }
  function getExclusionSize() { return exclusionWords.length; }

  // ===== Helpers =====
  function kataToHira(str) {
    return str.replace(/[\u30a1-\u30f6]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }
  function isKanji(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9fff) ||
           (code >= 0x3400 && code <= 0x4dbf) ||
           (code >= 0xf900 && code <= 0xfaff);
  }
  function isKatakana(ch) {
    const code = ch.charCodeAt(0);
    // 0x30a0-0x30ff is full-width katakana block (includes '・' and 'ー')
    // We restrict to actual kana chars 0x30a1-0x30fa
    return code >= 0x30a1 && code <= 0x30fa;
  }
  function hasKanji(str) {
    for (const ch of str) if (isKanji(ch)) return true;
    return false;
  }
  function hasRubyTarget(str, rubyKatakana) {
    for (const ch of str) {
      if (isKanji(ch)) return true;
      if (rubyKatakana && isKatakana(ch)) return true;
    }
    return false;
  }
  function isAllKatakana(str) {
    if (!str) return false;
    let hasKata = false;
    for (const ch of str) {
      if (isKatakana(ch)) hasKata = true;
      else if (ch === 'ー') continue; // 長音符 allowed within katakana words
      else return false;
    }
    return hasKata;
  }

  /**
   * Override kuromoji's internal dictionary loader to use Electron IPC
   * instead of XHR. kuromoji@0.1.2 uses a BrowserDictionaryLoader which
   * calls XMLHttpRequest. We monkey-patch it before building.
   */
  function patchKuromojiLoader() {
    if (typeof kuromoji === 'undefined') {
      throw new Error('kuromoji.js が読み込まれていません');
    }

    // kuromoji.builder() returns a DictionaryBuilder whose .build() internally
    // invokes a DictionaryLoader. The loader uses XHR in the browser environment.
    // The simplest approach: set kuromoji's loadArrayBuffer to our IPC-based one.
    //
    // kuromoji exposes: kuromoji.TokenizerBuilder (not directly), but we can
    // intercept by temporarily replacing XMLHttpRequest with a mock that
    // reads from IPC. This is ugly but robust across kuromoji versions.

    const originalXHR = window.XMLHttpRequest;

    // Our mock only handles kuromoji dict file requests.
    function MockXHR() {
      this._listeners = {};
      this.responseType = '';
      this.response = null;
      this.status = 0;
      this.readyState = 0;
    }
    MockXHR.prototype.open = function(method, url) {
      this._url = url;
    };
    MockXHR.prototype.setRequestHeader = function() {};
    MockXHR.prototype.addEventListener = function(ev, fn) {
      this._listeners[ev] = this._listeners[ev] || [];
      this._listeners[ev].push(fn);
    };
    MockXHR.prototype.send = async function() {
      const self = this;
      try {
        // Extract filename from url (kuromoji passes e.g. "dict/base.dat.gz")
        const fileName = self._url.split('/').pop();
        const buffer = await window.electronAPI.readDictFile(fileName);
        self.response = buffer;
        self.status = 200;
        self.readyState = 4;
        // Fire load event
        const evt = { target: self };
        (self._listeners['load'] || []).forEach(fn => fn(evt));
        if (self.onload) self.onload(evt);
      } catch (err) {
        self.status = 404;
        self.readyState = 4;
        const evt = { target: self };
        (self._listeners['error'] || []).forEach(fn => fn(evt));
        if (self.onerror) self.onerror(evt);
      }
    };

    return {
      install() { window.XMLHttpRequest = MockXHR; },
      uninstall() { window.XMLHttpRequest = originalXHR; },
    };
  }

  /**
   * Load the tokenizer. Uses IPC to read dict files so no network needed.
   */
  function load(onProgress) {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      onProgress && onProgress('辞書ファイルを読み込み中…');

      if (typeof kuromoji === 'undefined') {
        throw new Error('kuromoji.js が読み込まれていません');
      }
      if (typeof window.electronAPI === 'undefined') {
        throw new Error('electronAPI が利用できません');
      }

      const patcher = patchKuromojiLoader();
      patcher.install();

      try {
        // The dicPath value here is just used as a URL prefix in XHR requests.
        // Our MockXHR extracts the filename from it and reads via IPC,
        // so the actual string doesn't matter (must contain path-like segments).
        await new Promise((resolve, reject) => {
          kuromoji.builder({ dicPath: 'dict/' }).build((err, tok) => {
            if (err) reject(err);
            else {
              tokenizer = tok;
              resolve();
            }
          });
        });
      } finally {
        patcher.uninstall();
      }

      ready = true;
      onProgress && onProgress('準備完了');
      return true;
    })().catch(err => {
      loadPromise = null;
      throw err;
    });

    return loadPromise;
  }

  /**
   * Align surface with reading, handling okurigana.
   */
  function alignReading(surface, reading) {
    const readingHira = kataToHira(reading);
    const runs = [];
    let currentRun = '';
    let currentIsKanji = null;
    for (const ch of surface) {
      const k = isKanji(ch);
      if (currentIsKanji === null) { currentIsKanji = k; currentRun = ch; }
      else if (k === currentIsKanji) currentRun += ch;
      else {
        runs.push({ text: currentRun, isKanji: currentIsKanji });
        currentRun = ch; currentIsKanji = k;
      }
    }
    if (currentRun) runs.push({ text: currentRun, isKanji: currentIsKanji });

    if (!runs.some(r => r.isKanji)) return [{ text: surface, ruby: '' }];
    if (runs.length === 1 && runs[0].isKanji) return [{ text: surface, ruby: readingHira }];

    let leftIdx = 0, rightIdx = runs.length - 1;
    let readingStart = 0, readingEnd = readingHira.length;

    while (leftIdx <= rightIdx && !runs[leftIdx].isKanji) {
      const runHira = kataToHira(runs[leftIdx].text);
      if (readingHira.slice(readingStart, readingStart + runHira.length) === runHira) {
        readingStart += runHira.length; leftIdx++;
      } else break;
    }
    while (rightIdx >= leftIdx && !runs[rightIdx].isKanji) {
      const runHira = kataToHira(runs[rightIdx].text);
      if (readingHira.slice(readingEnd - runHira.length, readingEnd) === runHira) {
        readingEnd -= runHira.length; rightIdx--;
      } else break;
    }

    const middleReading = readingHira.slice(readingStart, readingEnd);
    const result = [];
    for (let i = 0; i < runs.length; i++) {
      if (i < leftIdx || i > rightIdx) {
        result.push({ text: runs[i].text, ruby: '' });
      } else if (runs[i].isKanji) {
        const kanjiRunsInMiddle = runs.slice(leftIdx, rightIdx + 1).filter(r => r.isKanji).length;
        if (kanjiRunsInMiddle === 1) {
          result.push({ text: runs[i].text, ruby: middleReading });
        } else {
          const isFirstKanjiRun = runs.slice(leftIdx, i).every(r => !r.isKanji);
          result.push({ text: runs[i].text, ruby: isFirstKanjiRun ? middleReading : '' });
        }
      } else {
        result.push({ text: runs[i].text, ruby: '' });
      }
    }
    return result;
  }

  /**
   * Split text by applying both exclusion list (longest match) and
   * custom dictionary (longest match) as a preprocessing step.
   *
   * Priority: custom dict > exclusion list > tokenize with kuromoji
   *
   * Returns segments with markers:
   *   - { text, _fromCustom: true, ruby }    — custom dict match
   *   - { text, _excluded: true }            — exclusion match (no ruby)
   *   - { text, _needsTokenize: true }       — needs kuromoji tokenization
   */
  function preprocessText(text) {
    const result = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
      // Priority 1: try custom dict (longest match)
      let customMatch = null;
      if (customDictSortedKeys.length > 0) {
        for (const key of customDictSortedKeys) {
          if (key.length > n - i) continue;
          if (text.substr(i, key.length) === key) {
            customMatch = { key, entry: customDict.get(key) };
            break;
          }
        }
      }
      if (customMatch) {
        result.push({
          text: customMatch.key,
          ruby: customMatch.entry.reading,
          _fromCustom: true,
        });
        i += customMatch.key.length;
        continue;
      }

      // Priority 2: try exclusion list (longest match)
      let exMatch = null;
      if (exclusionWordsSortedKeys.length > 0) {
        for (const key of exclusionWordsSortedKeys) {
          if (key.length > n - i) continue;
          if (text.substr(i, key.length) === key) {
            exMatch = key;
            break;
          }
        }
      }
      if (exMatch) {
        result.push({ text: exMatch, _excluded: true });
        i += exMatch.length;
        continue;
      }

      // No match — scan ahead to next possible match
      let j = i + 1;
      while (j < n) {
        let earlyMatch = false;
        for (const key of customDictSortedKeys) {
          if (key.length > n - j) continue;
          if (text.substr(j, key.length) === key) { earlyMatch = true; break; }
        }
        if (!earlyMatch) {
          for (const key of exclusionWordsSortedKeys) {
            if (key.length > n - j) continue;
            if (text.substr(j, key.length) === key) { earlyMatch = true; break; }
          }
        }
        if (earlyMatch) break;
        j++;
      }
      const chunk = text.slice(i, j);
      result.push({ text: chunk, _needsTokenize: true });
      i = j;
    }

    return result;
  }

  function annotate(text, options = {}) {
    if (!ready || !tokenizer) throw new Error('Engine not ready');
    if (!text) return [{ text: '', ruby: '' }];

    const toKatakana = options.katakana === true;
    const skipKana = options.skipKana === true;
    const rubyKatakana = options.rubyKatakana === true;

    // Quick exit if there's nothing to annotate
    if (!hasRubyTarget(text, rubyKatakana)) return [{ text, ruby: '' }];

    // Step 1: apply custom dictionary and exclusions (both longest-match)
    const pieces = preprocessText(text);

    // Step 2: for each chunk, emit appropriate segments
    const segments = [];
    for (const piece of pieces) {
      // --- Custom dict match: use the registered reading ---
      if (piece._fromCustom) {
        let rubyText = piece.ruby;
        if (toKatakana) {
          rubyText = rubyText.replace(/[\u3041-\u3096]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) + 0x60)
          );
        }
        if (skipKana && kataToHira(rubyText) === kataToHira(piece.text)) {
          segments.push({ text: piece.text, ruby: '' });
        } else {
          segments.push({ text: piece.text, ruby: rubyText });
        }
        continue;
      }

      // --- Exclusion match: leave as-is with no ruby ---
      if (piece._excluded) {
        segments.push({ text: piece.text, ruby: '' });
        continue;
      }

      // --- Regular chunk: tokenize with kuromoji ---
      const chunk = piece.text;
      if (!hasRubyTarget(chunk, rubyKatakana)) {
        segments.push({ text: chunk, ruby: '' });
        continue;
      }

      const tokens = tokenizer.tokenize(chunk);
      for (const tok of tokens) {
        const surface = tok.surface_form;
        const reading = tok.reading && tok.reading !== '*' ? tok.reading : null;

        // Case 1: surface is pure katakana and we want ruby on it
        if (rubyKatakana && !hasKanji(surface) && isAllKatakana(surface) && reading) {
          let rubyText = kataToHira(reading);
          if (toKatakana) {
            rubyText = rubyText.replace(/[\u3041-\u3096]/g, ch =>
              String.fromCharCode(ch.charCodeAt(0) + 0x60)
            );
          }
          if (skipKana && kataToHira(rubyText) === kataToHira(surface)) {
            segments.push({ text: surface, ruby: '' });
          } else {
            segments.push({ text: surface, ruby: rubyText });
          }
          continue;
        }

        // Case 2: no kanji, not target katakana — emit as-is
        if (!hasKanji(surface) || !reading) {
          segments.push({ text: surface, ruby: '' });
          continue;
        }

        // Case 3: contains kanji — use alignment
        const aligned = alignReading(surface, reading);
        for (const seg of aligned) {
          if (!seg.ruby || !hasKanji(seg.text)) {
            segments.push({ text: seg.text, ruby: '' });
            continue;
          }

          let rubyText = seg.ruby;
          if (toKatakana) {
            rubyText = rubyText.replace(/[\u3041-\u3096]/g, ch =>
              String.fromCharCode(ch.charCodeAt(0) + 0x60)
            );
          }
          if (skipKana && kataToHira(rubyText) === kataToHira(seg.text)) {
            segments.push({ text: seg.text, ruby: '' });
          } else {
            segments.push({ text: seg.text, ruby: rubyText });
          }
        }
      }
    }

    // Merge consecutive no-ruby segments
    const merged = [];
    for (const s of segments) {
      if (merged.length && !s.ruby && !merged[merged.length - 1].ruby) {
        merged[merged.length - 1].text += s.text;
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }

  async function annotateBatch(texts, options) {
    return texts.map(t => {
      try { return annotate(t, options); }
      catch (e) { return [{ text: t, ruby: '' }]; }
    });
  }

  // Expose raw tokenizer for advanced features like unknown-word scanning
  function _tokenize(text) {
    if (!ready || !tokenizer) return null;
    return tokenizer.tokenize(text);
  }

  return {
    load,
    annotate,
    annotateBatch,
    isReady: () => ready,
    hasKanji,
    setUserSettings,
    getCustomDictSize,
    getExclusionSize,
    _tokenize,
  };
})();
