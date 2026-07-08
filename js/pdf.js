/* =====================================================================
 * pdf.js — one-click vector PDF via jsPDF + autotable.
 * Mirrors the reportlab layout (cover table + colour-coded song sheets).
 * jsPDF's standard fonts are WinAnsi, so unicode arrows/marks are
 * ASCII-folded here (-> v ||  *) exactly like the original script's
 * no-DejaVu fallback. Courier renders the ASCII tabs perfectly aligned.
 * ===================================================================== */
(function (root) {
  "use strict";
  var FG = root.FG;

  // Fold known unicode to WinAnsi-safe ASCII, strip emoji / pictographs, then
  // drop anything left outside Latin-1 so jsPDF's standard fonts never break.
  function pdfSafe(s) {
    s = String(s == null ? "" : s)
      .replace(/∥|‖/g, "||").replace(/→/g, "->").replace(/↔/g, "<->")
      .replace(/↓/g, "v").replace(/↑/g, "^").replace(/‡/g, "*")
      .replace(/×/g, "x").replace(/—|–/g, "-").replace(/…/g, "...")
      .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/›/g, ">").replace(/•/g, "-");
    // strip emoji, pictographs, flags, variation selectors, ZWJ, keycaps
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "");
    // final guard: anything still outside Latin-1 would break WinAnsi encoding
    return s.replace(/[^\x00-\xFF]/g, "");
  }
  var asciiFold = pdfSafe; // keep existing call sites working

  /* jsPDF's built-in fonts are WinAnsi outlines — no colour glyphs, so emoji
   * can't be drawn as text. Split a string into text runs and emoji runs; the
   * caller draws text normally and rasterises each emoji to a PNG (canvas). */
  var EMOJI_RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/gu;
  function emojiRuns(str) {
    var parts = String(str == null ? "" : str).split(EMOJI_RE), runs = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      runs.push({ emoji: i % 2 === 1, text: parts[i] });   // split w/ 1 capture group -> odd indices are the matches
    }
    return runs;
  }
  function hasEmoji(s) { EMOJI_RE.lastIndex = 0; var r = EMOJI_RE.test(String(s == null ? "" : s)); EMOJI_RE.lastIndex = 0; return r; }
  var _ecanvas;
  function rasterEmoji(ch, px) {                            // returns a PNG data URL of one emoji glyph
    px = Math.max(24, Math.round(px)) * 2;                  // 2x for crisp scaling
    if (!_ecanvas) _ecanvas = document.createElement("canvas");
    var c = _ecanvas, ctx = c.getContext("2d");
    c.width = c.height = px;
    ctx.clearRect(0, 0, px, px);
    ctx.font = px + "px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ch, 0, px * 0.82);
    return c.toDataURL("image/png");
  }
  function rgbFill(cat, bw) { return FG.hexRgb(bw ? FG.grayHex(cat.gray) : cat.fill); }
  function rgbInk(cat, bw) { return FG.hexRgb(bw ? FG.inkOnGray(cat.gray) : cat.ink); }

  // Build the whole document. Returns { doc, pages, songPage } WITHOUT saving,
  // so it can be reused both to download the PDF and to count/attribute pages
  // for the live UI (page count + compact grouping in the preview).
  function buildPdf(state, opts) {
    opts = opts || {};
    var bw = !!opts.bw;
    var compact = !!opts.compact;
    var chordPt = +opts.chordPt || 12;
    var tabPt = chordPt * 0.7;            // tabs render at the chord-value size
    var jsPDF = (root.jspdf || {}).jsPDF;
    if (!jsPDF) throw new Error("jsPDF is not loaded (offline?).");
    var songPage = [];                    // songPage[i] = 1-based PDF page of song i

    var doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    var PW = doc.internal.pageSize.getWidth();
    var PH = doc.internal.pageSize.getHeight();
    var M = 38, W = PW - 2 * M, BOTTOM = PH - 46;
    var y = M + 4;
    var HEAD = [43, 52, 64];

    function ensure(need) { if (y + need > BOTTOM) { doc.addPage(); y = M + 4; } }
    function setF(style, size) { doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); }

    /* single-line text that renders colour emoji as inline images. `size` is
     * the current font size (for emoji box sizing/baseline). Returns width. */
    function etext(str, x, y0, size) {
      var runs = emojiRuns(str), cx = x;
      for (var i = 0; i < runs.length; i++) {
        if (runs[i].emoji) {
          var s = size * 1.05;
          try { doc.addImage(rasterEmoji(runs[i].text, size), "PNG", cx, y0 - size * 0.86, s, s); }
          catch (e) { if (root.console) console.warn("emoji raster failed for", runs[i].text, e); }
          cx += s;
        } else {
          var t = asciiFold(runs[i].text);
          doc.text(t, cx, y0); cx += doc.getTextWidth(t);
        }
      }
      return cx - x;
    }

    /* emoji-aware, word-wrapped paragraph. Draws (and advances y) inline emoji
     * as PNGs; first line starts at startX (for the "Notes :" label), the rest
     * at the left margin. lineH = pt per line. */
    function etextWrap(str, size, maxW, startX, lineH) {
      var lines = wrapLines(str, size, maxW, startX);
      for (var i = 0; i < lines.length; i++) { ensure(lineH); etext(lines[i], i ? M : startX, y + 6, size); y += lineH; }
    }

    /* pure greedy word-wrap that counts an emoji as one glyph-width token;
     * returns line strings. Shared by etextWrap/para (draw) AND estimateFiche
     * (height) so the estimate and the drawing never disagree. */
    function wrapLines(str, size, maxW, startX, bold) {
      var toks = [], ew = size * 1.05;
      emojiRuns(str).forEach(function (r) {
        if (r.emoji) toks.push({ e: 1, t: r.text });
        else r.text.split(/(\s+)/).forEach(function (p) { if (p) toks.push({ e: 0, t: p }); });
      });
      setF(bold ? "bold" : "normal", size);   // measure in the weight it'll be drawn
      var lines = [], line = "", w = 0;
      for (var i = 0; i < toks.length; i++) {
        var avail = lines.length ? maxW : maxW - (startX - M);
        var tw = toks[i].e ? ew : doc.getTextWidth(asciiFold(toks[i].t));
        if (line && w + tw > avail) { lines.push(line); line = ""; w = 0; if (/^\s+$/.test(toks[i].t)) continue; }
        line += toks[i].t; w += tw;
      }
      if (line) lines.push(line);
      return lines;
    }

    // ---- pill row (returns; advances y) ----
    function pills(items, withArrows) {
      var x = M, h = 14, pad = 5, size = 8;
      setF("bold", size);
      for (var i = 0; i < items.length; i++) {
        var it = items[i], txt = asciiFold(it.text), cat = it.cat;
        var tw = doc.getTextWidth(txt), w = tw + pad * 2;
        if (x + w > M + W) { x = M; y += h + 5; }
        var f = rgbFill(cat, bw), ink = rgbInk(cat, bw);
        doc.setFillColor(f[0], f[1], f[2]);
        doc.setDrawColor(ink[0], ink[1], ink[2]);
        doc.roundedRect(x, y, w, h, 6, 6, "FD");
        doc.setTextColor(ink[0], ink[1], ink[2]);
        doc.text(txt, x + pad, y + h - 4);
        x += w + (withArrows ? 0 : 7);   // gap between legend pills
        if (withArrows && i < items.length - 1) {
          doc.setTextColor(170, 170, 170); doc.setFont("helvetica", "normal");
          if (x + 14 > M + W) { x = M; y += h + 5; }
          else { doc.text(">", x + 4, y + h - 4); x += 14; doc.setFont("helvetica", "bold"); }
        }
      }
      y += h + 6;
      doc.setTextColor(20, 20, 20);
    }

    function para(txt, size, color, gap) {
      size = size || 8.4;
      var c = color || [40, 40, 40]; doc.setTextColor(c[0], c[1], c[2]);
      String(txt == null ? "" : txt).split("\n").forEach(function (seg) {   // keep explicit line breaks
        var lines = wrapLines(seg, size, W, M); if (!lines.length) lines = [""];
        for (var i = 0; i < lines.length; i++) { ensure(size + 2); etext(lines[i], M, y + size, size); y += size + 2.5; }
      });
      y += (gap || 0); doc.setTextColor(20, 20, 20);
    }

    /* =================== COVER =================== */
    setF("bold", 28); doc.setTextColor(20, 22, 26);
    etext(state.meta.band || "", M, y + 24, 28); y += 34;
    setF("italic", 12); doc.setTextColor(70, 70, 70);
    etext(state.meta.subtitle || "", M, y + 6, 12); y += 18;
    para((state.meta.notation || "") + "\nLast updated: " + (state.meta.updated || "") +
         "\n" + state.songs.length + " songs", 8.2, [90, 90, 90], 4);

    // grouped song table
    var body = [], lastG = null;
    state.songs.forEach(function (s) {
      var g = s.group || "—";
      if (g !== lastG) {
        body.push([{ content: asciiFold(g), colSpan: 6,
          styles: { fillColor: [238, 242, 247], textColor: HEAD, fontStyle: "bold" } }]);
        lastG = g;
      }
      var n = FG.tabCount(s);
      body.push([s.num, asciiFold(s.title), asciiFold(s.key || "—"),
        asciiFold(s.tempo || "—"), (n ? String(n) : "—"), ""]);
    });
    doc.autoTable({
      startY: y + 2, margin: { left: M, right: M },
      head: [["#", "Title", "Key", "Tempo", "Tabs", "Rev."].map(asciiFold)],
      body: body, theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 3, lineColor: [228, 231, 234], lineWidth: .4 },
      headStyles: { fillColor: HEAD, textColor: [255, 255, 255], halign: "left" },
      columnStyles: { 0: { cellWidth: 26, halign: "center" }, 2: { halign: "center" },
        3: { halign: "center" }, 4: { cellWidth: 34, halign: "center" }, 5: { cellWidth: 36 } }
    });
    y = doc.lastAutoTable.finalY + 24;

    ensure(44); setF("bold", 11); doc.setTextColor(43, 52, 64);
    doc.text("How to use", M, y); y += 15;
    para("Every riff with no tab becomes a blank 6-string x 8-slot grid " +
         "(e B G D A E) to fill in by hand. The Tabs column counts the tabs that are " +
         "filled in. Tick Rev. once a song has been reviewed. |: :| = loop/repeat · * = marker.",
         8.4, [50, 50, 50], 16);

    y += 4; ensure(44); setF("bold", 11); doc.setTextColor(43, 52, 64);
    doc.text("Arrangement map - section colour code", M, y); y += 15;
    pills(FG.CATEGORIES.filter(function (c) { return c[0] !== "other"; })
      .map(function (c) { var cat = FG.BY_KEY[c[0]]; return { text: cat.label, cat: cat }; }), false);

    /* estimate a song sheet's height (measured) so compact mode never splits a song */
    function estPills(items, withArrows) {
      var x = 0, rows = 1, h = 14, pad = 5;
      setF("bold", 8);
      for (var i = 0; i < items.length; i++) {
        var w = doc.getTextWidth(asciiFold(items[i].text)) + pad * 2;
        if (i > 0 && x + w > W) { rows++; x = 0; }
        x += w + (withArrows ? 14 : 7);
      }
      return rows * (h + 5) + 6;
    }
    function estimateFiche(s) {
      var h = 28;                                  // header band + gap
      var ps = FG.structurePills(s.structure);
      if (ps.length) { h += 12 + estPills(ps, true); }
      else if (s.structure) {
        var sn = 0; String(s.structure).split("\n").forEach(function (seg) { sn += Math.max(1, wrapLines(seg, 8.4, W, M).length); });
        h += 12 + sn * 10.9 + 3;
      }
      if (s.chords && s.chords.length) {
        h += 15; var valW = W * 0.64 - 12;
        s.chords.forEach(function (c) {
          var lines = Math.max(1, wrapLines(c.value || "", chordPt * 0.7, valW, M, true).length);
          h += lines * (chordPt * 0.7 * 1.15) + 5;
        });
      }
      [["Breaks", s.breaks], ["Notes", s.notes]].forEach(function (e) {
        if (!e[1]) return; setF("bold", 8.4);
        var lx = M + doc.getTextWidth(e[0] + " : ") + 2;   // same wrap as the draw -> exact height
        h += Math.max(1, wrapLines(e[1], 8.4, W, lx).length) * 11;
      });
      var mw = Math.max(24, Math.floor(W / (0.6 * tabPt)) - 1), lh = tabPt * 1.32;
      (s.riffs || []).forEach(function (r) {
        var blocks = FG.renderTab(r.tab, { ascii: true, maxw: mw });
        h += 14; blocks.forEach(function (b, bi) { h += (bi > 0 ? lh * 0.5 : 0) + b.length * lh; }); h += 6;
      });
      return h;
    }

    /* =================== FICHES =================== */
    state.songs.forEach(function (s, idx) {
      if (!compact) {
        doc.addPage(); y = M + 4;                 // one song sheet per page
      } else if (idx === 0) {
        doc.addPage(); y = M + 4;                 // first song sheet starts on a fresh page (after cover)
      } else if (y + 20 + estimateFiche(s) > BOTTOM) {
        doc.addPage(); y = M + 4;                 // whole song sheet won't fit -> push to next page (never split)
      } else {
        y += 9;                                   // flow: thin separator between song sheets
        doc.setDrawColor(224, 228, 232); doc.setLineWidth(.5);
        doc.line(M, y, M + W, y); y += 11;
      }

      songPage[idx] = doc.internal.getNumberOfPages(); // page this song sheet lands on

      // header band
      doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
      doc.roundedRect(M, y, W, 20, 4, 4, "F");
      setF("bold", 12); doc.setTextColor(255, 255, 255);
      etext(s.num + " — " + (s.title || "").toUpperCase(), M + 8, y + 14, 12);
      setF("normal", 8.5); doc.setTextColor(220, 224, 230);
      var meta = [s.key, s.tempo, s.meter || s.feel, s.group].filter(Boolean).map(asciiFold).join(" · ");
      doc.text(meta, M + W - 8 - doc.getTextWidth(meta), y + 14);
      y += 28; doc.setTextColor(20, 20, 20);

      // structure
      var ps = FG.structurePills(s.structure);
      if (ps.length) {
        setF("bold", 8.5); doc.setTextColor(43, 52, 64);
        doc.text("STRUCTURE", M, y + 6); y += 12;
        pills(ps, true);
      } else if (s.structure) {
        setF("bold", 8.5); doc.setTextColor(43, 52, 64);
        doc.text("STRUCTURE", M, y + 6); y += 12;
        para(s.structure, 8.4, [60, 60, 60], 3);
      }

      // chords table (tinted label cells)
      if (s.chords && s.chords.length) {
        setF("bold", 8.5); doc.setTextColor(43, 52, 64);
        ensure(20); doc.text("CHORDS", M, y + 6); y += 9;
        // keep the raw (emoji-bearing) strings; autoTable only ever sees the
        // folded text, and we re-draw emoji cells ourselves in didDrawCell.
        var raw = s.chords.map(function (c) { return [c.label || "", c.value || ""]; });
        var crows = raw.map(function (r) { return [asciiFold(r[0]), asciiFold(r[1])]; });
        var col0w = W * 0.36 - 12, col1w = W * 0.64 - 12;   // cell width minus L+R padding
        var fs0 = chordPt * 0.62, fs1 = chordPt * 0.7;
        function cellMeta(ci) { return ci === 0 ? { fs: fs0, cw: col0w } : { fs: fs1, cw: col1w }; }
        doc.autoTable({
          startY: y, margin: { left: M, right: M },
          body: crows, theme: "plain",
          styles: { fontSize: fs0, cellPadding: { top: 2.5, bottom: 2.5, left: 6, right: 6 },
            lineColor: [238, 241, 244], lineWidth: { bottom: .5 }, valign: "middle" },
          columnStyles: { 0: { cellWidth: W * 0.36, fontStyle: "bold" },
            1: { cellWidth: W * 0.64, fontStyle: "bold", fontSize: fs1 } },
          didParseCell: function (d) {
            if (d.section !== "body") return;
            if (d.column.index === 0) {
              var cat = FG.classify(d.cell.raw);
              var f = rgbFill(cat, bw), ink = rgbInk(cat, bw);
              d.cell.styles.fillColor = f;
              d.cell.styles.textColor = bw ? [17, 17, 17] : [34, 34, 34];
              d.cell.styles.lineWidth = { bottom: .5, left: 3 };
              d.cell.styles.lineColor = ink; // left accent uses ink; bottom approx same
            }
            var rv = (raw[d.row.index] || [])[d.column.index] || "";
            if (hasEmoji(rv)) {                         // blank it; reserve height; we draw it in didDrawCell
              var m = cellMeta(d.column.index);
              d.cell.text = [""];
              d.cell.styles.minCellHeight = wrapLines(rv, m.fs, m.cw, M, true).length * (m.fs * 1.15) + 5;
            }
          },
          didDrawCell: function (d) {
            if (d.section !== "body") return;
            var rv = (raw[d.row.index] || [])[d.column.index] || "";
            if (!hasEmoji(rv)) return;
            var m = cellMeta(d.column.index);
            var col = d.column.index === 0 && bw ? [17, 17, 17] : [34, 34, 34];
            doc.setFont("helvetica", "bold"); doc.setFontSize(m.fs);
            doc.setTextColor(col[0], col[1], col[2]);
            var lines = wrapLines(rv, m.fs, m.cw, M, true), ty = d.cell.y + 2.5 + m.fs;
            for (var i = 0; i < lines.length; i++) { etext(lines[i], d.cell.x + 6, ty, m.fs); ty += m.fs * 1.15; }
          }
        });
        y = doc.lastAutoTable.finalY + 6;
      }

      // breaks / notes
      [["Breaks", s.breaks], ["Notes", s.notes]].forEach(function (e) {
        if (!e[1]) return;
        ensure(14); setF("bold", 8.4);
        var muted = (e[1] === "N/A" || e[1] === "—");
        doc.setTextColor(muted ? 150 : 40, muted ? 157 : 40, muted ? 164 : 40);
        doc.text(e[0] + " :", M, y + 6);
        var lx = M + doc.getTextWidth(e[0] + " : ") + 2;
        etextWrap(e[1], 8.4, W, lx, 11);   // inline emoji; height pre-measured by estimateFiche via the same wrapLines
      });

      // tabs (Courier char width = 0.6*fontSize; wrap so a line fits W)
      var tabMaxW = Math.max(24, Math.floor(W / (0.6 * tabPt)) - 1);
      (s.riffs || []).forEach(function (r) {
        var blocks = FG.renderTab(r.tab, { ascii: true, maxw: tabMaxW });
        var count = FG.repeatCount(r.tab);
        var note = r.note ? asciiFold(r.note) : (count ? "x" + count : "");
        ensure(18);
        setF("bold", 8.2); doc.setTextColor(40, 40, 40);
        var tw = etext("Tab - " + (r.label || "Riff"), M, y + 8, 8.2);   // inline emoji in riff labels
        if (note) {
          setF("normal", 8); doc.setTextColor(110, 110, 110);
          doc.text("(" + note + ")", M + tw + 5, y + 8);
        }
        y += 14;
        doc.setFont("courier", "normal"); doc.setFontSize(tabPt);
        doc.setTextColor(25, 25, 25);
        var lh = tabPt * 1.32;
        blocks.forEach(function (b, bi) {
          if (bi > 0) y += lh * 0.5;
          b.forEach(function (line) { ensure(lh); doc.text(line, M, y + tabPt); y += lh; });
        });
        y += 6;
      });
    });

    /* footers */
    var n = doc.internal.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 150);
      doc.text(asciiFold(state.meta.band + " — guitar sheets"), M, PH - 24);
      doc.text("p. " + p, PW - M - doc.getTextWidth("p. " + p), PH - 24);
    }

    return { doc: doc, pages: doc.internal.getNumberOfPages(), songPage: songPage };
  }

  function pdfName(state, bw) {
    var bandName = (state.meta && state.meta.band) || "tabs";
    var slug = bandName.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "tabs";
    return "tabs-" + slug + (bw ? "-bw" : "-color") + ".pdf";
  }

  // one-click download
  function generatePdf(state, opts) {
    opts = opts || {};
    try {
      var r = buildPdf(state, opts);
      r.doc.save(pdfName(state, !!opts.bw));
    } catch (e) { alert("PDF generation failed: " + e.message); }
  }

  // no-download variant: returns { pages, songPage } for the live UI, or null.
  function paginate(state, opts) {
    try { var r = buildPdf(state, opts); return { pages: r.pages, songPage: r.songPage }; }
    catch (e) { return null; }
  }

  FG.generatePdf = generatePdf;
  FG.paginate = paginate;

  /* set window.__PDF_SELFTEST=1 before load to assert the emoji splitter */
  if (root.__PDF_SELFTEST) {
    var r = emojiRuns("a😀b👨‍👩‍👧c");
    console.assert(r.length === 5 && !r[0].emoji && r[1].emoji && r[1].text === "😀" &&
      r[3].emoji && r[3].text === "👨‍👩‍👧" && r[4].text === "c", "emojiRuns split", r);
    console.assert(emojiRuns("plain").length === 1 && !emojiRuns("plain")[0].emoji, "emojiRuns plain");
    console.log("pdf.js self-test ok");
  }
})(typeof window !== "undefined" ? window : globalThis);
