/**
 * Unknown Word Scanner
 * ---------------------
 * kuromoji の形態素解析結果から、読みが取れない漢字含有単語を抽出する。
 *
 * 「未知語」の定義：
 *   - kuromoji が返す reading が存在しない／'*' のトークン
 *   - 表層形（surface_form）に漢字が1文字以上含まれる
 *   - ただしユーザーのカスタム辞書・除外リストに既に登録済みの語は除外
 *
 * 処理フロー：
 *   1. ドキュメント全体のテキストを収集
 *   2. kuromoji で解析して未知語候補を集める（重複排除）
 *   3. 各候補に対し、推定読み・カテゴリ・出現回数・文脈を計算
 *   4. { word, guess, category, count, contexts[] } の配列を返す
 */

window.UnknownScanner = (function() {

  function isKanji(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9fff) ||
           (code >= 0x3400 && code <= 0x4dbf) ||
           (code >= 0xf900 && code <= 0xfaff);
  }

  function hasKanji(str) {
    for (const ch of str) if (isKanji(ch)) return true;
    return false;
  }

  /**
   * kuromojiトークンの reading が有効かどうか
   */
  function hasValidReading(token) {
    if (!token.reading) return false;
    if (token.reading === '*') return false;
    if (token.reading === token.surface_form) return false;
    return true;
  }

  /**
   * 既存カスタム辞書・除外リストに含まれるか判定
   */
  function isAlreadyKnown(word, knownSet) {
    return knownSet.has(word);
  }

  /**
   * ドキュメント全体をスキャンして未知語リストを生成
   *
   * @param {string[]} paragraphs - 段落ごとのテキスト
   * @param {object} options - オプション
   *   existingDict: Array<{word, reading}> - 既存カスタム辞書
   *   existingExclusions: string[] - 既存除外リスト
   * @returns {Promise<Array>} 未知語の配列
   */
  async function scan(paragraphs, options = {}) {
    if (!window.RubyEngine || !window.RubyEngine.isReady()) {
      throw new Error('辞書が準備できていません');
    }

    // 既知語セット（カスタム辞書・除外リスト）
    const knownSet = new Set();
    if (options.existingDict) {
      for (const e of options.existingDict) {
        if (e && e.word) knownSet.add(e.word);
      }
    }
    if (options.existingExclusions) {
      for (const w of options.existingExclusions) {
        if (w) knownSet.add(w);
      }
    }

    // 未知語 → { count, contexts[], firstParaIdx }
    const unknowns = new Map();

    for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
      const text = paragraphs[paraIdx];
      if (!text || !hasKanji(text)) continue;

      // kuromoji でトークン化（RubyEngine内部のtokenizerに委ねる）
      const tokens = window.RubyEngine._tokenize
        ? window.RubyEngine._tokenize(text)
        : null;

      if (!tokens) continue;

      for (const tok of tokens) {
        const surface = tok.surface_form;
        if (!surface || !hasKanji(surface)) continue;
        if (hasValidReading(tok)) continue;
        if (isAlreadyKnown(surface, knownSet)) continue;

        // 1文字語で、kuromoji にその漢字単独の読みが無い場合は
        // 誤ヒットが多いのでスキップするか要検討 → 含める（カスタム辞書化の価値あり）

        // 文脈：前後10字程度を抽出
        const idx = text.indexOf(surface);
        const ctxStart = Math.max(0, idx - 8);
        const ctxEnd = Math.min(text.length, idx + surface.length + 8);
        const context = (ctxStart > 0 ? '…' : '') +
                        text.slice(ctxStart, ctxEnd) +
                        (ctxEnd < text.length ? '…' : '');

        if (unknowns.has(surface)) {
          const u = unknowns.get(surface);
          u.count++;
          if (u.contexts.length < 3) u.contexts.push(context);
        } else {
          unknowns.set(surface, {
            word: surface,
            count: 1,
            contexts: [context],
            firstParaIdx: paraIdx,
          });
        }
      }
    }

    // 推定読み・カテゴリを付与
    const results = [];
    for (const u of unknowns.values()) {
      const guess = window.KanjiReadings
        ? window.KanjiReadings.estimate(u.word, { context: 'auto' })
        : null;
      const category = window.KanjiReadings
        ? window.KanjiReadings.guessCategory(u.word)
        : 'その他';

      results.push({
        word: u.word,
        reading: guess || '',
        guess: guess,
        category: category,
        count: u.count,
        contexts: u.contexts,
        firstParaIdx: u.firstParaIdx,
      });
    }

    // ソート：出現回数の多い順 → カテゴリ順 → 語順
    results.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.category !== b.category) return a.category.localeCompare(b.category, 'ja');
      return a.word.localeCompare(b.word, 'ja');
    });

    return results;
  }

  return { scan };
})();
