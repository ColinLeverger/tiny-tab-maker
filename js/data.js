/* =====================================================================
 * data.js — pure logic, no DOM.
 *   - section classifier (colors / keywords / priority)
 *   - ASCII tab renderer (events -> 6 string lines, with wrapping)
 *   - small helpers + the empty-state factory
 * Works in the browser (attaches to window.FG) and in Node (module.exports)
 * so the logic can be unit-tested headless.
 * ===================================================================== */
(function (root) {
  "use strict";

  /* ---------- section classification ----------------------------------
   * Ported 1:1 from README_fiches.md "Carte d'arrangement".
   * Each category carries a pastel fill + a darker ink (for borders/labels)
   * and a grayscale level for the B&W variant.
   */
  // Labels are English; keywords accept English AND French so the colour
  // matching keeps working on French section names (couplet, refrain, cuivres…).
  var CATEGORIES = [
    // key        label            keywords (EN + FR)                                          fill       ink        gray
    ["intro",   "Intro",          ["intro"],                                                   "#dbe7fb", "#2f5fb3", 0.86],
    ["chorus",  "Chorus",         ["chorus", "refrain"],                                       "#ffe2c7", "#c4621b", 0.74],
    ["couplet", "Verse",          ["verse", "couplet", "chant"],                               "#d8f0d8", "#2f8f3f", 0.82],
    ["solo",    "Solo",           ["solo"],                                                    "#fbd9ec", "#b03a78", 0.78],
    ["break",   "Break",          ["break"],                                                   "#e6dcf7", "#6b3fb0", 0.80],
    ["cuivres", "Brass",          ["brass", "horn", "trumpet", "cuivre", "trompette", "trp"],  "#fdeeb0", "#9a7400", 0.88],
    ["riff",    "Riff / power",   ["riff", "power"],                                           "#dde3ea", "#4a5a6b", 0.84],
    ["feel",    "Feel",           ["gypsy", "gipsy", "funk", "reggae", "cumbia", "jazz",
                                   "swing", "offbeat", "ska"],                                 "#c9efe9", "#1f7a6e", 0.83],
    ["bridge",  "Bridge",         ["bridge", "pont"],                                          "#dadcf6", "#46499b", 0.81],
    ["fin",     "End / Outro",    ["ending", "end", "outro", "finale", "fin", "tres fin"],     "#cfcfcf", "#444444", 0.66],
    ["other",   "Other",          [],                                                          "#ededed", "#666666", 0.90]
  ];

  // Priority order for first-match-wins classification (README).
  var PRIORITY = ["intro", "chorus", "couplet", "solo", "break",
                  "cuivres", "riff", "feel", "bridge", "fin", "other"];

  var BY_KEY = {};
  CATEGORIES.forEach(function (c) {
    BY_KEY[c[0]] = { key: c[0], label: c[1], keywords: c[2], fill: c[3], ink: c[4], gray: c[5] };
  });

  function stripAccents(s) {
    return (s || "").normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : (s || "");
  }

  // classify a section label -> category object (never null)
  function classify(label) {
    var t = stripAccents(String(label || "")).toLowerCase();
    for (var i = 0; i < PRIORITY.length; i++) {
      var cat = BY_KEY[PRIORITY[i]];
      if (cat.key === "other") continue;
      for (var k = 0; k < cat.keywords.length; k++) {
        if (t.indexOf(stripAccents(cat.keywords[k])) !== -1) return cat;
      }
    }
    return BY_KEY.other;
  }

  // grayscale hex from a 0..1 level
  function grayHex(level) {
    var v = Math.max(0, Math.min(255, Math.round(level * 255)));
    var h = v.toString(16);
    if (h.length < 2) h = "0" + h;
    return "#" + h + h + h;
  }
  // pick black/white ink for readable text on a given gray level
  function inkOnGray(level) { return level < 0.55 ? "#ffffff" : "#111111"; }

  // hex -> [r,g,b] 0..255  (for jsPDF)
  function hexRgb(hex) {
    hex = String(hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  /* ---------- structure roadmap ---------------------------------------
   * Split "A -> B -> C" on arrows, classify each piece into a pill.
   */
  function structurePills(structure) {
    if (!structure) return [];
    return String(structure)
      .split(/→|->/)            // → or ->
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (s) { return { text: s, cat: classify(s) }; });
  }

  /* ---------- ASCII tab renderer --------------------------------------
   * Event format (matches the original tabs_data.py):
   *   ["E",6]            note: [string, fret]   strings top->bottom: e B G D A E
   *   ["E","(3)"]        fret as text (e.g. muted note in parentheses)
   *   ["bar"]            barline                 ->  |
   *   ["repopen"]        repeat open             ->  |:
   *   ["repclose"]       repeat close            ->  :|
   *   ["repclose", n]    repeat close + count    ->  :|   (count shown in the note line)
   *   ["mark"]           point marker            ->  ‡
   *
   * Returns an array of "blocks"; each block is 6 strings (already wrapped).
   * `ascii=true` swaps unicode ‖ ‡ for |  + so jsPDF's Courier can render it.
   */
  var STRINGS = ["e", "B", "G", "D", "A", "E"]; // display order, low E at bottom
  var STR_INDEX = { e: 0, B: 1, G: 2, D: 3, A: 4, E: 5 };

  function repeatCount(events) {
    if (!events) return null;
    for (var i = 0; i < events.length; i++) {
      if (events[i][0] === "repclose" && events[i].length > 1) return events[i][1];
    }
    return null;
  }

  // Build the list of columns. Each column = {w, cells:[6 strings of width w]}.
  function buildColumns(events, ascii) {
    var MARK = ascii ? "*" : "‡"; // ‡
    var cols = [];
    function col(w, fill) {
      var cells = [];
      for (var s = 0; s < 6; s++) cells.push(new Array(w + 1).join(fill || "-"));
      return { w: w, cells: cells };
    }
    function boundary(sym) {                 // leading dash + symbol on every line
      var s = "-" + sym, c = col(s.length);
      for (var i = 0; i < 6; i++) c.cells[i] = s;
      return c;
    }
    for (var i = 0; i < events.length; i++) {
      var e = events[i], t = e[0];
      if (t === "bar")            cols.push(boundary("|"));
      else if (t === "repopen")   cols.push(boundary("|:"));
      else if (t === "repclose")  cols.push(boundary(":|"));
      else if (t === "mark")      cols.push(boundary(MARK));
      else {                                  // a note [string, fret]
        var fret = String(e[1]);
        var c = col(fret.length + 1);         // leading dash + fret
        var idx = STR_INDEX[e[0]];
        if (idx == null) idx = 5;
        c.cells[idx] = "-" + fret;
        cols.push(c);
      }
    }
    return cols;
  }

  // start edge after the label: "|:" if the tab opens on a repeat, else "|"
  function startEdge(events) {
    return (events.length && events[0][0] === "repopen") ? "|:" : "|";
  }

  /* Render events -> array of blocks (each block = 6 lines), wrapped at maxw chars. */
  function renderTab(events, opts) {
    opts = opts || {};
    var maxw = opts.maxw || 72;
    var ascii = !!opts.ascii;
    if (!events || !events.length) return emptyGrid(opts.emptyCols || 8);

    var cols = buildColumns(events.filter(function (e) {
      return e[0] !== "repopen" || true; // keep all; repopen handled as boundary too
    }), ascii);

    // If the first event is a repopen we rendered it as a boundary column with a
    // leading dash ("-|:"). Drop that first column and fold it into the start edge.
    var edge = "|";
    if (events[0][0] === "repopen") { edge = "|:"; cols.shift(); }

    var blocks = [];
    var first = true;
    var i = 0;
    while (i < cols.length || first) {
      var prefixEdge = first ? edge : "|";
      var lines = STRINGS.map(function (lab) { return lab + prefixEdge; });
      var used = lines[0].length;
      var placedAny = false;
      while (i < cols.length) {
        var w = cols[i].w;
        if (placedAny && used + w > maxw) break;   // wrap (but always place >=1 col)
        for (var s = 0; s < 6; s++) lines[s] += cols[i].cells[s];
        used += w; placedAny = true; i++;
      }
      // close the block with a trailing barline unless it already ends on a boundary
      var lastWasBoundary = i <= cols.length && i > 0 &&
        /[|:]$/.test(cols[i - 1].cells[5]);
      if (!lastWasBoundary) for (var s2 = 0; s2 < 6; s2++) lines[s2] += "-|";
      blocks.push(lines);
      first = false;
      if (i >= cols.length) break;
    }
    return blocks;
  }

  function emptyGrid(ncols) {
    ncols = ncols || 8;
    var seg = new Array(ncols + 1).join("---");   // 3 chars per empty position
    return [STRINGS.map(function (lab) { return lab + "|" + seg + "|"; })];
  }

  // flatten blocks to a single string (blocks separated by a blank line)
  function tabToText(events, opts) {
    return renderTab(events, opts).map(function (b) { return b.join("\n"); }).join("\n\n");
  }

  /* ---------- misc helpers -------------------------------------------- */
  function tabCount(song) {
    return (song.riffs || []).filter(function (r) { return r.tab && r.tab.length; }).length;
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function emptySong(num) {
    return {
      num: num || "00", title: "New song", group: "",
      key: "", tempo: "", meter: "", feel: "",
      structure: "", chords: [], riffs: [], breaks: "", notes: ""
    };
  }
  function emptyState() {
    return {
      meta: {
        band: "My Band",
        subtitle: "Guitar prep — play sheets",
        notation: "Notation: chords EN / flats only (Ab Bb Db Eb Gb)",
        updated: todayISO()
      },
      songs: []
    };
  }

  var API = {
    CATEGORIES: CATEGORIES, BY_KEY: BY_KEY, PRIORITY: PRIORITY, STRINGS: STRINGS,
    classify: classify, structurePills: structurePills,
    renderTab: renderTab, tabToText: tabToText, emptyGrid: emptyGrid,
    repeatCount: repeatCount, tabCount: tabCount,
    grayHex: grayHex, inkOnGray: inkOnGray, hexRgb: hexRgb,
    todayISO: todayISO, emptySong: emptySong, emptyState: emptyState
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.FG = Object.assign(root.FG || {}, API);
})(typeof window !== "undefined" ? window : globalThis);
