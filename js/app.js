/* =====================================================================
 * app.js — UI state, editor, fret-grid tab editor, persistence.
 * Pure vanilla JS. State autosaves to localStorage; real data never
 * leaves the browser. Import/Export JSON to move data between machines.
 * ===================================================================== */
(function (root) {
  "use strict";
  var FG = root.FG;
  var LS_KEY = "fg_fiches_state_v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  var RESTORED = false;
  var STATE = load();
  var UI = { bw: false, compact: false, chordPt: 18, openSong: null };

  // view prefs (compact / B&W / size) persist too, so the preview is correct at
  // page load without having to re-toggle anything.
  var UI_KEY = "fg_ui_v1";
  (function () {
    try {
      var u = JSON.parse(localStorage.getItem(UI_KEY) || "null") || {};
      if (typeof u.bw === "boolean") UI.bw = u.bw;
      if (typeof u.compact === "boolean") UI.compact = u.compact;
      if (u.chordPt) UI.chordPt = +u.chordPt || UI.chordPt;
    } catch (e) {}
  })();
  function persistUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ bw: UI.bw, compact: UI.compact, chordPt: UI.chordPt })); } catch (e) {}
  }

  // ---- auto "last updated": stamp today on the first change of the session ----
  var DATE_TOUCHED = false;
  function touchUpdated() {
    if (DATE_TOUCHED) return;
    DATE_TOUCHED = true;
    STATE.meta.updated = FG.todayISO();
    var mi = $('#metaCard [data-meta="updated"]'); if (mi) mi.value = STATE.meta.updated;
  }
  // ---- auto-numbering: renumber songs 1..n top-to-bottom when enabled ----
  function applyAutoNumber() {
    if (!STATE.autoNumber) return;
    STATE.songs.forEach(function (s, i) { s.num = String(i + 1).padStart(2, "0"); });
  }
  // move arr[from] so it sits at `insert` (index in the pre-removal array)
  function moveInArray(arr, from, insert) {
    if (from < 0 || from >= arr.length) return insert;
    var it = arr.splice(from, 1)[0];
    if (insert > from) insert--;
    insert = Math.max(0, Math.min(arr.length, insert));
    arr.splice(insert, 0, it);
    return insert;
  }

  // ---- undo history (unlimited depth) ----
  // Structural edits snapshot immediately (pushHistory); a burst of typing in one
  // field snapshots once — captured on focus, committed on the first keystroke.
  var history = [];
  var pendingSnap = null, pendingCommitted = true;
  function pushHistory() { history.push(clone(STATE)); updateUndoBtn(); }
  function commitPending() {
    if (pendingSnap && !pendingCommitted) { history.push(pendingSnap); pendingCommitted = true; updateUndoBtn(); }
  }
  function updateUndoBtn() { var b = $("#undoBtn"); if (b) b.disabled = history.length === 0; }
  function undo() {
    commitPending();                 // fold an in-progress field edit into history
    if (!history.length) return;
    STATE = history.pop();
    if (UI.openSong != null && UI.openSong >= STATE.songs.length) UI.openSong = null;
    var an = $("#autoNumToggle"); if (an) an.checked = !!STATE.autoNumber;
    renderAll();                     // re-render + persist; does NOT push history
    updateUndoBtn();
  }

  // is localStorage usable at all? (some browsers block it on file://)
  var STORAGE_OK = (function () {
    try { localStorage.setItem("_t", "1"); localStorage.removeItem("_t"); return true; }
    catch (e) { return false; }
  })();

  function load() {
    try { var raw = localStorage.getItem(LS_KEY); if (raw) { RESTORED = true; return JSON.parse(raw); } } catch (e) {}
    return clone(FG.DEMO);
  }
  var saveT;
  function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (!STORAGE_OK) { setStatus("⚠︎ browser storage unavailable", true); return; }
      try { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); setStatus("✓ Saved in browser"); }
      catch (e) { setStatus("⚠︎ save failed (storage full?)", true); }
    }, 250);
  }
  var statusT;
  function setStatus(txt, warn) {
    var el = $("#saveStatus"); if (!el) return;
    el.textContent = txt; el.classList.toggle("warn", !!warn); el.classList.add("show");
    clearTimeout(statusT);
    if (!warn) statusT = setTimeout(function () { el.classList.remove("show"); }, 1600);
  }

  var prevT;
  function updatePreview() {
    clearTimeout(prevT);
    prevT = setTimeout(function () {
      var pv = $("#preview");
      pv.className = UI.compact ? "compact" : "";
      pv.style.setProperty("--fs", UI.chordPt + "pt");
      var opts = { bw: UI.bw, chordPt: UI.chordPt, compact: UI.compact };
      // mirror the real PDF pagination (page count + compact grouping)
      var pg = (FG.paginate && STATE.songs.length && STATE.songs.length <= 60)
        ? FG.paginate(STATE, opts) : null;
      pv.innerHTML = FG.renderPreview(STATE, opts, pg && pg.songPage);
      updatePageCount(pg);
      if (root.__ttmStageRefresh) root.__ttmStageRefresh();   // keep View mode in sync
    }, 160);
  }
  function updatePageCount(pg) {
    var el = $("#pageCount"); if (!el) return;
    if (pg && pg.pages) el.textContent = "PDF: " + pg.pages + (pg.pages > 1 ? " pages" : " page");
    else if (STATE.songs.length > 60) el.textContent = "PDF: many pages";
    else el.textContent = "";
  }

  /* ---------------- editor: meta ---------------- */
  function fillMeta() {
    $$("#metaCard [data-meta]").forEach(function (inp) {
      inp.value = (STATE.meta && STATE.meta[inp.getAttribute("data-meta")]) || "";
    });
  }

  /* ---------------- rehearsal helpers (marks + section notes) ---------------- */
  // song.rehearsal = { "<section text>": {c:"red"|"yellow", note:"..."}, "__song": {...} }
  function rhWorst(rh) {
    var c = null, note = false;
    Object.keys(rh || {}).forEach(function (k) {
      var e = rh[k]; if (!e) return;
      if (e.c === "red") c = "red"; else if (e.c === "yellow" && c !== "red") c = "yellow";
      if (e.note) note = true;
    });
    return { c: c, note: note };
  }
  function rhDot(rh) {
    var w = rhWorst(rh);
    if (!w.c && !w.note) return "";
    return '<span class="rdot ' + (w.c || "note") + '"></span>';
  }
  function songSections(s) {
    var seen = {}, out = [];
    FG.structurePills(s.structure).forEach(function (p) {
      if (!seen[p.text]) { seen[p.text] = 1; out.push(p.text); }
    });
    return out;
  }
  function rhLabel(k) { return k === "__song" ? "♪ Song" : k; }

  /* ---------------- editor: songs ---------------- */
  function songCard(s, i) {
    var open = UI.openSong === i;
    var chordRows = (s.chords || []).map(function (c, ci) {
      return '<div class="pair">' +
        '<span class="grip" draggable="true" data-drag="chord" data-song="' + i + '" data-ci="' + ci + '" title="Drag to reorder">⠿</span>' +
        '<input data-song="' + i + '" data-ci="' + ci + '" data-part="label" value="' + esc(c.label) + '" placeholder="Section">' +
        '<input data-song="' + i + '" data-ci="' + ci + '" data-part="value" value="' + esc(c.value) + '" placeholder="Chords / text">' +
        '<button class="btn sm danger" data-act="delChord" data-song="' + i + '" data-ci="' + ci + '">✕</button>' +
        "</div>";
    }).join("");

    var riffRows = (s.riffs || []).map(function (r, ri) {
      var has = r.tab && r.tab.length;
      return '<div class="riff-row">' +
        '<input class="rl" data-song="' + i + '" data-ri="' + ri + '" data-part="label" value="' + esc(r.label) + '" placeholder="Riff name">' +
        '<span class="badge ' + (has ? "" : "empty") + '">' + (has ? r.tab.length + " evts" : "blank grid") + "</span>" +
        '<button class="btn sm" data-act="editTab" data-song="' + i + '" data-ri="' + ri + '">✎ tab</button>' +
        '<button class="btn sm danger" data-act="delRiff" data-song="' + i + '" data-ri="' + ri + '">✕</button>' +
        '<input class="rnote" data-song="' + i + '" data-ri="' + ri + '" data-part="note" value="' + esc(r.note) + '" placeholder="Annotation (e.g. ×4)" style="grid-column:1/-1;margin-top:.3rem;padding:.3rem .45rem;border:1px solid var(--line2);border-radius:6px">' +
        "</div>";
    }).join("");

    // rehearsal rows (only entries that exist): color cycle · section · note · delete
    var rhKeys = Object.keys(s.rehearsal || {}).filter(function (k) {
      var e = s.rehearsal[k]; return e && (e.c || e.note);
    });
    var rhRows = rhKeys.length
      ? '<div class="sub">Rehearsal marks 🖍</div>' + rhKeys.map(function (k) {
          var e = s.rehearsal[k];
          return '<div class="rh-edit">' +
            '<button class="btn sm rh-c ' + (e.c || "") + '" data-act="rhColor" data-song="' + i + '" data-sec="' + esc(k) + '" title="Cycle: red → yellow → none">●</button>' +
            '<span class="rh-sec">' + esc(rhLabel(k)) + "</span>" +
            '<textarea rows="1" data-song="' + i + '" data-rh="' + esc(k) + '" placeholder="Note">' + esc(e.note || "") + "</textarea>" +
            '<button class="btn sm danger" data-act="rhDel" data-song="' + i + '" data-sec="' + esc(k) + '">✕</button>' +
            "</div>";
        }).join("")
      : "";

    return '<div class="song-card' + (open ? " open" : "") + '" data-card="' + i + '">' +
      '<div class="sc-head" data-toggle="' + i + '" data-drag="song" data-song="' + i + '" draggable="true" title="Drag the bar to reorder">' +
        '<span class="grip" aria-hidden="true">⠿</span>' +
        '<span class="num">' + esc(s.num) + rhDot(s.rehearsal) + "</span>" +
        '<span class="ttl">' + esc(s.title || "(untitled)") + "</span>" +
        '<button class="btn sm" data-act="up" data-song="' + i + '" title="Up">▲</button>' +
        '<button class="btn sm" data-act="down" data-song="' + i + '" title="Down">▼</button>' +
        '<span class="chev">›</span>' +
      "</div>" +
      '<div class="sc-body">' +
        '<div class="grid2">' +
          '<div class="row"><label>No.' + (STATE.autoNumber ? " (auto)" : "") + '</label><input data-song="' + i + '" data-field="num" value="' + esc(s.num) + '"' + (STATE.autoNumber ? ' readonly title="Auto-numbered — turn off Auto-№ to edit"' : "") + "></div>" +
          '<div class="row"><label>Group / album</label><input data-song="' + i + '" data-field="group" value="' + esc(s.group) + '"></div>' +
        "</div>" +
        '<div class="row"><label>Title</label><input data-song="' + i + '" data-field="title" value="' + esc(s.title) + '"></div>' +
        '<div class="grid2">' +
          '<div class="row"><label>Key</label><input data-song="' + i + '" data-field="key" value="' + esc(s.key) + '"></div>' +
          '<div class="row"><label>Tempo</label><div class="tempo-wrap">' +
            '<input data-song="' + i + '" data-field="tempo" value="' + esc(s.tempo) + '">' +
            '<button class="btn sm" data-act="tapTempo" data-song="' + i + '" title="Tap the beat on this button — after 10 s (or a pause) the tempo lands in the field as ~BPM">🥁</button>' +
          "</div></div>" +
          '<div class="row"><label>Meter</label><input data-song="' + i + '" data-field="meter" value="' + esc(s.meter) + '"></div>' +
          '<div class="row"><label>Feel</label><input data-song="' + i + '" data-field="feel" value="' + esc(s.feel) + '"></div>' +
        "</div>" +
        '<div class="row"><label>Structure (sections separated by →)</label>' +
          '<textarea data-song="' + i + '" data-field="structure" rows="2">' + esc(s.structure) + "</textarea></div>" +
        '<div class="sub">Chords by section</div>' + chordRows +
        '<button class="addline" data-act="addChord" data-song="' + i + '">＋ chord section</button>' +
        '<div class="sub">Riffs / tabs</div>' + riffRows +
        '<button class="addline" data-act="addRiff" data-song="' + i + '">＋ riff</button>' +
        rhRows +
        '<div class="grid2" style="margin-top:.5rem">' +
          '<div class="row"><label>Breaks</label><input data-song="' + i + '" data-field="breaks" value="' + esc(s.breaks) + '"></div>' +
          '<div class="row"><label>Notes</label><input data-song="' + i + '" data-field="notes" value="' + esc(s.notes) + '"></div>' +
        "</div>" +
        '<div class="sc-actions"><button class="btn sm danger" data-act="delSong" data-song="' + i + '">🗑 Delete song</button></div>' +
      "</div></div>";
  }

  function renderEditor() {
    fillMeta();
    var host = $("#editor-list");
    if (!STATE.songs.length) {
      host.innerHTML = '<div class="empty-hint">No songs yet. Use “＋ Add a song” or Data → Load demo.</div>';
      return;
    }
    host.innerHTML = STATE.songs.map(songCard).join("");
  }

  /* ---------------- setlists: stable ids + active set ---------------- */
  // Setlists reference songs by id, so reordering/renaming the book never
  // breaks a set. STATE.setlists = [{name, songs:[id,...]}], activeSet = index|null.
  function uid() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ensureIds() {
    (STATE.songs || []).forEach(function (s) { if (!s.id) s.id = uid(); });
    if (!Array.isArray(STATE.setlists)) STATE.setlists = [];
    // drop ids of deleted songs; drop a dangling active index
    var live = {}; STATE.songs.forEach(function (s) { live[s.id] = 1; });
    STATE.setlists.forEach(function (sl) {
      sl.songs = (sl.songs || []).filter(function (id) { return live[id]; });
    });
    if (STATE.activeSet != null && !STATE.setlists[STATE.activeSet]) STATE.activeSet = null;
  }
  function activeSetlist() {
    return (STATE.activeSet != null && STATE.setlists && STATE.setlists[STATE.activeSet]) || null;
  }
  function songIdxById() {
    var m = {}; STATE.songs.forEach(function (s, i) { m[s.id] = i; }); return m;
  }
  // navigation order as book-song indices (whole book, or the active set's order)
  function navSongIdx() {
    var al = activeSetlist();
    if (!al) return STATE.songs.map(function (_, i) { return i; });
    var by = songIdxById();
    return al.songs.map(function (id) { return by[id]; })
      .filter(function (i) { return i != null; });
  }

  function renderAll() { ensureIds(); applyAutoNumber(); renderEditor(); updatePreview(); persist(); }

  /* ---------------- editor events ---------------- */
  // snapshot the state when a field gains focus, so a whole typing burst in that
  // field becomes a single undo step (committed on the first keystroke).
  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.readOnly &&
        (t.hasAttribute("data-song") || t.hasAttribute("data-meta"))) {
      pendingSnap = clone(STATE); pendingCommitted = false;
    }
  });

  // text inputs: mutate in place, do NOT rebuild editor (keep focus)
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-meta")) {
      var mk = t.getAttribute("data-meta");
      commitPending();
      // editing the date by hand is an explicit override; don't auto-stamp over it
      if (mk === "updated") DATE_TOUCHED = true; else touchUpdated();
      STATE.meta[mk] = t.value; updatePreview(); persist(); return;
    }
    var si = t.getAttribute && t.getAttribute("data-song");
    if (si == null) return;
    si = +si; var s = STATE.songs[si]; if (!s) return;
    commitPending();
    touchUpdated();
    if (t.hasAttribute("data-field")) { s[t.getAttribute("data-field")] = t.value; }
    else if (t.hasAttribute("data-rh")) {
      var rk = t.getAttribute("data-rh");
      s.rehearsal = s.rehearsal || {};
      s.rehearsal[rk] = s.rehearsal[rk] || {};
      s.rehearsal[rk].note = t.value;
      if (!t.value) delete s.rehearsal[rk].note;
    }
    else if (t.hasAttribute("data-ci")) {
      var ci = +t.getAttribute("data-ci"); s.chords[ci][t.getAttribute("data-part")] = t.value;
    } else if (t.hasAttribute("data-ri")) {
      var ri = +t.getAttribute("data-ri"); s.riffs[ri][t.getAttribute("data-part")] = t.value;
    }
    updatePreview(); persist();
  });

  // clicks: structural changes -> rebuild editor
  $("#editor-list").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act],[data-toggle]"); if (!btn) return;
    var tog = btn.getAttribute("data-toggle");
    if (tog != null) { UI.openSong = (UI.openSong === +tog) ? null : +tog; renderEditor(); return; }
    var act = btn.getAttribute("data-act");
    var si = +btn.getAttribute("data-song"); var s = STATE.songs[si];
    if (act !== "editTab") touchUpdated();            // any structural edit stamps the date
    if (act === "up" || act === "down") {
      e.stopPropagation();
      var j = act === "up" ? si - 1 : si + 1;
      if (j < 0 || j >= STATE.songs.length) return;
      pushHistory();
      var tmp = STATE.songs[si]; STATE.songs[si] = STATE.songs[j]; STATE.songs[j] = tmp;
      if (UI.openSong === si) UI.openSong = j; else if (UI.openSong === j) UI.openSong = si;
      renderAll(); return;
    }
    if (act === "delSong") { if (confirm("Delete “" + (s.title || "") + "”?")) { pushHistory(); STATE.songs.splice(si, 1); UI.openSong = null; renderAll(); } return; }
    if (act === "addChord") { pushHistory(); s.chords.push({ label: "", value: "" }); renderAll(); return; }
    if (act === "delChord") { pushHistory(); s.chords.splice(+btn.getAttribute("data-ci"), 1); renderAll(); return; }
    if (act === "addRiff") { pushHistory(); s.riffs.push({ label: "Riff", note: "", tab: null }); renderAll(); return; }
    if (act === "delRiff") { pushHistory(); s.riffs.splice(+btn.getAttribute("data-ri"), 1); renderAll(); return; }
    if (act === "editTab") { openTabEditor(si, +btn.getAttribute("data-ri")); return; }
    if (act === "rhColor") {
      var rk1 = btn.getAttribute("data-sec"), e1 = s.rehearsal && s.rehearsal[rk1];
      if (!e1) return;
      pushHistory();
      e1.c = e1.c === "red" ? "yellow" : e1.c === "yellow" ? null : "red";
      if (!e1.c) delete e1.c;
      if (!e1.c && !e1.note) { delete s.rehearsal[rk1]; }
      renderAll(); return;
    }
    if (act === "rhDel") {
      pushHistory();
      if (s.rehearsal) delete s.rehearsal[btn.getAttribute("data-sec")];
      if (s.rehearsal && !Object.keys(s.rehearsal).length) delete s.rehearsal;
      renderAll(); return;
    }
    if (act === "tapTempo") { e.stopPropagation(); tapTempoClick(si); return; }
  });

  /* =====================================================================
   *  INLINE TAP TEMPO — tap the 🥁 button next to a song's Tempo field.
   *  Session = 10 s from the first tap (or 2.5 s of silence, whichever
   *  first), then "~<bpm> BPM" is written into the field. No page hop.
   * ===================================================================== */
  var TAPT = null; // { si, taps:[], t10, tIdle }
  function tapTempoBtn(si) { return $('button[data-act="tapTempo"][data-song="' + si + '"]'); }
  function tapTempoFinish() {
    if (!TAPT) return;
    clearTimeout(TAPT.t10); clearTimeout(TAPT.tIdle);
    var si = TAPT.si, taps = TAPT.taps;
    TAPT = null;
    var btn = tapTempoBtn(si); if (btn) btn.textContent = "🥁";
    if (taps.length < 3) { setStatus("⚠︎ tap at least 3 times", true); return; }
    var gaps = [];
    for (var i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
    var avg = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
    var bpm = Math.round(60000 / avg);
    if (bpm < 20 || bpm > 300) { setStatus("⚠︎ tempo out of range (" + bpm + ")", true); return; }
    var s = STATE.songs[si]; if (!s) return;
    pushHistory();
    s.tempo = "~" + bpm + " BPM";
    var inp = $('input[data-song="' + si + '"][data-field="tempo"]');
    if (inp) inp.value = s.tempo;      // update in place (keep the card as-is)
    touchUpdated(); updatePreview(); persist();
    setStatus("✓ Tempo: ~" + bpm + " BPM (" + taps.length + " taps)");
  }
  function tapTempoClick(si) {
    var now = performance.now();
    if (TAPT && TAPT.si !== si) tapTempoFinish();      // switched songs mid-session
    if (!TAPT) {
      TAPT = { si: si, taps: [], t10: setTimeout(tapTempoFinish, 10000), tIdle: null };
    }
    TAPT.taps.push(now);
    clearTimeout(TAPT.tIdle);
    TAPT.tIdle = setTimeout(tapTempoFinish, 2500);
    var btn = tapTempoBtn(si);
    if (btn) {
      if (TAPT.taps.length > 1) {
        var g = [];
        for (var i = 1; i < TAPT.taps.length; i++) g.push(TAPT.taps[i] - TAPT.taps[i - 1]);
        btn.textContent = "…" + Math.round(60000 / (g.reduce(function (a, b) { return a + b; }, 0) / g.length));
      } else btn.textContent = "…tap";
    }
  }

  $("#addSong").addEventListener("click", function () {
    pushHistory();
    var n = String(STATE.songs.length + 1).padStart(2, "0");
    STATE.songs.push(FG.emptySong(n)); UI.openSong = STATE.songs.length - 1;
    touchUpdated(); renderAll();
  });

  /* =====================================================================
   *  DRAG & DROP  — reorder songs (by header grip) and chord sections
   *  (by row grip). HTML5 DnD, delegated on the editor list.
   * ===================================================================== */
  var listEl = $("#editor-list");
  var DRAG = null;
  function clearDropMarks() {
    $$(".drop-before,.drop-after", listEl).forEach(function (n) {
      n.classList.remove("drop-before", "drop-after");
    });
  }
  function cleanupDrag() {
    $$(".dragging", listEl).forEach(function (n) { n.classList.remove("dragging"); });
    clearDropMarks(); DRAG = null;
  }
  function isBefore(e, el) {
    var r = el.getBoundingClientRect();
    return (e.clientY - r.top) < r.height / 2;
  }
  listEl.addEventListener("dragstart", function (e) {
    // songs drag from the whole header bar; chord sections drag from their grip
    var d = e.target.closest && e.target.closest("[data-drag]");
    if (!d) { return; }
    DRAG = {
      type: d.getAttribute("data-drag"),
      song: +d.getAttribute("data-song"),
      ci: d.hasAttribute("data-ci") ? +d.getAttribute("data-ci") : null
    };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", DRAG.type); } catch (_) {}
    }
    var src = d.closest(DRAG.type === "song" ? "[data-card]" : ".pair");
    if (src) src.classList.add("dragging");
  });
  listEl.addEventListener("dragover", function (e) {
    if (!DRAG) return;
    var tgt = DRAG.type === "song" ? e.target.closest("[data-card]")
                                   : e.target.closest(".pair");
    if (!tgt) return;
    if (DRAG.type === "chord") {                       // chords only reorder within their song
      var tg = tgt.querySelector(".grip[data-drag=chord]");
      if (!tg || +tg.getAttribute("data-song") !== DRAG.song) return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    tgt.classList.add(isBefore(e, tgt) ? "drop-before" : "drop-after");
  });
  listEl.addEventListener("drop", function (e) {
    if (!DRAG) return;
    var type = DRAG.type;
    var tgt = type === "song" ? e.target.closest("[data-card]")
                              : e.target.closest(".pair");
    if (tgt) {
      e.preventDefault();
      var before = isBefore(e, tgt);
      if (type === "song") {
        var to = +tgt.getAttribute("data-card");
        pushHistory();
        var openObj = UI.openSong != null ? STATE.songs[UI.openSong] : null;
        moveInArray(STATE.songs, DRAG.song, before ? to : to + 1);
        UI.openSong = openObj ? STATE.songs.indexOf(openObj) : null;
        touchUpdated(); cleanupDrag(); renderAll(); return;
      }
      var tg = tgt.querySelector(".grip[data-drag=chord]");
      var s = STATE.songs[DRAG.song];
      if (s && tg && DRAG.ci != null) {
        var toc = +tg.getAttribute("data-ci");
        pushHistory();
        moveInArray(s.chords, DRAG.ci, before ? toc : toc + 1);
        touchUpdated(); cleanupDrag(); renderAll(); return;
      }
    }
    cleanupDrag();
  });
  listEl.addEventListener("dragend", cleanupDrag);

  // meta card toggle
  $("#metaCard .sc-head").addEventListener("click", function () { $("#metaCard").classList.toggle("open"); });

  /* =====================================================================
   *  TAB GRID EDITOR
   * ===================================================================== */
  var TAB = null; // { si, ri, events:[...] }
  var SYM = { bar: "|", repopen: "|:", repclose: ":|", mark: "‡" };

  function openTabEditor(si, ri) {
    var r = STATE.songs[si].riffs[ri];
    TAB = { si: si, ri: ri, events: clone(r.tab || []) };
    $("#tabModalTitle").textContent = "Tab — " + (r.label || "Riff");
    drawGrid();
    $("#tabModal").classList.add("open");
  }
  function closeTab() { $("#tabModal").classList.remove("open"); TAB = null; }

  function drawGrid() {
    var ev = TAB.events;
    var strings = FG.STRINGS; // e B G D A E
    // header tools row
    var head = '<tr class="colhead"><td class="slabel"></td>';
    ev.forEach(function (e, i) {
      head += '<td><div class="coltools">' +
        '<button data-tg="left" data-col="' + i + '" title="←">←</button>' +
        '<button data-tg="del" data-col="' + i + '" title="suppr">✕</button>' +
        '<button data-tg="right" data-col="' + i + '" title="→">→</button>' +
        "</div></td>";
    });
    head += '<td class="symcol">＋</td></tr>';

    var rows = strings.map(function (str, sIdx) {
      var cells = ev.map(function (e, i) {
        if (e[0] === "bar" || e[0] === "repopen" || e[0] === "repclose" || e[0] === "mark") {
          // symbol spans visually; show on middle row only, blank elsewhere
          if (sIdx === 0) {
            var label = SYM[e[0]] + (e[0] === "repclose" && e[1] ? "×" + e[1] : "");
            return '<td rowspan="6" class="symcell" data-tg="sym" data-col="' + i + '">' + esc(label) + "</td>";
          }
          return ""; // covered by rowspan
        }
        var isHere = (e[0] === str);
        var txt = isHere ? esc(String(e[1])) : "·";
        return '<td><button class="cellbtn ' + (isHere ? "set" : "") + '" data-tg="note" data-col="' + i + '" data-str="' + str + '">' + txt + "</button></td>";
      }).join("");
      var addCell = '<td><button class="cellbtn" data-tg="add" data-str="' + str + '">＋</button></td>';
      return '<tr><td class="slabel">' + str + "</td>" + cells + addCell + "</tr>";
    }).join("");

    $("#tabGrid").innerHTML = "<table>" + head + rows + "</table>";
    $("#tabPreview").textContent = FG.tabToText(ev, { ascii: false, maxw: 60 }) || "(vide)";
  }

  function promptFret(prefill) {
    var v = prompt("Fret (number, or (3) for a muted note). Empty = delete the note.", prefill == null ? "0" : String(prefill));
    return v;
  }

  $("#tabGrid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tg]"); if (!b || !TAB) return;
    var act = b.getAttribute("data-tg"), col = +b.getAttribute("data-col"), str = b.getAttribute("data-str");
    var ev = TAB.events;
    if (act === "add") {
      var f = promptFret("0"); if (f === null || f === "") return;
      ev.push([str, isNaN(+f) ? f : +f]);
    } else if (act === "note") {
      var cur = (ev[col][0] === str) ? ev[col][1] : null;
      var nf = promptFret(cur);
      if (nf === null) return;
      if (nf === "") ev.splice(col, 1);
      else ev[col] = [str, isNaN(+nf) ? nf : +nf];
    } else if (act === "del") { ev.splice(col, 1); }
    else if (act === "left") { if (col > 0) { var t = ev[col - 1]; ev[col - 1] = ev[col]; ev[col] = t; } }
    else if (act === "right") { if (col < ev.length - 1) { var t2 = ev[col + 1]; ev[col + 1] = ev[col]; ev[col] = t2; } }
    else if (act === "sym") {
      // clicking a repclose cycles its repeat count 0(none)->2->3->4->8->0
      if (ev[col][0] === "repclose") {
        var seq = [undefined, 2, 3, 4, 8], cur2 = ev[col][1], k = seq.indexOf(cur2);
        var nv = seq[(k + 1) % seq.length];
        ev[col] = nv == null ? ["repclose"] : ["repclose", nv];
      }
    }
    drawGrid();
  });

  $$("#tabModal [data-sym]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!TAB) return;
      var sym = btn.getAttribute("data-sym");
      TAB.events.push(sym === "repclose" ? ["repclose"] : [sym]);
      drawGrid();
    });
  });
  $("#tabClear").addEventListener("click", function () { if (TAB && confirm("Clear the tab?")) { TAB.events = []; drawGrid(); } });
  $("#tabCancel").addEventListener("click", closeTab);
  $("#tabModal").addEventListener("click", function (e) { if (e.target === $("#tabModal")) closeTab(); });
  $("#tabSave").addEventListener("click", function () {
    if (!TAB) return;
    pushHistory();
    var r = STATE.songs[TAB.si].riffs[TAB.ri];
    r.tab = TAB.events.length ? clone(TAB.events) : null;
    touchUpdated(); closeTab(); renderAll();
  });

  /* =====================================================================
   *  TOPBAR: generate, data, options
   * ===================================================================== */
  $("#chordPt").addEventListener("input", function () { UI.chordPt = +this.value || 12; persistUI(); updatePreview(); });
  $("#bwToggle").addEventListener("change", function () { UI.bw = this.checked; persistUI(); updatePreview(); });
  $("#compactToggle").addEventListener("change", function () { UI.compact = this.checked; persistUI(); updatePreview(); });
  $("#autoNumToggle").addEventListener("change", function () {
    pushHistory(); STATE.autoNumber = this.checked; touchUpdated(); renderAll();
  });

  // undo: button + Ctrl/Cmd+Z (leaves native text-field undo alone while typing)
  var undoBtn = $("#undoBtn"); if (undoBtn) undoBtn.addEventListener("click", undo);
  document.addEventListener("keydown", function (e) {
    if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (TAB) return;                                   // tab editor open → leave it
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return; // native undo
      e.preventDefault(); undo();
    }
  });

  /* ---------------- resizable editor pane ---------------- */
  (function () {
    var rz = $("#resizer"), layout = $(".layout"); if (!rz || !layout) return;
    var LS_W = "fg_editor_w";
    try { var w = localStorage.getItem(LS_W); if (w) layout.style.setProperty("--editorW", w); } catch (e) {}
    var dragging = false;
    rz.addEventListener("pointerdown", function (e) {
      dragging = true; try { rz.setPointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var rect = layout.getBoundingClientRect();
      var w = e.clientX - rect.left;
      var max = Math.min(rect.width - 340, 1000);
      w = Math.max(300, Math.min(max, w));
      layout.style.setProperty("--editorW", w + "px");
    });
    window.addEventListener("pointerup", function () {
      if (!dragging) return; dragging = false;
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      try { localStorage.setItem(LS_W, layout.style.getPropertyValue("--editorW")); } catch (e) {}
    });
  })();

  function toggleMenu(id) { $$(".menu-pop").forEach(function (m) { if (m.id !== id) m.classList.remove("open"); }); $("#" + id).classList.toggle("open"); }
  $("#genBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMenu("genMenu"); });
  $("#dataBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMenu("dataMenu"); });
  document.addEventListener("click", function () { $$(".menu-pop").forEach(function (m) { m.classList.remove("open"); }); });

  $("#genMenu").addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-act"); if (!a) return;
    if (a === "pdf-color") FG.generatePdf(STATE, { bw: false, chordPt: UI.chordPt, compact: UI.compact });
    else if (a === "pdf-bw") FG.generatePdf(STATE, { bw: true, chordPt: UI.chordPt, compact: UI.compact });
    else if (a === "print") { window.print(); }
    else if (a === "digest") { openDigest(); }
  });

  $("#dataMenu").addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-act"); if (!a) return;
    if (a === "export") {
      var blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "songbook-data.json"; link.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (a === "share") { copyShare(null); }
    else if (a === "import") { $("#fileInput").click(); }
    else if (a === "demo") { if (confirm("Replace the current content with the demo?")) { pushHistory(); STATE = clone(FG.DEMO); UI.openSong = null; renderAll(); } }
    else if (a === "wipe") {
      if (confirm("Clear everything (empty songbook)? Export first if needed.")) {
        pushHistory(); STATE = FG.emptyState(); UI.openSong = null; renderAll();
      }
    }
  });

  $("#fileInput").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result);
        if (!data || !Array.isArray(data.songs)) throw new Error("invalid structure");
        if (!data.meta) data.meta = FG.emptyState().meta;
        pushHistory(); STATE = data; UI.openSong = null; renderAll();
      } catch (err) { alert("Import failed: " + err.message); }
    };
    rd.readAsText(f); this.value = "";
  });

  /* =====================================================================
   *  STAGE / READING VIEW — hide editor, full-screen sheets, song nav
   * ===================================================================== */
  // stage navigation order: cover + songsheets — filtered/reordered by the
  // active setlist. The preview/PDF (the printable booklet) stays whole-book.
  function stageSheets() {
    var all = $$("#preview .sheet");
    var al = activeSetlist();
    if (!al) return all;
    var songs = $$("#preview .sheet.songsheet");
    var rest = all.filter(function (s) { return !s.classList.contains("songsheet"); });
    return rest.concat(navSongIdx().map(function (i) { return songs[i]; }).filter(Boolean));
  }
  var stageIdx = 0;
  function updateStageLabel() {
    var el = $("#stageLabel"); if (!el) return;
    var sh = stageSheets(), cur = sh[stageIdx];
    var name = cur && cur.classList.contains("cover") ? "Cover"
      : (cur && cur.querySelector(".fh-title") ? cur.querySelector(".fh-title").textContent : "");
    el.textContent = sh.length ? (stageIdx + 1) + " / " + sh.length + (name ? " · " + name : "") : "";
  }
  // scale the current song sheet to be as large as possible while still fitting
  // on ONE screen (no scrolling), then centre it. Biggest, but never overflowing.
  function fitStageSheet() {
    if (!document.body.classList.contains("stage")) return;
    var el = $("#preview .sheet.stage-current"), host = $("#preview");
    if (!el || !host) return;
    var aW = host.clientWidth, aH = host.clientHeight;
    if (!aW || !aH) return;
    el.style.transform = "none";

    // On tall/narrow screens (phones, portrait tablets) a fixed A4-width page fills
    // only the width and wastes the height. Reflow it to a narrower width so its
    // shape matches the screen and it fills the vertical space too — but never
    // narrower than the widest tab (tabs are fixed-width and must stay readable).
    if (aH > aW * 1.1) {
      el.style.width = "794px";
      var tabW = 0;
      $$("pre.tab", el).forEach(function (p) { tabW = Math.max(tabW, p.scrollWidth); });
      var minW = Math.max(340, tabW ? tabW + 92 : 340);
      var target = aW / aH, Wb = 794;
      for (var i = 0; i < 5; i++) {
        el.style.width = Wb + "px";
        var h = el.offsetHeight; if (!h) break;
        var asp = Wb / h;
        if (Math.abs(asp - target) <= 0.03) break;       // page shape ≈ screen shape
        Wb = Math.max(minW, Math.min(1000, Wb * Math.sqrt(target / asp)));
      }
      el.style.width = Wb + "px";
    } else {
      el.style.width = "794px";                          // desktop: keep the A4 page
    }

    var Wn = el.offsetWidth, Hn = el.offsetHeight;
    if (!Wn || !Hn) return;
    var k = Math.min(aW / Wn, aH / Hn);                  // biggest that fits BOTH → one page
    if (!isFinite(k) || k <= 0) k = 1;
    var tx = Math.max(0, (aW - k * Wn) / 2), ty = Math.max(0, (aH - k * Hn) / 2);
    el.style.transformOrigin = "top left";
    el.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
  }
  function renderStageCurrent() {
    var sh = stageSheets(); if (!sh.length) return false;
    stageIdx = Math.max(0, Math.min(sh.length - 1, stageIdx));
    // clear ALL sheets (a set switch may leave a now-excluded sheet current)
    $$("#preview .sheet").forEach(function (s) { s.classList.remove("stage-current"); });
    sh.forEach(function (s, i) { s.classList.toggle("stage-current", i === stageIdx); });
    updateStageLabel(); fitStageSheet();
    return true;
  }
  function stageGo(i) {
    var sh = stageSheets(); if (!sh.length) return;
    stageIdx = Math.max(0, Math.min(sh.length - 1, i));
    renderStageCurrent();
    if (window.scrollTo) window.scrollTo(0, 0);      // start at the top of the new song
  }
  function enterStage() {
    document.body.classList.add("stage");
    var sh = stageSheets();
    if (stageIdx <= 0) {                             // first entry: jump to the first song
      var fi = sh.findIndex(function (s) { return s.classList.contains("songsheet"); });
      stageIdx = fi > 0 ? fi : 0;
    }
    if (!renderStageCurrent()) setTimeout(renderStageCurrent, 200); // retry after debounced render
    if (window.scrollTo) window.scrollTo(0, 0);
  }
  function exitStage() {
    document.body.classList.remove("stage");
    $$("#preview .sheet").forEach(function (s) {
      s.classList.remove("stage-current");
      s.style.transform = ""; s.style.transformOrigin = ""; s.style.width = "";
    });
  }
  function toggleStage() { document.body.classList.contains("stage") ? exitStage() : enterStage(); }

  var viewBtn = $("#viewBtn"); if (viewBtn) viewBtn.addEventListener("click", toggleStage);
  var sPrev = $("#stagePrev"); if (sPrev) sPrev.addEventListener("click", function () { stageGo(stageIdx - 1); });
  var sNext = $("#stageNext"); if (sNext) sNext.addEventListener("click", function () { stageGo(stageIdx + 1); });
  var sExit = $("#stageExit"); if (sExit) sExit.addEventListener("click", exitStage);
  window.addEventListener("resize", function () { if (document.body.classList.contains("stage")) fitStageSheet(); });
  // expose for the preview-refresh hook (re-apply current sheet after a re-render)
  root.__ttmStageRefresh = function () { if (document.body.classList.contains("stage")) renderStageCurrent(); };

  // index of the song shown in stage view (-1 on the cover)
  function stageSongIndex() {
    var cur = stageSheets()[stageIdx];
    return cur ? $$("#preview .sheet.songsheet").indexOf(cur) : -1;
  }
  function jumpToSong(i) {
    var target = $$("#preview .sheet.songsheet")[i];
    var k = stageSheets().indexOf(target);
    if (k >= 0) stageGo(k);
  }

  /* =====================================================================
   *  REHEARSAL SHEET — thumb-sized bottom sheet in stage view.
   *  Open: tap a section pill (preselects it) or 🖍 (preselects ♪ Song).
   *  Chips retarget; colour + note live in a working copy; Save commits all.
   * ===================================================================== */
  var RH = null; // { si, work: clone(song.rehearsal), sec: current target key }
  function openRehearsal(si, sec) {
    var s = STATE.songs[si]; if (!s) return;
    RH = { si: si, work: clone(s.rehearsal || {}), sec: sec || "__song", editK: null };
    $("#rhTitle").textContent = "🖍 " + (s.num ? s.num + " — " : "") + (s.title || "Song");
    $("#rhNote").value = "";
    drawRh();
    $("#rhModal").classList.add("open");
  }
  function closeRh() { $("#rhModal").classList.remove("open"); RH = null; }
  function rhSet(patch) {
    var e = RH.work[RH.sec] || (RH.work[RH.sec] = {});
    Object.keys(patch).forEach(function (k) { e[k] = patch[k]; });
    if (!e.c) delete e.c;
    if (!e.note) delete e.note;
    if (!e.c && !e.note) delete RH.work[RH.sec];
  }
  function drawRh() {
    var s = STATE.songs[RH.si];
    var secs = ["__song"].concat(songSections(s));
    Object.keys(RH.work).forEach(function (k) { if (secs.indexOf(k) < 0) secs.push(k); });
    if (secs.indexOf(RH.sec) < 0) secs.push(RH.sec);
    $("#rhChips").innerHTML = secs.map(function (k) {
      var e = RH.work[k];
      return '<button class="chip' + (k === RH.sec ? " on" : "") + '" data-sec="' + esc(k) + '">' +
        (e && e.c ? '<span class="rdot ' + e.c + '"></span>' : "") +
        (e && e.note ? "✎ " : "") + esc(rhLabel(k)) + "</button>";
    }).join("");
    var cur = RH.work[RH.sec] || {};
    $$("#rhModal .cbig").forEach(function (b) {
      b.classList.toggle("on", (b.getAttribute("data-c") || "") === (cur.c || ""));
    });
    // pushed notes for this target, one row each, deletable. The textarea is a
    // DRAFT: never overwritten here (a colour tap must not eat what's typed).
    var lines = (cur.note || "").split("\n").filter(Boolean);
    $("#rhNotes").innerHTML = lines.map(function (ln, k) {
      return '<div class="rh-note-row" data-k="' + k + '" title="Tap to edit">' +
        '<span class="rh-n">' + noteNum(k) + "</span>" +
        "<span>" + esc(ln) + "</span>" +
        '<span class="rh-pen">✎</span>' +
        '<button class="btn sm danger" data-ln="' + k + '" title="Delete this note">✕</button></div>';
    }).join("");
  }
  function noteNum(k) { var n = k + 1; return "#" + (n < 10 ? "0" + n : n); }
  // push the draft as a note line for the current target, blank the field.
  // A note being edited (editK) goes back to ITS slot; a fresh one is appended.
  function rhPushDraft() {
    if (!RH) return false;
    var ta = $("#rhNote"), v = ta.value.trim();
    if (!v) { RH.editK = null; return false; }
    var e = RH.work[RH.sec] || (RH.work[RH.sec] = {});
    var lines = (e.note || "").split("\n").filter(Boolean);
    if (RH.editK != null) lines.splice(Math.min(RH.editK, lines.length), 0, v);
    else lines.push(v);
    e.note = lines.join("\n");
    RH.editK = null;
    ta.value = "";
    return true;
  }
  $("#rhPush").addEventListener("click", function () {
    if (rhPushDraft()) drawRh();
    $("#rhNote").focus();
  });
  $("#rhNote").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (rhPushDraft()) drawRh(); }
  });
  $("#rhNotes").addEventListener("click", function (e) {
    if (!RH) return;
    var cur = RH.work[RH.sec]; if (!cur) return;
    var del = e.target.closest("[data-ln]");
    if (del) {                                    // ✕ = delete that note
      var dk = +del.getAttribute("data-ln");
      var lines = (cur.note || "").split("\n").filter(Boolean);
      lines.splice(dk, 1);
      if (RH.editK != null && dk < RH.editK) RH.editK--;   // keep the edit slot honest
      rhSet({ note: lines.join("\n") || null });
      drawRh(); return;
    }
    var row = e.target.closest(".rh-note-row");   // tap row = pop it back for editing
    if (!row) return;
    var k = +row.getAttribute("data-k");
    var prevEdit = RH.editK;
    rhPushDraft();                                // park any pending draft/edit in its slot
    if (prevEdit != null && prevEdit <= k) k++;   // parked row re-entered before this one
    cur = RH.work[RH.sec]; if (!cur) return;      // (push may have re-created it)
    var ls = (cur.note || "").split("\n").filter(Boolean);
    var picked = ls.splice(k, 1)[0] || "";
    rhSet({ note: ls.join("\n") || null });
    RH.editK = k;                                 // pushed edit returns to this slot
    $("#rhNote").value = picked;
    drawRh();
    $("#rhNote").focus();
  });
  $("#rhChips").addEventListener("click", function (e) {
    var c = e.target.closest(".chip"); if (!c || !RH) return;
    rhPushDraft();                      // don't lose a typed-but-unpushed note
    RH.sec = c.getAttribute("data-sec"); drawRh();
  });
  $$("#rhModal .cbig").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!RH) return;
      rhSet({ c: this.getAttribute("data-c") || null });
      drawRh();
    });
  });
  $("#rhSave").addEventListener("click", function () {
    if (!RH) return;
    rhPushDraft();                      // Save also folds in an unpushed draft
    pushHistory();
    var s = STATE.songs[RH.si];
    if (Object.keys(RH.work).length) s.rehearsal = clone(RH.work); else delete s.rehearsal;
    touchUpdated(); closeRh(); renderAll();
  });
  $("#rhCancel").addEventListener("click", closeRh);
  $("#rhCancel2").addEventListener("click", closeRh);
  $("#rhModal").addEventListener("click", function (e) { if (e.target === $("#rhModal")) closeRh(); });
  var stageMark = $("#stageMark");
  if (stageMark) stageMark.addEventListener("click", function () {
    var i = stageSongIndex();
    openRehearsal(i >= 0 ? i : 0, "__song");
  });
  // tapping a section pill on the current sheet (stage view only)
  $("#preview").addEventListener("click", function (e) {
    if (!document.body.classList.contains("stage")) return;
    var p = e.target.closest(".pill[data-sec]"); if (!p) return;
    var i = stageSongIndex(); if (i < 0) return;
    openRehearsal(i, p.getAttribute("data-sec"));
  });

  /* =====================================================================
   *  SETLIST OVERLAY — jump / reorder (big ▲▼, no drag) / share.
   * ===================================================================== */
  function setRow(s, i, btns) {
    return '<div class="set-row" data-i="' + i + '">' +
      '<span class="num">' + esc(s.num) + "</span>" +
      '<span class="ttl">' + rhDot(s.rehearsal) + esc(s.title || "(untitled)") + "</span>" +
      btns + "</div>";
  }
  function drawSetlist() {
    ensureIds();
    var al = activeSetlist();
    // picker bar: whole book / named sets / new / delete-current
    $("#setBar").innerHTML =
      '<select id="setSelect"><option value="">♪ Whole book (' + STATE.songs.length + ')</option>' +
      STATE.setlists.map(function (sl, k) {
        return '<option value="' + k + '"' + (STATE.activeSet === k ? " selected" : "") + ">" +
          esc(sl.name) + " (" + sl.songs.length + ")</option>";
      }).join("") + "</select>" +
      '<button class="btn sm" id="setNew" title="New setlist">＋ New</button>' +
      (al ? '<button class="btn sm danger" id="setDelList" title="Delete this setlist">🗑</button>' : "");

    var html;
    if (!al) {
      html = STATE.songs.length
        ? STATE.songs.map(function (s, i) {
            return setRow(s, i,
              '<button class="btn sm" data-mv="up" data-i="' + i + '" title="Up">▲</button>' +
              '<button class="btn sm" data-mv="down" data-i="' + i + '" title="Down">▼</button>');
          }).join("")
        : '<div class="empty-hint">No songs.</div>';
    } else {
      var by = songIdxById(), inSet = {};
      html = al.songs.map(function (id, k) {
        var i = by[id]; if (i == null) return "";
        inSet[id] = 1;
        return setRow(STATE.songs[i], i,
          '<button class="btn sm" data-smv="up" data-k="' + k + '" title="Up">▲</button>' +
          '<button class="btn sm" data-smv="down" data-k="' + k + '" title="Down">▼</button>' +
          '<button class="btn sm danger" data-srem="' + k + '" title="Remove from set">−</button>');
      }).join("") || '<div class="empty-hint">Empty set — add songs below.</div>';
      var rest = STATE.songs.filter(function (s) { return !inSet[s.id]; });
      if (rest.length) {
        html += '<div class="set-rest">rest of the book</div>' +
          rest.map(function (s) {
            var i = by[s.id];
            return '<div class="set-row rest" data-noj="1">' +
              '<span class="num">' + esc(s.num) + "</span>" +
              '<span class="ttl">' + rhDot(s.rehearsal) + esc(s.title || "(untitled)") + "</span>" +
              '<button class="btn sm" data-sadd="' + esc(s.id) + '" title="Add to set">＋</button></div>';
          }).join("");
      }
    }
    $("#setList").innerHTML = html;
    // tap link presets to the current stage song's tempo
    var si = stageSongIndex(), tap = $("#setTap");
    if (tap) {
      var tm = si >= 0 && (STATE.songs[si].tempo || "").match(/\d+/);
      tap.href = "tap.html" + (tm ? "?bpm=" + tm[0] : "");
    }
  }
  function closeSetlist() { $("#setModal").classList.remove("open"); }
  var stageSet = $("#stageSet");
  if (stageSet) stageSet.addEventListener("click", function () {
    drawSetlist(); $("#setModal").classList.add("open");
  });
  $("#setClose").addEventListener("click", closeSetlist);
  $("#setModal").addEventListener("click", function (e) { if (e.target === $("#setModal")) closeSetlist(); });
  $("#setBar").addEventListener("change", function (e) {
    if (e.target.id !== "setSelect") return;
    pushHistory();
    STATE.activeSet = e.target.value === "" ? null : +e.target.value;
    stageIdx = 0;                        // nav order changed: restart from the top
    renderAll(); drawSetlist();
  });
  $("#setBar").addEventListener("click", function (e) {
    if (e.target.id === "setNew") {
      var name = prompt("Setlist name:", "Gig " + FG.todayISO());
      if (!name) return;
      pushHistory();
      STATE.setlists.push({ name: name, songs: [] });
      STATE.activeSet = STATE.setlists.length - 1;
      renderAll(); drawSetlist();
    } else if (e.target.id === "setDelList") {
      var al = activeSetlist(); if (!al) return;
      if (!confirm('Delete setlist "' + al.name + '"? (Songs stay in the book.)')) return;
      pushHistory();
      STATE.setlists.splice(STATE.activeSet, 1);
      STATE.activeSet = null;
      renderAll(); drawSetlist();
    }
  });
  $("#setList").addEventListener("click", function (e) {
    var al = activeSetlist();
    var mv = e.target.closest("[data-mv]");        // whole-book reorder
    if (mv) {
      var i = +mv.getAttribute("data-i");
      var j = mv.getAttribute("data-mv") === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= STATE.songs.length) return;
      pushHistory();
      var tmp = STATE.songs[i]; STATE.songs[i] = STATE.songs[j]; STATE.songs[j] = tmp;
      if (UI.openSong === i) UI.openSong = j; else if (UI.openSong === j) UI.openSong = i;
      touchUpdated(); renderAll(); drawSetlist();
      return;
    }
    var smv = e.target.closest("[data-smv]");      // reorder inside the set
    if (smv && al) {
      var k = +smv.getAttribute("data-k");
      var k2 = smv.getAttribute("data-smv") === "up" ? k - 1 : k + 1;
      if (k2 < 0 || k2 >= al.songs.length) return;
      pushHistory();
      var t2 = al.songs[k]; al.songs[k] = al.songs[k2]; al.songs[k2] = t2;
      persist(); drawSetlist(); updateStageLabel(); renderStageCurrent();
      return;
    }
    var srem = e.target.closest("[data-srem]");    // remove from set
    if (srem && al) {
      pushHistory();
      al.songs.splice(+srem.getAttribute("data-srem"), 1);
      persist(); drawSetlist(); renderStageCurrent();
      return;
    }
    var sadd = e.target.closest("[data-sadd]");    // add to set
    if (sadd && al) {
      pushHistory();
      al.songs.push(sadd.getAttribute("data-sadd"));
      persist(); drawSetlist(); renderStageCurrent();
      return;
    }
    var row = e.target.closest(".set-row");
    if (row && !row.hasAttribute("data-noj")) { jumpToSong(+row.getAttribute("data-i")); closeSetlist(); }
  });

  /* =====================================================================
   *  PRACTICE DIGEST — every mark & note in the book on one page.
   *  Red first inside each song; songs keep book order. Printable on
   *  purpose (it's YOUR homework list), unlike the per-sheet scribbles.
   * ===================================================================== */
  function drawDigest() {
    var rank = { red: 0, yellow: 1 };
    var html = STATE.songs.map(function (s) {
      var es = FG.rhEntries(s);
      if (!es.length) return "";
      es.sort(function (a, b) {
        return (a[1].c in rank ? rank[a[1].c] : 2) - (b[1].c in rank ? rank[b[1].c] : 2);
      });
      return '<div class="dg-song"><div class="dg-title">' +
        esc(s.num) + " — " + esc(s.title || "(untitled)") + "</div>" +
        es.map(function (kv) {
          var e = kv[1];
          var lines = (e.note || "").split("\n").filter(Boolean);
          var notes = lines.map(function (ln, k) {
            return '<span class="rh-nn">' + noteNum(k) + "</span> " + esc(ln);
          }).join("<br>");
          return '<div class="rh-row' + (e.c ? " " + e.c : "") + '"><b>' +
            esc(rhLabel(kv[0])) + "</b>" + (notes ? " — " + notes : "") + "</div>";
        }).join("") + "</div>";
    }).join("");
    $("#digestBody").innerHTML = html ||
      '<div class="empty-hint">No rehearsal marks yet — tap section pills in 📖 View to add some.</div>';
  }
  function closeDigest() { $("#digestModal").classList.remove("open"); }
  function openDigest() { drawDigest(); $("#digestModal").classList.add("open"); }
  $("#digestClose").addEventListener("click", closeDigest);
  $("#digestModal").addEventListener("click", function (e) { if (e.target === $("#digestModal")) closeDigest(); });
  $("#digestPrint").addEventListener("click", function () {
    document.body.classList.add("digest-printing");
    var off = function () { document.body.classList.remove("digest-printing"); };
    if (root.matchMedia) {
      var mql = root.matchMedia("print");
      var h = function (m) { if (!m.matches) { off(); mql.removeListener(h); } };
      mql.addListener(h);
    }
    setTimeout(function () { root.print(); setTimeout(off, 1000); }, 30);
  });

  /* =====================================================================
   *  SHARE VIA URL — whole songbook compressed into the #d= fragment.
   *  The fragment never reaches the server (GitHub Pages sees nothing).
   *  #s=<n> optionally opens stage view on song n.
   * ===================================================================== */
  function buildShareLink(songIdx) {
    if (typeof LZString === "undefined") {
      alert("Share link needs the lz-string library (CDN unreachable / offline?).");
      return null;
    }
    var d = LZString.compressToEncodedURIComponent(JSON.stringify(STATE));
    return location.origin + location.pathname + "#d=" + d +
      (songIdx != null && songIdx >= 0 ? "&s=" + songIdx : "");
  }
  function copyShare(songIdx) {
    var url = buildShareLink(songIdx); if (!url) return;
    var kb = Math.round(url.length / 102.4) / 10;
    var done = function () { setStatus("✓ Link copied (" + kb + " KB — whole songbook inside)"); };
    var fallback = function () { prompt("Copy this link:", url); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
  }
  $("#setShare").addEventListener("click", function () { copyShare(stageSongIndex()); });

  // boot import: #d= data (+ optional #s= song to open in stage view)
  var PENDING_STAGE_SONG = null;
  (function () {
    var h = location.hash || "";
    var dm = h.match(/[#&]d=([^&]+)/), sm = h.match(/[#&]s=(\d+)/);
    if (sm) PENDING_STAGE_SONG = +sm[1];
    if (dm) {
      if (typeof LZString === "undefined") {
        alert("This link carries songbook data but the lz-string library didn't load (offline?).");
      } else {
        try {
          var data = JSON.parse(LZString.decompressFromEncodedURIComponent(dm[1]));
          if (!data || !Array.isArray(data.songs)) throw new Error("invalid structure");
          if (!data.meta) data.meta = FG.emptyState().meta;
          var n = data.songs.length;
          if (confirm("Load the songbook carried by this link (" + n + " song" + (n > 1 ? "s" : "") +
                      ")?\nIt replaces the data saved in this browser — Cancel and Export first if unsure.")) {
            pushHistory(); STATE = data; UI.openSong = null;
          } else PENDING_STAGE_SONG = null;
        } catch (err) { alert("Couldn't read the data in this link: " + err.message); PENDING_STAGE_SONG = null; }
      }
    }
    // NB: root.history — the plain `history` name is shadowed by the undo array
    if (dm || sm) { try { root.history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
  })();

  // keyboard: Esc closes modal / leaves View; arrows flip songs in View mode
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (RH) { closeRh(); return; }
      if ($("#digestModal").classList.contains("open")) { closeDigest(); return; }
      if ($("#setModal").classList.contains("open")) { closeSetlist(); return; }
      if (TAB) { closeTab(); return; }
      if (document.body.classList.contains("stage")) { exitStage(); return; }
    }
    if (document.body.classList.contains("stage") && !TAB && !RH &&
        !$("#setModal").classList.contains("open")) {
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); stageGo(stageIdx + 1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); stageGo(stageIdx - 1); }
    }
  });

  /* ---------------- boot ---------------- */
  // reflect the restored view prefs onto the controls BEFORE first render, so the
  // preview matches the saved Compact / B&W / Size even straight from cache.
  $("#chordPt").value = UI.chordPt;
  $("#compactToggle").checked = UI.compact;
  $("#bwToggle").checked = UI.bw;
  $("#autoNumToggle").checked = !!STATE.autoNumber;
  updateUndoBtn();
  renderAll();
  if (!STORAGE_OK) setStatus("⚠︎ browser storage unavailable — use Export", true);
  else if (RESTORED) setStatus("✓ Restored from browser");
  // link carried a song index -> open stage view on it (after the debounced render)
  if (PENDING_STAGE_SONG != null) {
    setTimeout(function () {
      enterStage();
      jumpToSong(Math.max(0, Math.min(STATE.songs.length - 1, PENDING_STAGE_SONG)));
      PENDING_STAGE_SONG = null;
    }, 400);
  }
})(typeof window !== "undefined" ? window : globalThis);
