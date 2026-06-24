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

  function pill(text, cat, bw) {
    return '<span class="pill" style="background:' + fillOf(cat, bw) +
      ';border-color:' + inkOf(cat, bw) + ';color:' + inkOf(cat, bw) + '">' +
      esc(text) + "</span>";
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
  // wrap width shrinks as the font grows so a tab always fits the sheet
  function tabMaxW(chordPt) { return Math.max(20, Math.floor(860 / (chordPt || 12))); }
  function tabHtml(riff, chordPt) {
    var blocks = FG.renderTab(riff.tab, { ascii: false, maxw: tabMaxW(chordPt) });
    var count = FG.repeatCount(riff.tab);
    var note = riff.note || (count ? "×" + count : "");
    var head = '<div class="tab-head"><b>Tab — ' + esc(riff.label || "Riff") + "</b>" +
      (note ? ' <span class="tab-note">(' + esc(note) + ")</span>" : "") + "</div>";
    var pre = blocks.map(function (b) { return esc(b.join("\n")); }).join("\n\n");
    return head + '<pre class="tab">' + pre + "</pre>";
  }

  /* ---- one song songsheet ----------------------------------------------- */
  function songsheet(s, bw, chordPt) {
    var head = '<div class="songsheet-head"><span class="fh-title">' +
      esc(s.num) + " — " + esc(s.title).toUpperCase() + "</span>" +
      '<span class="fh-meta">' +
        [s.key, s.tempo, s.meter || s.feel, s.group].filter(Boolean).map(esc).join(" · ") +
      "</span></div>";

    var pills = FG.structurePills(s.structure);
    var structure = "";
    if (pills.length) {
      structure = '<div class="lbl">Structure</div><div class="pills">' +
        pills.map(function (p) { return pill(p.text, p.cat, bw); }).join('<span class="arr">›</span>') +
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
            '<td class="cv">' + esc(c.value || "") + "</td></tr>";
        }).join("") + "</table>";
    }

    var extra = [];
    if (s.breaks) extra.push(["Breaks", s.breaks]);
    if (s.notes) extra.push(["Notes", s.notes]);
    var extraHtml = extra.map(function (e) {
      var muted = (e[1] === "N/A" || e[1] === "—");
      return '<div class="kv' + (muted ? " muted" : "") + '"><b>' + esc(e[0]) +
        "</b> : " + esc(e[1]) + "</div>";
    }).join("");

    var tabs = (s.riffs || []).map(function (r) { return tabHtml(r, chordPt); }).join("");

    return '<section class="sheet songsheet">' + head + structure + chords +
      extraHtml + tabs + "</section>";
  }

  /* ---- whole document ----------------------------------------------- */
  function renderPreview(state, opts) {
    opts = opts || {};
    var bw = !!opts.bw;
    var chordPt = +opts.chordPt || 12;
    var html = cover(state, bw);
    state.songs.forEach(function (s) { html += songsheet(s, bw, chordPt); });
    return html;
  }

  FG.renderPreview = renderPreview;
  FG.fillOf = fillOf; FG.inkOf = inkOf;
})(typeof window !== "undefined" ? window : globalThis);
