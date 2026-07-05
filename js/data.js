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
      else if (t === "chord") {               // several notes at the same time:
        var pairs = e[1] || [];               //   ["chord", [["E",3],["A",5],...]]
        var wmax = 1;
        pairs.forEach(function (p) { wmax = Math.max(wmax, String(p[1]).length); });
        var cc = col(wmax + 1);
        pairs.forEach(function (p) {
          var pidx = STR_INDEX[p[0]]; if (pidx == null) return;
          var f = String(p[1]);
          cc.cells[pidx] = "-" + f + new Array(wmax - f.length + 1).join("-");
        });
        cols.push(cc);
      }
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

  /* Render events -> array of blocks (each block = 6 lines), wrapped at maxw chars.
   * A ["nl"] event forces the wrap right there (manual line skip). */
  function renderTab(events, opts) {
    opts = opts || {};
    var maxw = opts.maxw || 72;
    var ascii = !!opts.ascii;
    if (!events || !events.length) return emptyGrid(opts.emptyCols || 8);

    // manual line breaks: split on ["nl"], render each segment, stack blocks
    var hasNl = events.some(function (e) { return e[0] === "nl"; });
    if (hasNl) {
      var segs = [], cur = [];
      events.forEach(function (e) {
        if (e[0] === "nl") { segs.push(cur); cur = []; } else cur.push(e);
      });
      segs.push(cur);
      var out = [];
      segs.forEach(function (sg) { if (sg.length) out = out.concat(renderTab(sg, opts)); });
      return out.length ? out : emptyGrid(opts.emptyCols || 8);
    }

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

  /* ---------- rhythm notation (pure, shared by pad + sheets) ----------
   * slots = bool array on a 16th (div=4) or triplet (div=3) grid.
   * Tokens: {h:'w|h|q0|q1|q2', dot, t3, tie} notes, {bar:1} barlines,
   * {rest:1} leading silence. SVG is drawn (no font roulette).
   */
  var RTOK4 = { 1: { h: "q2" }, 2: { h: "q1" }, 3: { h: "q1", dot: 1 }, 4: { h: "q0" } };
  var RTOK3 = { 1: { h: "q1", t3: 1 }, 2: { h: "q0", t3: 1 }, 3: { h: "q0" } };
  // Notes are capped at ONE BEAT; the space to the next onset becomes REAL
  // RESTS (taps are percussive — silences must show). The final note's value
  // copies the PREVIOUS gap (local feel), not a global average.
  function rhythmTokens(slots, div, bpb) {
    var N = slots.length, on = [];
    for (var i0 = 0; i0 < N; i0++) if (slots[i0]) on.push(i0);
    if (!on.length) return [];
    var MAP = div === 4 ? RTOK4 : RTOK3;
    var restKeys = div === 4 ? [16, 8, 4, 2, 1] : [12, 6, 3, 1];
    var restH = div === 4 ? { 16: "w", 8: "h", 4: "q0", 2: "q1", 1: "q2" }
                          : { 12: "w", 6: "h", 3: "q0", 1: "q1" };
    var perBar = bpb * div, toks = [];
    function pushRests(dur) {
      var rem = dur;
      while (rem > 0) {
        var kk = null;
        for (var j = 0; j < restKeys.length; j++) if (restKeys[j] <= rem) { kk = restKeys[j]; break; }
        toks.push({ rest: 1, h: restH[kk], t3: (div === 3 && kk === 1) ? 1 : 0 });
        rem -= kk;
      }
    }
    // silence walker: emits rests, inserting barlines at bar boundaries
    function walkSilence(p, q) {
      while (p < q) {
        if (p % perBar === 0 && p > 0 && !(toks.length && toks[toks.length - 1].bar))
          toks.push({ bar: 1 });                    // rest run hits/starts a barline
        var nb = (Math.floor(p / perBar) + 1) * perBar;
        var chunk = Math.min(q, nb) - p;
        if (chunk > 0) pushRests(chunk);
        p += chunk;
      }
    }
    if (on[0] > 0) walkSilence(0, on[0]);
    var lastEnd = N;
    for (var i = 0; i < on.length; i++) {
      // barline right before a note that starts a new bar (no rest in between)
      if (on[i] > 0 && on[i] % perBar === 0 &&
          !(toks.length && toks[toks.length - 1].bar)) toks.push({ bar: 1 });
      var full = (i + 1 < on.length) ? (on[i + 1] - on[i])
        : Math.min(N - on[i], (i > 0 ? on[i] - on[i - 1] : div));
      var dur = Math.min(full, div);                // cap at one beat
      var tk0 = MAP[dur] || MAP[1];
      toks.push({ h: tk0.h, dot: tk0.dot, t3: tk0.t3 });
      if (i + 1 < on.length && full > dur) walkSilence(on[i] + dur, on[i + 1]);
      if (i + 1 === on.length) lastEnd = on[i] + dur;
    }
    walkSilence(lastEnd, N);                        // the LAST silence counts too
    return toks;
  }
  function rhythmSVG(slots, div, bpb, opts) {
    opts = opts || {};
    var INK = opts.ink || "#1b1f24";
    var toks = rhythmTokens(slots, div, bpb);
    if (!toks.length) return "";
    var x = 6, parts = [];
    toks.forEach(function (tk) {
      if (tk.rest) {                                  // drawn rest glyphs
        var rx = x + 4, g = ['<g class="rst" opacity=".75">'];
        if (tk.h === "w")       g.push('<rect x="' + (rx - 4) + '" y="13" width="9" height="3.6" fill="' + INK + '"/>');
        else if (tk.h === "h")  g.push('<rect x="' + (rx - 4) + '" y="17.5" width="9" height="3.6" fill="' + INK + '"/>');
        else if (tk.h === "q0") g.push('<path d="M ' + (rx - 1) + ' 10 l 4 5 -4 5 4 5 q -6 -1 -3 5" fill="none" stroke="' + INK + '" stroke-width="1.7"/>');
        else {                                        // eighth / sixteenth rest: hooked slash
          var hooks = tk.h === "q2" ? 2 : 1;
          g.push('<line x1="' + (rx + 3) + '" y1="12" x2="' + (rx - 2) + '" y2="28" stroke="' + INK + '" stroke-width="1.5"/>');
          for (var hK = 0; hK < hooks; hK++)
            g.push('<circle cx="' + (rx - 2 + hK) + '" cy="' + (14 + hK * 5) + '" r="1.9" fill="' + INK + '"/>' +
                   '<path d="M ' + (rx - 2 + hK) + " " + (14 + hK * 5) + " Q " + (rx + 3) + " " + (16 + hK * 5) + " " + (rx + 3 - hK) + " " + (12.5 + hK * 5) + '" fill="none" stroke="' + INK + '" stroke-width="1.2"/>');
        }
        if (tk.t3) g.push('<text x="' + (rx - 3) + '" y="7" font-size="9" fill="' + (opts.accent || "#b98600") + '">3</text>');
        g.push("</g>");
        parts.push(g.join(""));
        x += 17; return;
      }
      if (tk.bar) { parts.push('<line x1="' + (x + 2) + '" y1="6" x2="' + (x + 2) + '" y2="32" stroke="' + INK + '" stroke-width="1.6" opacity=".55"/>'); x += 11; return; }
      var hx = x + 5, hy = 26;
      var hollow = tk.h === "h" || tk.h === "w";
      parts.push('<ellipse cx="' + hx + '" cy="' + hy + '" rx="4.6" ry="3.4" transform="rotate(-18 ' + hx + " " + hy + ')" fill="' + (hollow ? "none" : INK) + '" stroke="' + INK + '" stroke-width="1.4"/>');
      if (tk.h !== "w")
        parts.push('<line x1="' + (hx + 4.3) + '" y1="' + (hy - 1) + '" x2="' + (hx + 4.3) + '" y2="' + (hy - 17) + '" stroke="' + INK + '" stroke-width="1.4"/>');
      var flags = tk.h === "q1" ? 1 : tk.h === "q2" ? 2 : 0;
      for (var f = 0; f < flags; f++)
        parts.push('<path d="M ' + (hx + 4.3) + " " + (hy - 17 + f * 5) + ' q 7 3 4.5 10" fill="none" stroke="' + INK + '" stroke-width="1.6"/>');
      if (tk.dot) parts.push('<circle cx="' + (hx + 9.5) + '" cy="' + hy + '" r="1.7" fill="' + INK + '"/>');
      if (tk.t3) parts.push('<text x="' + (hx + 1) + '" y="7" font-size="9" fill="' + (opts.accent || "#b98600") + '">3</text>');
      if (tk.tie) parts.push('<path d="M ' + (hx + 6) + " " + (hy + 7) + ' q 8 6 17 0" fill="none" stroke="' + INK + '" stroke-width="1.2"/>');
      x += 23;
    });
    var h = opts.h || 36;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (x + 4) + '" height="' + h +
      '" viewBox="0 0 ' + (x + 4) + ' 36" preserveAspectRatio="xMinYMid meet" style="height:' + h + 'px">' + parts.join("") + "</svg>";
  }
  // a pushed rhythm note is plain text like:
  //   🎵 x··· ··x· | x··· ···· (120 BPM · 4/4 · 16th grid)
  // -> parse it back so every view can re-draw the SVG
  function parseRhythmLine(line) {
    line = String(line || "");
    if (line.indexOf("🎵") !== 0) return null;
    var meta = line.match(/\((\d+)\s*BPM\s*·\s*(\d+)\/4\s*·\s*(16th|triplet) grid\)/);
    var body = line.replace(/^🎵/, "").replace(/\([^)]*\)\s*$/, "");
    var chars = body.replace(/[^x·]/g, "");
    if (!chars || chars.indexOf("x") < 0) return null;
    var slots = [];
    for (var i = 0; i < chars.length; i++) slots.push(chars[i] === "x");
    return { slots: slots, div: meta && meta[3] === "triplet" ? 3 : 4,
             bpb: meta ? +meta[2] : 4, bpm: meta ? +meta[1] : null };
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
      autoNumber: false,
      songs: []
    };
  }

  var API = {
    CATEGORIES: CATEGORIES, BY_KEY: BY_KEY, PRIORITY: PRIORITY, STRINGS: STRINGS,
    classify: classify, structurePills: structurePills,
    renderTab: renderTab, tabToText: tabToText, emptyGrid: emptyGrid,
    repeatCount: repeatCount, tabCount: tabCount,
    grayHex: grayHex, inkOnGray: inkOnGray, hexRgb: hexRgb,
    rhythmTokens: rhythmTokens, rhythmSVG: rhythmSVG, parseRhythmLine: parseRhythmLine,
    todayISO: todayISO, emptySong: emptySong, emptyState: emptyState
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.FG = Object.assign(root.FG || {}, API);
})(typeof window !== "undefined" ? window : globalThis);
