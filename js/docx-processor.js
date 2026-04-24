/**
 * DOCX Processor - async version that uses the RubyEngine worker via batch calls.
 *
 * Approach:
 *   1. For each XML file, collect all <w:t> nodes (not inside ruby).
 *   2. Send them all to the worker in a single batch to minimize round-trips.
 *   3. Apply results back to the DOM, preserving run properties.
 */

window.DocxProcessor = (function() {

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const TEXT_FILES_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

  async function load(arrayBuffer) {
    return JSZip.loadAsync(arrayBuffer);
  }

  async function save(zip) {
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    });
  }

  async function extractText(zip) {
    const parts = [];
    const files = Object.keys(zip.files).filter(n => TEXT_FILES_PATTERN.test(n));
    files.sort((a, b) => {
      if (a.includes('document')) return -1;
      if (b.includes('document')) return 1;
      return a.localeCompare(b);
    });

    for (const fileName of files) {
      if (!fileName.includes('document')) continue; // Only preview main doc
      const xmlStr = await zip.file(fileName).async('string');
      const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
      const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
      for (const p of paragraphs) {
        let paragraphText = '';
        const textNodes = p.getElementsByTagNameNS(W_NS, 't');
        for (const t of textNodes) paragraphText += t.textContent;
        parts.push(paragraphText);
      }
    }
    return parts;
  }

  function isInsideRuby(node) {
    let cur = node.parentNode;
    while (cur) {
      if (cur.namespaceURI === W_NS && (cur.localName === 'ruby' || cur.localName === 'rt' || cur.localName === 'rubyBase')) {
        return true;
      }
      cur = cur.parentNode;
    }
    return false;
  }

  function findAncestor(node, localName) {
    let cur = node.parentNode;
    while (cur) {
      if (cur.namespaceURI === W_NS && cur.localName === localName) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function getDirectChild(parent, localName) {
    for (const child of parent.children) {
      if (child.namespaceURI === W_NS && child.localName === localName) return child;
    }
    return null;
  }

  function getFontSizeHalfPoints(rPr) {
    if (!rPr) return null;
    for (const child of rPr.children) {
      if (child.namespaceURI === W_NS && child.localName === 'sz') {
        const v = child.getAttribute('w:val');
        if (v) return parseInt(v, 10);
      }
    }
    return null;
  }

  function buildPlainRun(doc, rPr, text) {
    const r = doc.createElementNS(W_NS, 'w:r');
    if (rPr) r.appendChild(rPr.cloneNode(true));
    const t = doc.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    return r;
  }

  function buildRtRPr(doc, baseRPr, halfPoints) {
    const rPr = doc.createElementNS(W_NS, 'w:rPr');
    if (baseRPr) {
      for (const child of baseRPr.children) {
        if (child.namespaceURI === W_NS && (child.localName === 'sz' || child.localName === 'szCs')) {
          continue;
        }
        rPr.appendChild(child.cloneNode(true));
      }
    }
    const sz = doc.createElementNS(W_NS, 'w:sz');
    sz.setAttribute('w:val', String(halfPoints));
    rPr.appendChild(sz);
    const szCs = doc.createElementNS(W_NS, 'w:szCs');
    szCs.setAttribute('w:val', String(halfPoints));
    rPr.appendChild(szCs);
    return rPr;
  }

  function buildRubyRun(doc, rPr, baseText, rubyText) {
    const outerR = doc.createElementNS(W_NS, 'w:r');
    if (rPr) outerR.appendChild(rPr.cloneNode(true));

    const ruby = doc.createElementNS(W_NS, 'w:ruby');
    // baseSize は half-points 単位（24 = 12pt）
    // baseSize が取れない場合は Word デフォルトの 10.5pt (sz=21)
    const baseSize = getFontSizeHalfPoints(rPr) || 21;

    // ルビサイズ = 親文字の正確に半分（half-points単位で割る）
    // 例: 24 (12pt) / 2 = 12 (6pt)
    //     22 (11pt) / 2 = 11 (5.5pt) ← 小数ポイントOK
    //     21 (10.5pt) / 2 = 10.5 → 切り下げて 10 (5pt)
    // half-points 値は整数でなければならないので Math.floor を使用
    // （Math.round だと 21/2=10.5 → 11 になり僅かに大きくなる）
    const rubyHalfPoints = Math.floor(baseSize / 2);

    const rubyPr = doc.createElementNS(W_NS, 'w:rubyPr');
    const rubyAlign = doc.createElementNS(W_NS, 'w:rubyAlign');
    rubyAlign.setAttribute('w:val', 'distributeSpace');
    rubyPr.appendChild(rubyAlign);
    const hps = doc.createElementNS(W_NS, 'w:hps');
    hps.setAttribute('w:val', String(rubyHalfPoints));
    rubyPr.appendChild(hps);
    const hpsRaise = doc.createElementNS(W_NS, 'w:hpsRaise');
    // hpsRaise（ルビを上に出す量）：親文字サイズに等しい（Wordの標準動作）
    hpsRaise.setAttribute('w:val', String(baseSize));
    rubyPr.appendChild(hpsRaise);
    const hpsBaseText = doc.createElementNS(W_NS, 'w:hpsBaseText');
    hpsBaseText.setAttribute('w:val', String(baseSize));
    rubyPr.appendChild(hpsBaseText);
    const lid = doc.createElementNS(W_NS, 'w:lid');
    lid.setAttribute('w:val', 'ja-JP');
    rubyPr.appendChild(lid);
    ruby.appendChild(rubyPr);

    const rt = doc.createElementNS(W_NS, 'w:rt');
    const rtR = doc.createElementNS(W_NS, 'w:r');
    const rtRPr = buildRtRPr(doc, rPr, rubyHalfPoints);
    rtR.appendChild(rtRPr);
    const rtT = doc.createElementNS(W_NS, 'w:t');
    rtT.setAttribute('xml:space', 'preserve');
    rtT.textContent = rubyText;
    rtR.appendChild(rtT);
    rt.appendChild(rtR);
    ruby.appendChild(rt);

    const rubyBase = doc.createElementNS(W_NS, 'w:rubyBase');
    const baseR = doc.createElementNS(W_NS, 'w:r');
    if (rPr) baseR.appendChild(rPr.cloneNode(true));
    const baseT = doc.createElementNS(W_NS, 'w:t');
    baseT.setAttribute('xml:space', 'preserve');
    baseT.textContent = baseText;
    baseR.appendChild(baseT);
    rubyBase.appendChild(baseR);
    ruby.appendChild(rubyBase);

    outerR.appendChild(ruby);
    return outerR;
  }

  function splitRunAt(run, tNode, replacements) {
    const doc = run.ownerDocument;
    const parent = run.parentNode;
    if (!parent) return; // run already detached

    const rPr = getDirectChild(run, 'rPr');
    const allChildren = Array.from(run.childNodes);
    const tIndex = allChildren.indexOf(tNode);
    if (tIndex === -1) return; // tNode is no longer a direct child

    const beforeChildren = allChildren.slice(0, tIndex).filter(c => !(c.nodeType === 1 && c.localName === 'rPr'));
    const afterChildren = allChildren.slice(tIndex + 1);

    if (beforeChildren.length > 0) {
      const beforeRun = doc.createElementNS(W_NS, 'w:r');
      if (rPr) beforeRun.appendChild(rPr.cloneNode(true));
      for (const c of beforeChildren) beforeRun.appendChild(c);
      parent.insertBefore(beforeRun, run);
    }
    for (const rep of replacements) parent.insertBefore(rep, run);
    if (afterChildren.length > 0) {
      const afterRun = doc.createElementNS(W_NS, 'w:r');
      if (rPr) afterRun.appendChild(rPr.cloneNode(true));
      for (const c of afterChildren) afterRun.appendChild(c);
      parent.insertBefore(afterRun, run);
    }
    parent.removeChild(run);
  }

  /**
   * Process all text files in the zip, using the worker for tokenization.
   */
  /**
   * Walk the docx XML and remove ruby annotations whose base text
   * is in the `deleteSet`. The base text is the kanji portion (w:rubyBase).
   * This is called AFTER processZip, if the user wants to strip certain rubies.
   */
  async function applyRubyDeletions(zip, deletions) {
    // deletions: array of {paraIdx, segIdx} referring to previewSegments order
    // We'll locate the corresponding <w:ruby> elements in document.xml and
    // replace each with its plain base text.

    if (!deletions || deletions.length === 0) return;

    const fileName = 'word/document.xml';
    const xmlStr = await zip.file(fileName).async('string');
    const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');

    // Group deletions by paragraph index
    const byPara = new Map();
    for (const d of deletions) {
      if (!byPara.has(d.paraIdx)) byPara.set(d.paraIdx, new Set());
      byPara.get(d.paraIdx).add(d.segIdx);
    }

    const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

    for (const [paraIdx, segSet] of byPara.entries()) {
      const p = paragraphs[paraIdx];
      if (!p) continue;

      // Walk <w:ruby> elements in document order within this paragraph
      const rubies = Array.from(p.getElementsByTagNameNS(W_NS, 'ruby'));

      for (let i = 0; i < rubies.length; i++) {
        if (!segSet.has(i)) continue;
        const ruby = rubies[i];
        // Replace the <w:ruby> with the plain base text run.
        const rubyBase = getChildByLocalName(ruby, 'rubyBase');
        if (!rubyBase) continue;
        // The base typically has <w:r><w:rPr/><w:t>...</w:t></w:r>
        const baseRun = getChildByLocalName(rubyBase, 'r');
        if (!baseRun) continue;

        // The parent of <w:ruby> is a <w:r> (from our buildRubyRun).
        // We want to replace that outer <w:r> with a new <w:r> containing
        // the base's run content.
        const outerR = ruby.parentNode;
        if (!outerR || outerR.localName !== 'r') {
          // Unexpected structure — try to just replace the ruby element
          const parent = ruby.parentNode;
          if (!parent) continue;
          // Move the base run contents to a new plain run
          const newR = doc.createElementNS(W_NS, 'w:r');
          for (const child of Array.from(baseRun.childNodes)) {
            newR.appendChild(child);
          }
          parent.insertBefore(newR, ruby);
          parent.removeChild(ruby);
          continue;
        }

        const grandParent = outerR.parentNode;
        if (!grandParent) continue;

        // Create a replacement <w:r> using the base run's rPr and text
        const newR = doc.createElementNS(W_NS, 'w:r');
        // Prefer the original outer rPr (matches surrounding formatting)
        const outerRPr = getChildByLocalName(outerR, 'rPr');
        if (outerRPr) newR.appendChild(outerRPr.cloneNode(true));

        // Copy text nodes from baseRun
        for (const child of Array.from(baseRun.childNodes)) {
          if (child.nodeType === 1 && child.localName === 'rPr') continue;
          newR.appendChild(child.cloneNode(true));
        }

        grandParent.insertBefore(newR, outerR);
        grandParent.removeChild(outerR);
      }
    }

    // Serialize back
    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(doc);
    if (!xml.startsWith('<?xml')) {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    }
    zip.file(fileName, xml);
  }

  /**
   * Apply edits to ruby readings (changing the rt text).
   * edits: array of {paraIdx, segIdx, reading}
   */
  async function applyRubyEdits(zip, edits) {
    if (!edits || edits.length === 0) return;

    const fileName = 'word/document.xml';
    const xmlStr = await zip.file(fileName).async('string');
    const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');

    const byPara = new Map();
    for (const e of edits) {
      if (!byPara.has(e.paraIdx)) byPara.set(e.paraIdx, new Map());
      byPara.get(e.paraIdx).set(e.segIdx, e.reading);
    }

    const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
    for (const [paraIdx, segMap] of byPara.entries()) {
      const p = paragraphs[paraIdx];
      if (!p) continue;
      const rubies = Array.from(p.getElementsByTagNameNS(W_NS, 'ruby'));
      for (let i = 0; i < rubies.length; i++) {
        if (!segMap.has(i)) continue;
        const newReading = segMap.get(i);
        const rt = getChildByLocalName(rubies[i], 'rt');
        if (!rt) continue;
        const tNode = rt.getElementsByTagNameNS(W_NS, 't')[0];
        if (!tNode) continue;
        tNode.textContent = newReading;
      }
    }

    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(doc);
    if (!xml.startsWith('<?xml')) {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    }
    zip.file(fileName, xml);
  }

  /**
   * Apply user-added rubies.
   * additions: array of {paraIdx, insertBeforeSegIdx, text, ruby}
   */
  async function applyRubyAdditions(zip, additions) {
    if (!additions || additions.length === 0) return;

    const fileName = 'word/document.xml';
    const xmlStr = await zip.file(fileName).async('string');
    const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');

    const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

    // Group by paragraph for processing
    const byPara = new Map();
    for (const a of additions) {
      if (!byPara.has(a.paraIdx)) byPara.set(a.paraIdx, []);
      byPara.get(a.paraIdx).push(a);
    }

    for (const [paraIdx, adds] of byPara.entries()) {
      const p = paragraphs[paraIdx];
      if (!p) continue;

      for (const add of adds) {
        const inserted = insertRubyIntoParagraph(doc, p, add.text, add.ruby);
        if (!inserted) {
          console.warn('Could not insert ruby for:', add.text);
        }
      }
    }

    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(doc);
    if (!xml.startsWith('<?xml')) {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    }
    zip.file(fileName, xml);
  }

  /**
   * Find `baseText` within a paragraph's plain-text runs (skipping ruby-wrapped
   * text), split the run at that point, and insert a new <w:ruby> run.
   * Returns true if inserted, false if text wasn't found.
   */
  function insertRubyIntoParagraph(doc, p, baseText, rubyText) {
    // Collect all <w:t> nodes that are NOT inside a ruby
    const allT = Array.from(p.getElementsByTagNameNS(W_NS, 't'));
    const plainTs = allT.filter(t => !isInsideRuby(t));

    // Scan each plain <w:t> for the first match
    for (const tNode of plainTs) {
      const text = tNode.textContent;
      const idx = text.indexOf(baseText);
      if (idx < 0) continue;

      // Split the text node into: before + match + after
      const before = text.slice(0, idx);
      const match = text.slice(idx, idx + baseText.length);
      const after = text.slice(idx + baseText.length);

      const run = findAncestor(tNode, 'r');
      if (!run) continue;
      const parent = run.parentNode;
      if (!parent) continue;
      const rPr = getDirectChild(run, 'rPr');

      // Build: (before run), (ruby run), (after run)
      const pieces = [];
      if (before) pieces.push(buildPlainRun(doc, rPr, before));
      pieces.push(buildRubyRun(doc, rPr, match, rubyText));
      if (after) pieces.push(buildPlainRun(doc, rPr, after));

      // Check if this run has only this w:t (simple case)
      const runChildren = Array.from(run.children).filter(c => c.localName !== 'rPr');
      const hasOnlyThisT = runChildren.length === 1 && runChildren[0] === tNode;

      if (hasOnlyThisT) {
        for (const piece of pieces) parent.insertBefore(piece, run);
        parent.removeChild(run);
      } else {
        // Complex — just replace the text node with pieces via splitRunAt-like logic
        splitRunAt(run, tNode, pieces);
      }
      return true;
    }

    return false;
  }

  function getChildByLocalName(parent, localName) {
    for (const child of parent.children) {
      if (child.namespaceURI === W_NS && child.localName === localName) return child;
    }
    return null;
  }

  // Alias for consistency with other code paths
  function getDirectChildByName(parent, localName) {
    return getChildByLocalName(parent, localName);
  }

  function hasKatakana(str) {
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code >= 0x30a1 && code <= 0x30fa) return true;
    }
    return false;
  }

  /**
   * Unwrap all <w:ruby> elements in the document: replace each with a plain
   * <w:r> containing the base text (discarding the rt/ruby annotation).
   * Used when the user wants to re-annotate a document that already has ruby.
   */
  function unwrapAllRubies(doc) {
    const rubies = Array.from(doc.getElementsByTagNameNS(W_NS, 'ruby'));
    for (const ruby of rubies) {
      const base = getDirectChildByName(ruby, 'rubyBase');
      if (!base) continue;
      const baseRun = getDirectChildByName(base, 'r');
      if (!baseRun) continue;

      const outerR = ruby.parentNode;
      if (!outerR || outerR.localName !== 'r') continue;
      const grandParent = outerR.parentNode;
      if (!grandParent) continue;

      const newR = doc.createElementNS(W_NS, 'w:r');
      const outerRPr = getDirectChildByName(outerR, 'rPr');
      if (outerRPr) newR.appendChild(outerRPr.cloneNode(true));

      for (const child of Array.from(baseRun.childNodes)) {
        if (child.nodeType === 1 && child.localName === 'rPr') continue;
        newR.appendChild(child.cloneNode(true));
      }

      grandParent.insertBefore(newR, outerR);
      grandParent.removeChild(outerR);
    }
  }

  async function processZip(zip, rubyEngine, options = {}, onProgress) {
    const files = Object.keys(zip.files).filter(n => TEXT_FILES_PATTERN.test(n));
    const stats = {
      totalKanjiGroups: 0,
      totalRubied: 0,
      paragraphs: 0,
      previewSegments: [],
    };

    for (let i = 0; i < files.length; i++) {
      const fileName = files[i];
      const isMainDoc = fileName.includes('document') && !fileName.includes('documentRels');
      const basePct = i / files.length;
      const slicePct = 1 / files.length;

      onProgress && onProgress(`処理中: ${fileName.replace('word/','')}`, basePct);

      const xmlStr = await zip.file(fileName).async('string');
      const fileResult = await processXmlString(
        xmlStr,
        rubyEngine,
        options,
        isMainDoc,
        (inner, msg) => onProgress && onProgress(msg, basePct + slicePct * inner)
      );

      stats.totalKanjiGroups += fileResult.fileStats.totalKanjiGroups;
      stats.totalRubied += fileResult.fileStats.totalRubied;
      stats.paragraphs += fileResult.fileStats.paragraphs;
      if (isMainDoc) stats.previewSegments = fileResult.fileStats.previewSegments;

      zip.file(fileName, fileResult.xml);
    }

    return stats;
  }

  /**
   * Process one XML file. Uses batch worker calls for efficiency.
   */
  async function processXmlString(xmlStr, rubyEngine, options, capturePreview, onInnerProgress) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');

    const fileStats = {
      totalKanjiGroups: 0,
      totalRubied: 0,
      paragraphs: 0,
      previewSegments: [],
    };

    const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
    fileStats.paragraphs = paragraphs.length;

    // ===== Pass 1: collect all text nodes that need tokenization =====
    const keepExisting = options.keepExisting !== false; // default true
    if (!keepExisting) {
      unwrapAllRubies(doc);
    }

    const paragraphTasks = [];

    for (const p of paragraphs) {
      const allT = Array.from(p.getElementsByTagNameNS(W_NS, 't'));
      const items = [];
      for (const t of allT) {
        if (isInsideRuby(t)) continue;
        const text = t.textContent;
        if (!text) continue;
        const needsAnnotation = rubyEngine.hasKanji(text) ||
                                (options.rubyKatakana && hasKatakana(text));
        items.push({ tNode: t, text, needsAnnotation });
      }

      // Collect existing ruby info for preview (if keeping existing)
      const existingRubies = [];
      if (keepExisting) {
        const rubies = Array.from(p.getElementsByTagNameNS(W_NS, 'ruby'));
        for (const ruby of rubies) {
          const base = getDirectChildByName(ruby, 'rubyBase');
          const rt = getDirectChildByName(ruby, 'rt');
          if (!base || !rt) continue;
          const baseText = base.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
          const rtText = rt.getElementsByTagNameNS(W_NS, 't')[0]?.textContent || '';
          existingRubies.push({ text: baseText, ruby: rtText, _existing: true });
        }
      }

      paragraphTasks.push({ p, items, existingRubies });
    }

    // Collect texts that actually need worker annotation
    const textsToAnnotate = [];
    const annotateLocations = [];
    paragraphTasks.forEach((task, pi) => {
      task.items.forEach((item, ii) => {
        if (item.needsAnnotation) {
          textsToAnnotate.push(item.text);
          annotateLocations.push({ paraIdx: pi, itemIdx: ii });
        }
      });
    });

    // Batch-annotate in chunks
    const BATCH_SIZE = 200;
    const annotationResults = new Array(textsToAnnotate.length);

    for (let start = 0; start < textsToAnnotate.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, textsToAnnotate.length);
      const chunk = textsToAnnotate.slice(start, end);
      const pct = end / Math.max(1, textsToAnnotate.length);
      onInnerProgress && onInnerProgress(pct * 0.8, `解析中 (${end}/${textsToAnnotate.length})`);

      const results = await rubyEngine.annotateBatch(chunk, options);
      for (let j = 0; j < results.length; j++) {
        annotationResults[start + j] = results[j];
      }
    }

    // Build lookup: paraIdx -> itemIdx -> segments
    const segmentsByLocation = {};
    annotateLocations.forEach((loc, idx) => {
      if (!segmentsByLocation[loc.paraIdx]) segmentsByLocation[loc.paraIdx] = {};
      segmentsByLocation[loc.paraIdx][loc.itemIdx] = annotationResults[idx];
    });

    // ===== Pass 2: apply DOM modifications =====
    onInnerProgress && onInnerProgress(0.85, 'XMLを更新中');

    paragraphTasks.forEach((task, pi) => {
      const paragraphPreview = [];

      // First: build preview in forward order
      if (capturePreview) {
        task.items.forEach((item, ii) => {
          const segs = segmentsByLocation[pi]?.[ii];
          if (!item.needsAnnotation || !segs) {
            paragraphPreview.push({ text: item.text, ruby: '' });
          } else {
            for (const s of segs) paragraphPreview.push(s);
          }
        });
        fileStats.previewSegments.push(paragraphPreview);
      }

      // Second: apply DOM edits in REVERSE order
      for (let ii = task.items.length - 1; ii >= 0; ii--) {
        const item = task.items[ii];
        const segs = segmentsByLocation[pi]?.[ii];

        if (!item.needsAnnotation || !segs) continue;

        const anyRuby = segs.some(s => s.ruby);
        if (!anyRuby) continue;

        // Build replacement runs
        const run = findAncestor(item.tNode, 'r');
        if (!run || isInsideRuby(run)) continue;

        if (!run.parentNode) continue;
        if (!item.tNode.parentNode) continue;

        // Also guard: ensure the <w:t> is still inside this run
        let cur = item.tNode;
        let stillInside = false;
        while (cur) {
          if (cur === run) { stillInside = true; break; }
          cur = cur.parentNode;
        }
        if (!stillInside) continue;

        const rPr = getDirectChild(run, 'rPr');
        const replacements = [];
        for (const seg of segs) {
          if (seg.ruby) {
            fileStats.totalKanjiGroups++;
            fileStats.totalRubied++;
            replacements.push(buildRubyRun(doc, rPr, seg.text, seg.ruby));
          } else if (seg.text) {
            replacements.push(buildPlainRun(doc, rPr, seg.text));
          }
        }

        // Apply
        try {
          const runChildren = Array.from(run.children).filter(c => c.localName !== 'rPr');
          const hasOnlyThisT = runChildren.length === 1 && runChildren[0] === item.tNode;

          if (hasOnlyThisT) {
            const parent = run.parentNode;
            if (parent) {
              for (const rep of replacements) parent.insertBefore(rep, run);
              parent.removeChild(run);
            }
          } else {
            splitRunAt(run, item.tNode, replacements);
          }
        } catch (err) {
          console.warn('ルビ挿入に失敗:', err.message, 'text:', item.text);
        }
      }
    });

    onInnerProgress && onInnerProgress(1.0, '完了');

    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(doc);
    if (!xml.startsWith('<?xml')) {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    }
    return { xml, fileStats };
  }

  return {
    load,
    save,
    processZip,
    extractText,
    applyRubyDeletions,
    applyRubyEdits,
    applyRubyAdditions,
  };
})();
