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

  function asciiFold(s) {
    return String(s == null ? "" : s)
      .replace(/∥|‖/g, "||").replace(/→/g, "->").replace(/↔/g, "<->")
      .replace(/↓/g, "v").replace(/↑/g, "^").replace(/‡/g, "*")
      .replace(/×/g, "x").replace(/—|–/g, "-").replace(/…/g, "...")
      .replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  }
  function rgbFill(cat, bw) { return FG.hexRgb(bw ? FG.grayHex(cat.gray) : cat.fill); }
  function rgbInk(cat, bw) { return FG.hexRgb(bw ? FG.inkOnGray(cat.gray) : cat.ink); }

  function generatePdf(state, opts) {
    opts = opts || {};
    var bw = !!opts.bw;
    var compact = !!opts.compact;
    var chordPt = +opts.chordPt || 12;
    var tabPt = chordPt * 0.7;            // tabs render at the chord-value size
    var jsPDF = (root.jspdf || {}).jsPDF;
    if (!jsPDF) { alert("jsPDF is not loaded (offline?)."); return; }

    var doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    var PW = doc.internal.pageSize.getWidth();
    var PH = doc.internal.pageSize.getHeight();
    var M = 38, W = PW - 2 * M, BOTTOM = PH - 46;
    var y = M + 4;
    var HEAD = [43, 52, 64], MUT = [110, 116, 124];

    function ensure(need) { if (y + need > BOTTOM) { doc.addPage(); y = M + 4; } }
    function setF(style, size) { doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); }

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
      setF("normal", size || 8.4);
      var c = color || [40, 40, 40]; doc.setTextColor(c[0], c[1], c[2]);
      var lines = doc.splitTextToSize(asciiFold(txt), W);
      for (var i = 0; i < lines.length; i++) {
        ensure(size + 2); doc.text(lines[i], M, y + size); y += size + 2.5;
      }
      y += (gap || 0); doc.setTextColor(20, 20, 20);
    }

    /* =================== COVER =================== */
    setF("bold", 28); doc.setTextColor(20, 22, 26);
    doc.text(asciiFold(state.meta.band || ""), M, y + 24); y += 34;
    setF("italic", 12); doc.setTextColor(70, 70, 70);
    doc.text(asciiFold(state.meta.subtitle || ""), M, y + 6); y += 18;
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
      else if (s.structure) { setF("normal", 8.4); h += 12 + doc.splitTextToSize(asciiFold(s.structure), W).length * 10.9 + 3; }
      if (s.chords && s.chords.length) {
        h += 15; var valW = W * 0.64 - 12; setF("bold", chordPt * 0.7);
        s.chords.forEach(function (c) {
          var lines = Math.max(1, doc.splitTextToSize(asciiFold(c.value || ""), valW).length);
          h += lines * (chordPt * 0.7 * 1.15) + 5;
        });
      }
      [["Breaks", s.breaks], ["Notes", s.notes]].forEach(function (e) {
        if (!e[1]) return; setF("normal", 8.4);
        h += Math.max(1, doc.splitTextToSize(asciiFold(e[1]), W - 60).length) * 11;
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

      // header band
      doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
      doc.roundedRect(M, y, W, 20, 4, 4, "F");
      setF("bold", 12); doc.setTextColor(255, 255, 255);
      doc.text(asciiFold(s.num + " — " + (s.title || "").toUpperCase()), M + 8, y + 14);
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
        var crows = s.chords.map(function (c) {
          return [asciiFold(c.label || ""), asciiFold(c.value || "")];
        });
        doc.autoTable({
          startY: y, margin: { left: M, right: M },
          body: crows, theme: "plain",
          styles: { fontSize: chordPt * 0.62, cellPadding: { top: 2.5, bottom: 2.5, left: 6, right: 6 },
            lineColor: [238, 241, 244], lineWidth: { bottom: .5 }, valign: "middle" },
          columnStyles: { 0: { cellWidth: W * 0.36, fontStyle: "bold" },
            1: { fontStyle: "bold", fontSize: chordPt * 0.7 } },
          didParseCell: function (d) {
            if (d.column.index === 0) {
              var cat = FG.classify(d.cell.raw);
              var f = rgbFill(cat, bw), ink = rgbInk(cat, bw);
              d.cell.styles.fillColor = f;
              d.cell.styles.textColor = bw ? [17, 17, 17] : [34, 34, 34];
              d.cell.styles.lineWidth = { bottom: .5, left: 3 };
              d.cell.styles.lineColor = ink; // left accent uses ink; bottom approx same
            }
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
        setF("normal", 8.4);
        var lines = doc.splitTextToSize(asciiFold(e[1]), W - (lx - M));
        doc.text(lines[0], lx, y + 6); y += 11;
        for (var i = 1; i < lines.length; i++) { ensure(11); doc.text(lines[i], M, y + 6); y += 11; }
      });

      // tabs (Courier char width = 0.6*fontSize; wrap so a line fits W)
      var tabMaxW = Math.max(24, Math.floor(W / (0.6 * tabPt)) - 1);
      (s.riffs || []).forEach(function (r) {
        var blocks = FG.renderTab(r.tab, { ascii: true, maxw: tabMaxW });
        var count = FG.repeatCount(r.tab);
        var note = r.note ? asciiFold(r.note) : (count ? "x" + count : "");
        ensure(18);
        setF("bold", 8.2); doc.setTextColor(40, 40, 40);
        var title = "Tab - " + asciiFold(r.label || "Riff");
        doc.text(title, M, y + 8);
        if (note) {
          var tw = doc.getTextWidth(title);
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

    var bandName = state.meta.band || "tabs";
    var slug = bandName.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "tabs";
    doc.save("tabs-" + slug + (bw ? "-bw" : "-color") + ".pdf");
  }

  FG.generatePdf = generatePdf;
})(typeof window !== "undefined" ? window : globalThis);
