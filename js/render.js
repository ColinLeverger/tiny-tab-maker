/* =====================================================================
 * render.js — live HTML preview that mirrors the PDF.
 * This same DOM is what the "Print / Save as PDF" path prints (A4 CSS),
 * so it is the unicode-faithful output. No DOM events here, pure markup.
 * ===================================================================== */
(function (root) {
  "use strict";
  var FG = root.FG;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // colour helpers honour the B&W toggle
  function fillOf(cat, bw) { return bw ? FG.grayHex(cat.gray) : cat.fill; }
  function inkOf(cat, bw) { return bw ? FG.inkOnGray(cat.gray) : cat.ink; }

  function pill(text, cat, bw, mark, sec) {
    // mark = optional rehearsal entry {c:"red"|"yellow", note:"..."}; sec = section
    // key -> the pill becomes tappable in stage view (data-sec).
    var badge = "";
    if (mark && mark.c) badge += '<span class="rdot ' + mark.c + '"></span>';
    if (mark && mark.note) badge += '<span class="rflag">✎</span>';
    return '<span class="pill"' + (sec != null ? ' data-sec="' + esc(sec).replace(/"/g, "&quot;") + '"' : "") +
      ' style="background:' + fillOf(cat, bw) +
      ';border-color:' + inkOf(cat, bw) + ';color:' + inkOf(cat, bw) + '">' +
      badge + esc(text) + "</span>";
  }

  /* ---- rehearsal marks/notes (screen-only, never printed) ------------ */
  function rhEntries(s) {
    var rh = s.rehearsal || {}, out = [];
    if (rh.__song && (rh.__song.c || rh.__song.note)) out.push(["__song", rh.__song]);
    Object.keys(rh).forEach(function (k) {
      if (k !== "__song" && rh[k] && (rh[k].c || rh[k].note)) out.push([k, rh[k]]);
    });
    return out;
  }
  function noteNum(k) { var n = k + 1; return "#" + (n < 10 ? "0" + n : n); }
  // one rehearsal-note line -> HTML. A "🎵 x··· …" rhythm line is re-drawn
  // as real notation (SVG, barlines included) instead of raw pattern text.
  function rhNoteHTML(ln, ink) {
    var p = FG.parseRhythmLine && FG.parseRhythmLine(ln);
    if (!p) return esc(ln);
    return '<span class="rh-rhy">' + FG.rhythmSVG(p.slots, p.div, p.bpb, { ink: ink || "#333", h: 26 }) + "</span>" +
      (p.bpm ? ' <span class="rh-rmeta">' + p.bpm + " BPM</span>" : "");
  }
  // Render ANY embedded "🎵 x··· … (… grid)" rhythm token(s) sitting inside an
  // arbitrary text value (chord value, notes, breaks, tab note) as inline SVG
  // notation; everything else is escaped as-is. This is what lets a rhythm you
  // tap + paste draw everywhere, not only in the rehearsal block.
  var RHY_RE = /🎵[ \t]*[x·|\s]*(?:\(\s*\d+\s*BPM\s*·\s*\d+\/4\s*·\s*(?:16th|triplet)\s*grid\s*\))?/g;
  function inlineRhy(text, ink, h) {
    text = String(text == null ? "" : text);
    if (text.indexOf("🎵") < 0 || !FG.parseRhythmLine) return esc(text);
    var out = "", last = 0, m;
    RHY_RE.lastIndex = 0;
    while ((m = RHY_RE.exec(text))) {
      if (m[0].length === 0) { RHY_RE.lastIndex++; continue; }   // never stall
      var p = FG.parseRhythmLine(m[0]);
      if (!p) continue;                                          // 🎵 with no beats -> leave as text
      out += esc(text.slice(last, m.index)) +
        '<span class="rh-rhy">' +
        FG.rhythmSVG(p.slots, p.div, p.bpb, { ink: ink || "#333", h: h || 26 }) +
        "</span>" +
        (p.bpm ? ' <span class="rh-rmeta">' + p.bpm + " BPM</span>" : "");
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function rhBlock(s) {
    var es = rhEntries(s);
    if (!es.length) return "";
    return '<div class="rehearsal"><div class="lbl">Rehearsal 🖍</div>' +
      es.map(function (kv) {
        var e = kv[1];
        var lines = (e.note || "").split("\n").filter(Boolean);
        var notes = lines.map(function (ln, k) {
          return '<span class="rh-nn">' + noteNum(k) + "</span> " + rhNoteHTML(ln);
        }).join("<br>");
        return '<div class="rh-row' + (e.c ? " " + e.c : "") + '"><b>' +
          (kv[0] === "__song" ? "♪ Song" : esc(kv[0])) + "</b>" +
          (notes ? " — " + notes : "") + "</div>";
      }).join("") + "</div>";
  }

  /* ---- cover page --------------------------------------------------- */
  function cover(state, bw) {
    var m = state.meta || {};
    var rows = "", lastGroup = null;
    state.songs.forEach(function (s) {
      var g = s.group || "—";
      if (g !== lastGroup) {
        rows += '<tr class="grp"><td colspan="6">' + esc(g) + "</td></tr>";
        lastGroup = g;
      }
      var n = FG.tabCount(s);
      rows += "<tr>" +
        '<td class="c">' + esc(s.num) + "</td>" +
        "<td>" + esc(s.title) + "</td>" +
        '<td class="c">' + esc(s.key || "—") + "</td>" +
        '<td class="c">' + esc(s.tempo || "—") + "</td>" +
        '<td class="c">' + (n ? n : "—") + "</td>" +
        '<td class="rev"></td></tr>';
    });

    var legend = FG.CATEGORIES.filter(function (c) { return c[0] !== "other"; })
      .map(function (c) { var cat = FG.BY_KEY[c[0]]; return pill(cat.label, cat, bw); })
      .join(" ");

    return '<section class="sheet cover">' +
      '<h1 class="band">' + esc(m.band || "") + "</h1>" +
      '<div class="subtitle">' + esc(m.subtitle || "") + "</div>" +
      '<div class="meta">' + esc(m.notation || "") +
        "<br>Last updated: " + esc(m.updated || "") +
        "<br>" + state.songs.length + " songs</div>" +
      '<table class="cover-table"><thead><tr>' +
        "<th>#</th><th>Title</th><th>Key</th><th>Tempo</th><th>Tabs</th><th>Rev.</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>" +
      '<h3>How to use</h3>' +
      '<p class="note">Every <b>riff with no tab</b> becomes a blank ' +
        "<b>6-string × 8-slot grid</b> (e B G D A E) to fill in by hand. The " +
        "<b>Tabs</b> column counts the tabs that are filled in. Tick <b>Rev.</b> once a " +
        "song has been reviewed. <code>|: :|</code> = loop/repeat · <code>‡</code> = marker.</p>" +
      '<h3>Arrangement map — section colour code</h3>' +
      '<div class="legend">' + legend + "</div>" +
      "</section>";
  }

  /* ---- one tab block ------------------------------------------------ */
  // Mirror the vector PDF exactly so the on-screen tab matches the printed one:
  // tabs render at 0.7×chordPt (see CSS) in Courier (char width = 0.6×pt), on an
  // A4 sheet whose usable width is 595.28 - 2×38 ≈ 519.28 pt.
  function tabMaxW(chordPt) {
    var tabPt = (+chordPt || 12) * 0.7;
    return Math.max(24, Math.floor(519.28 / (0.6 * tabPt)) - 1);
  }
  function tabHtml(riff, chordPt) {
    var blocks = FG.renderTab(riff.tab, { ascii: false, maxw: tabMaxW(chordPt) });
    var count = FG.repeatCount(riff.tab);
    var note = riff.note || (count ? "×" + count : "");
    var head = '<div class="tab-head"><b>Tab — ' + esc(riff.label || "Riff") + "</b>" +
      (note ? ' <span class="tab-note">(' + inlineRhy(note, "#666", 22) + ")</span>" : "") + "</div>";
    var pre = blocks.map(function (b) { return esc(b.join("\n")); }).join("\n\n");
    return head + '<pre class="tab">' + pre + "</pre>";
  }

  /* ---- one song songsheet ----------------------------------------------- */
  function songsheet(s, bw, chordPt) {
    var rh = s.rehearsal || {};
    var songMark = (rh.__song && (rh.__song.c || rh.__song.note))
      ? '<span class="rdot ' + (rh.__song.c || "note") + '"></span>' : "";
    var head = '<div class="songsheet-head"><span class="fh-title">' + songMark +
      '<span class="fh-num">' + esc(s.num) + "</span> — " + esc(s.title).toUpperCase() + "</span>" +
      '<span class="fh-meta">' +
        [s.key, s.tempo, s.meter || s.feel, s.group].filter(Boolean).map(esc).join(" · ") +
      "</span></div>";

    var pills = FG.structurePills(s.structure);
    var structure = "";
    if (pills.length) {
      structure = '<div class="lbl">Structure</div><div class="pills">' +
        pills.map(function (p) { return pill(p.text, p.cat, bw, rh[p.text], p.text); }).join('<span class="arr">›</span>') +
        "</div>";
    } else if (s.structure) {
      structure = '<div class="lbl">Structure</div><div class="raw">' + esc(s.structure) + "</div>";
    }

    var chords = "";
    if (s.chords && s.chords.length) {
      chords = '<div class="lbl">Chords</div><table class="chords">' +
        s.chords.map(function (c) {
          var cat = FG.classify(c.label);
          var bg = fillOf(cat, bw), ink = inkOf(cat, bw);
          return "<tr>" +
            '<td class="cl" style="background:' + bg + ";border-left:3px solid " + ink +
              ';color:' + (bw ? "#111" : "#222") + '">' + esc(c.label || "") + "</td>" +
            '<td class="cv">' + inlineRhy(c.value || "") + "</td></tr>";
        }).join("") + "</table>";
    }

    var extra = [];
    if (s.breaks) extra.push(["Breaks", s.breaks]);
    if (s.notes) extra.push(["Notes", s.notes]);
    var extraHtml = extra.map(function (e) {
      var muted = (e[1] === "N/A" || e[1] === "—");
      return '<div class="kv' + (muted ? " muted" : "") + '"><b>' + esc(e[0]) +
        "</b> : " + inlineRhy(e[1]) + "</div>";
    }).join("");

    var tabs = (s.riffs || []).map(function (r) { return tabHtml(r, chordPt); }).join("");

    return '<section class="sheet songsheet">' + head + structure + chords +
      extraHtml + tabs + rhBlock(s) + "</section>";
  }

  /* ---- whole document ----------------------------------------------- */
  // songPage (optional) = array mapping each song index -> the PDF page it lands
  // on. In compact mode we use it to visually group songs exactly as the PDF
  // pages them (several song sheets per "page" card).
  function renderPreview(state, opts, songPage) {
    opts = opts || {};
    var bw = !!opts.bw;
    var chordPt = +opts.chordPt || 12;
    var compact = !!opts.compact;
    var html = cover(state, bw);

    if (compact && songPage && songPage.length === state.songs.length) {
      var i = 0;
      while (i < state.songs.length) {
        var pg = songPage[i], j = i, inner = "";
        while (j < state.songs.length && songPage[j] === pg) {
          inner += songsheet(state.songs[j], bw, chordPt); j++;
        }
        html += '<div class="pagegroup"><div class="pagelabel">Page ' + pg +
          "</div>" + inner + "</div>";
        i = j;
      }
    } else {
      state.songs.forEach(function (s) { html += songsheet(s, bw, chordPt); });
    }
    return html;
  }

  FG.renderPreview = renderPreview;
  FG.fillOf = fillOf; FG.inkOf = inkOf; FG.rhEntries = rhEntries;
  FG.rhNoteHTML = rhNoteHTML;
})(typeof window !== "undefined" ? window : globalThis);
