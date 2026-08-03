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
  var UI = { bw: false, compact: false, chordPt: 18, openSong: null, allSets: false, gig: false };

  // view prefs (compact / B&W / size) persist too, so the preview is correct at
  // page load without having to re-toggle anything.
  var UI_KEY = "fg_ui_v1";
  (function () {
    try {
      var u = JSON.parse(localStorage.getItem(UI_KEY) || "null") || {};
      if (typeof u.bw === "boolean") UI.bw = u.bw;
      if (typeof u.compact === "boolean") UI.compact = u.compact;
      if (typeof u.allSets === "boolean") UI.allSets = u.allSets;
      if (typeof u.gig === "boolean") UI.gig = u.gig;
      if (u.chordPt) UI.chordPt = +u.chordPt || UI.chordPt;
    } catch (e) {}
  })();
  function persistUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ bw: UI.bw, compact: UI.compact, chordPt: UI.chordPt, allSets: UI.allSets, gig: UI.gig })); } catch (e) {}
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

  // A tab wider than its sheet used to hide behind a horizontal scrollbar.
  // Instead: shrink THAT tab's font just enough to show the whole thing
  // (mono scales linearly, so one ratio nails it). PDF/jsPDF unaffected.
  function fitTabs(scopeEl) {
    $$("pre.tab", scopeEl || $("#preview")).forEach(function (p) {
      p.style.fontSize = "";                       // back to the CSS size first
      var cw = p.clientWidth, sw = p.scrollWidth;
      if (!cw || sw <= cw + 1) return;
      var cur = parseFloat(root.getComputedStyle(p).fontSize) || 12;
      p.style.fontSize = Math.max(6, cur * (cw / sw) * 0.98) + "px";
    });
  }

  var prevT;
  function updatePreview() {
    clearTimeout(prevT);
    prevT = setTimeout(function () {
      var pv = $("#preview");
      pv.className = UI.compact ? "compact" : "";
      pv.style.setProperty("--fs", UI.chordPt + "pt");
      var opts = { bw: UI.bw, chordPt: UI.chordPt, compact: UI.compact };
      var VS = viewState();                                   // scoped by active set
      // mirror the real PDF pagination (page count + compact grouping)
      var pg = (FG.paginate && VS.songs.length && VS.songs.length <= 60)
        ? FG.paginate(VS, opts) : null;
      pv.innerHTML = FG.renderPreview(VS, opts, pg && pg.songPage);
      updatePageCount(pg, VS.songs.length);
      if (!document.body.classList.contains("stage")) fitTabs();  // full ASCII, no h-scroll
      if (root.__ttmStageRefresh) root.__ttmStageRefresh();   // keep View mode in sync
      if (root.__ttmRvRefresh) root.__ttmRvRefresh();         // keep review spotlight in sync
    }, 160);
  }
  function updatePageCount(pg, n) {
    var el = $("#pageCount"); if (!el) return;
    if (pg && pg.pages) el.textContent = "PDF: " + pg.pages + (pg.pages > 1 ? " pages" : " page");
    else if (n > 60) el.textContent = "PDF: many pages";
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
        '<div class="chord-value"><input data-song="' + i + '" data-ci="' + ci + '" data-part="value" value="' + esc(c.value) + '" placeholder="Chords / text">' +
        '<button class="btn sm chord-pad-open" data-act="chordPad" data-song="' + i + '" data-ci="' + ci + '" title="Open chord pad" aria-label="Open chord pad">♭＋</button></div>' +
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

    // set badges, each in its gig's colour. Default: only the ACTIVE view's
    // badge; the 🏷 "all sets" flip shows every gig's pastille.
    var setBadge = "";
    (STATE.setlists || []).forEach(function (sl, k) {
      if (STATE.activeSet !== k && !UI.allSets) return;
      var pos = sl.songs.indexOf(s.id);
      if (pos >= 0) setBadge += '<span class="inset-b" style="background:' + setColor(k) +
        '" title="№' + (pos + 1) + ' in “' + esc(sl.name) + '”">▸' + String(pos + 1).padStart(2, "0") + "</span>";
    });
    // scoped + not in the active set -> greyed title in the left pane
    var outScope = activeSetlist() && bookToView(i) < 0;

    return '<div class="song-card' + (open ? " open" : "") + (outScope ? " out-scope" : "") + '" data-card="' + i + '">' +
      '<div class="sc-head" data-toggle="' + i + '" data-drag="song" data-song="' + i + '" draggable="true" title="Drag the bar to reorder">' +
        '<span class="grip" aria-hidden="true">⠿</span>' +
        '<span class="num">' + esc(s.num) + rhDot(s.rehearsal) + "</span>" + setBadge +
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
    var rb = $("#reviewBtn");
    if (rb) {
      var rn = reviewCount();
      rb.textContent = "🖍 Review notes" + (rn ? " (" + rn + ")" : "");
      rb.disabled = !rn;
    }
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

  /* ---- VIEW SCOPE: the active set is a lens over the whole book -------
   * viewState() = what the preview / print / PDF / stage render: the set's
   * songs, in set order, renumbered 01..n (shallow copies — data untouched).
   * No set active -> the full STATE. The editor ALWAYS sees the full book. */
  function viewState() {
    var al = activeSetlist();
    if (!al) return STATE;
    var by = songIdxById();
    var songs = al.songs.map(function (id) { return STATE.songs[by[id]]; })
      .filter(Boolean)
      .map(function (s, k) {
        var c = {}; Object.keys(s).forEach(function (kk) { c[kk] = s[kk]; });
        c.num = String(k + 1).padStart(2, "0");
        return c;
      });
    var meta = {}; Object.keys(STATE.meta || {}).forEach(function (k) { meta[k] = STATE.meta[k]; });
    meta.subtitle = (meta.subtitle ? meta.subtitle + " · " : "") + "Setlist: " + al.name;
    return { meta: meta, songs: songs, autoNumber: STATE.autoNumber };
  }
  function viewToBook(vi) { return navSongIdx()[vi]; }
  function bookToView(bi) { return navSongIdx().indexOf(bi); }

  // 6 gig colours, cycled by setlist index (matches the category-ink family)
  var SET_COLORS = ["#2f5fb3", "#2f8f3f", "#b03a78", "#9a7400", "#6b3fb0", "#1f7a6e"];
  function setColor(k) { return SET_COLORS[k % SET_COLORS.length]; }

  // topbar scope switcher + editor hint + Generate labels — one glance says
  // exactly what the preview / Print / PDF currently produce.
  function renderScopeUI() {
    var al = activeSetlist();
    var sel = $("#scopeSel");
    if (sel) {
      sel.innerHTML = '<option value="">📕 Whole book (' + STATE.songs.length + ')</option>' +
        (STATE.setlists || []).map(function (sl, k) {
          return '<option value="' + k + '"' + (STATE.activeSet === k ? " selected" : "") + ">📗 " +
            esc(sl.name) + " (" + sl.songs.length + ")</option>";
        }).join("");
      sel.classList.toggle("scoped", !!al);
      sel.style.background = al ? setColor(STATE.activeSet) : "";
      sel.style.borderColor = al ? setColor(STATE.activeSet) : "";
    }
    var hint = $("#scopeHint");
    if (hint) {
      hint.style.background = al ? setColor(STATE.activeSet) : "";
      if (al) {
        var hidden = STATE.songs.length - al.songs.length;
        hint.hidden = false;
        hint.textContent = "👁 Preview / Print / PDF = “" + al.name + "” (" + al.songs.length +
          " songs" + (hidden > 0 ? " — " + hidden + " not shown on the right" : "") + ")";
      } else hint.hidden = true;
    }
    var sfx = al ? " — " + al.name : "";
    var mc = $('#genMenu [data-act="pdf-color"]'); if (mc) mc.textContent = "⬇︎ PDF colour (.pdf)" + sfx;
    var mb = $('#genMenu [data-act="pdf-bw"]'); if (mb) mb.textContent = "⬇︎ PDF B&W (.pdf)" + sfx;
    var mp = $('#genMenu [data-act="print"]'); if (mp) mp.textContent = "🖨 Print / Save as PDF (faithful)" + sfx;
  }
  var scopeSel = $("#scopeSel");
  if (scopeSel) scopeSel.addEventListener("change", function () {
    pushHistory();
    STATE.activeSet = this.value === "" ? null : +this.value;
    stageIdx = 0;
    renderAll();
    if ($("#setModal").classList.contains("open")) drawSetlist();
  });

  function renderAll() { ensureIds(); applyAutoNumber(); renderScopeUI(); renderEditor(); updatePreview(); persist(); }

  /* ---------------- editor events ---------------- */
  // snapshot the state when a field gains focus, so a whole typing burst in that
  // field becomes a single undo step (committed on the first keystroke).
  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[data-part="value"]')) lastChordField = t;
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
    var chordInput = e.target.closest('input[data-part="value"]');
    if (chordInput) { openChordPad(chordInput, true); return; }
    var btn = e.target.closest("[data-act],[data-toggle]"); if (!btn) return;
    var tog = btn.getAttribute("data-toggle");
    if (tog != null) { UI.openSong = (UI.openSong === +tog) ? null : +tog; renderEditor(); return; }
    var act = btn.getAttribute("data-act");
    var si = +btn.getAttribute("data-song"); var s = STATE.songs[si];
    if (act !== "editTab" && act !== "chordPad") touchUpdated(); // opening a tool changes nothing
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
    if (act === "chordPad") { openChordPad(btn.parentElement.querySelector('input[data-part="value"]')); return; }
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
    if (act === "tapTempo") { e.stopPropagation(); tapTempoClick(si, e); return; }
  });

  /* ---- mobile chord pad: inserts plain text into the existing field ---- */
  var CP = null, lastChordField = null;
  function cpDraw() {
    if (!CP) return;
    $("#cpPreview").textContent = CP.root + CP.acc + CP.suffix;
    var edit = $("#cpText");
    edit.value = CP.input.value;
    edit.setSelectionRange(CP.at, CP.at);
    $$("#chordPadModal [data-cp-root]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-cp-root") === CP.root); });
    $$("#chordPadModal [data-cp-acc]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-cp-acc") === CP.acc); });
    $$("#chordPadModal [data-cp-suffix]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-cp-suffix") === CP.suffix); });
  }
  function openChordPad(input, freeText) {
    if (!input) return;
    var at = lastChordField === input && input.selectionStart != null ? input.selectionStart : input.value.length;
    CP = { input: input, at: at, root: "C", acc: "", suffix: "", changed: false };
    input.blur(); cpDraw(); $("#chordPadModal").classList.add("open");
    document.documentElement.classList.add("cp-open"); document.body.classList.add("cp-open");
    if (freeText) focusChordText();
  }
  function closeChordPad() {
    $("#chordPadModal").classList.remove("open");
    document.documentElement.classList.remove("cp-open"); document.body.classList.remove("cp-open");
    CP = null;
  }
  function focusChordText() {
    if (!CP) return;
    var edit = $("#cpText");
    try { edit.focus({ preventScroll: true }); } catch (_) { edit.focus(); }
    edit.setSelectionRange(CP.at, CP.at);
  }
  function cpInsert(text) {
    if (!CP) return;
    if (!CP.changed) { pendingSnap = clone(STATE); pendingCommitted = false; CP.changed = true; }
    var input = CP.input, edit = $("#cpText");
    var at = edit.selectionStart == null ? CP.at : edit.selectionStart;
    var end = edit.selectionEnd == null ? at : edit.selectionEnd;
    input.value = input.value.slice(0, at) + text + input.value.slice(end);
    CP.at += text.length;
    input.setSelectionRange(CP.at, CP.at);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    cpDraw();
  }
  $("#chordPadModal").addEventListener("click", function (e) {
    if (e.target === this) { closeChordPad(); return; }
    var b = e.target.closest("button"); if (!b || !CP) return;
    if (b.hasAttribute("data-cp-root")) CP.root = b.getAttribute("data-cp-root");
    else if (b.hasAttribute("data-cp-acc")) CP.acc = b.getAttribute("data-cp-acc");
    else if (b.hasAttribute("data-cp-suffix")) CP.suffix = b.getAttribute("data-cp-suffix");
    else if (b.hasAttribute("data-cp-text")) { cpInsert(b.getAttribute("data-cp-text")); return; }
    else return;
    cpDraw();
  });
  $("#cpInsert").addEventListener("click", function () { if (CP) cpInsert(CP.root + CP.acc + CP.suffix); });
  $("#cpClose").addEventListener("click", closeChordPad);
  $("#cpText").addEventListener("input", function () {
    if (!CP) return;
    if (!CP.changed) { pendingSnap = clone(STATE); pendingCommitted = false; CP.changed = true; }
    CP.input.value = this.value;
    CP.at = this.selectionStart == null ? this.value.length : this.selectionStart;
    CP.input.setSelectionRange(CP.at, CP.at);
    CP.input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("#cpKeyboard").addEventListener("click", focusChordText);

  /* =====================================================================
   *  TAP TEMPO PAD — the 🥁 next to a Tempo field opens a BIG fixed pad
   *  (a tiny editor button is no tap target on a phone). Tap the pad to
   *  the beat; Done / 10 s cap / 2.5 s silence writes "~<bpm> BPM" into
   *  the field; Cancel / scrolling / focusing elsewhere dismisses it.
   * ===================================================================== */
  var TAPT = null; // { si, taps:[], t10, tIdle, opened }
  function tapBpm(taps) {
    if (taps.length < 2) return null;
    var g = [];
    for (var i = 1; i < taps.length; i++) g.push(taps[i] - taps[i - 1]);
    return 60000 / (g.reduce(function (a, b) { return a + b; }, 0) / g.length);
  }
  function tapPadHide() {
    if (!TAPT) return;
    clearTimeout(TAPT.t10); clearTimeout(TAPT.tIdle);
    rhyStop();
    $("#tpRhyBox").hidden = true;
    TAPT = null;
    var pad = $("#tapPad");
    pad.classList.remove("open");
    pad.style.left = ""; pad.style.top = ""; pad.style.bottom = ""; pad.style.transform = "";
  }
  function tapTempoFinish() {
    if (!TAPT) return;
    var si = TAPT.si, taps = TAPT.taps;
    tapPadHide();
    if (taps.length < 3) { setStatus("⚠︎ tap at least 3 times", true); return; }
    var bpm = Math.round(tapBpm(taps));
    if (bpm < 20 || bpm > 300) { setStatus("⚠︎ tempo out of range (" + bpm + ")", true); return; }
    var s = STATE.songs[si]; if (!s) return;
    pushHistory();
    s.tempo = "~" + bpm + " BPM";
    var inp = $('input[data-song="' + si + '"][data-field="tempo"]');
    if (inp) inp.value = s.tempo;      // update in place (keep the card as-is)
    touchUpdated(); updatePreview(); persist();
    setStatus("✓ Tempo: ~" + bpm + " BPM (" + taps.length + " taps)");
  }
  function tapTempoClick(si, ev) {      // the 🥁 button: open (or re-target) the pad
    if (TAPT && TAPT.si !== si) tapTempoFinish();
    if (!TAPT) {
      TAPT = { si: si, taps: [], t10: null, tIdle: null, opened: Date.now() };
      var s = STATE.songs[si];
      $("#tpBpm").textContent = "—";
      $("#tpCount").textContent = s && s.title ? s.title : "";
      var pad = $("#tapPad");
      pad.classList.add("open");
      // desktop (fine pointer): the pad lands right UNDER the mouse — no travel.
      // phones keep the bottom-centered sheet.
      var fine = root.matchMedia && root.matchMedia("(pointer: fine)").matches;
      if (fine && ev && ev.clientX != null) {
        // centre of the TAP hit zone lands EXACTLY on the click point — the
        // mouse doesn't move an inch between opening and tapping.
        pad.style.bottom = "auto"; pad.style.transform = "none";
        pad.style.left = "0px"; pad.style.top = "0px";       // measurable position
        var hit = $("#tpHit");
        var pb = pad.getBoundingClientRect(), hb = hit.getBoundingClientRect();
        var offX = (hb.left - pb.left) + hb.width / 2;
        var offY = (hb.top - pb.top) + hb.height / 2;
        var pw = pb.width || 360, ph = pb.height || 230;
        var x = Math.max(8, Math.min(ev.clientX - offX, root.innerWidth - pw - 8));
        var y = Math.max(8, Math.min(ev.clientY - offY, root.innerHeight - ph - 8));
        pad.style.left = x + "px"; pad.style.top = y + "px";
      }
    }
  }
  /* ---- rhythm recorder: count-in 1 bar, tap 2 bars, quantize to 16ths ---- */
  var RHY = null; // { bpm,bpb,spb,ac,t0,recStart,taps,timer,doneT }
  function rhyNow() { return RHY && RHY.ac ? RHY.ac.currentTime : performance.now() / 1000; }
  function rhyClick(ac, t, accent) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = accent ? 1568 : 1046;
    g.gain.setValueAtTime(accent ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.06);
  }
  function rhyStop() {
    if (!RHY) return;
    clearInterval(RHY.timer); clearTimeout(RHY.doneT);
    if (RHY.ac && RHY.ac.close) RHY.ac.close().catch(function () {});
    RHY = null;
  }
  function rhythmStart() {
    if (!TAPT) return;
    rhyStop();
    RHYRES = null;
    $("#tpRhyBox").hidden = true;
    clearTimeout(TAPT.tIdle); clearTimeout(TAPT.t10);   // tempo timers off while recording
    var s = STATE.songs[TAPT.si];
    var bpm = tapBpm(TAPT.taps);
    if (!bpm && s && s.tempo) { var tm = String(s.tempo).match(/\d+/); if (tm) bpm = +tm[0]; }
    if (!bpm) { $("#tpCount").textContent = "tap a tempo first (or set the song's Tempo)"; return; }
    bpm = Math.max(30, Math.min(260, Math.round(bpm)));
    var bpb = 4;
    if (s && s.meter) { var mm = String(s.meter).match(/^(\d+)/); if (mm && (mm[1] === "3" || mm[1] === "6")) bpb = +mm[1]; }
    var AC = (root.AudioContext || root.webkitAudioContext) ? new (root.AudioContext || root.webkitAudioContext)() : null;
    // iOS/WebKit builds the context SUSPENDED even inside a tap; desktop Firefox
    // starts it running. Resume it here — we're still in the click gesture — or
    // the clicks schedule onto a frozen clock and the iPhone stays silent.
    if (AC && AC.state !== "running" && AC.resume) AC.resume();
    var spb = 60 / bpm, bars = 2;
    RHY = { bpm: bpm, bpb: bpb, spb: spb, bars: bars, ac: AC, taps: [], timer: null, doneT: null };
    var t0 = rhyNow() + 0.2;
    RHY.recStart = t0 + bpb * spb;                      // after one count-in bar
    RHY.recEnd = RHY.recStart + bars * bpb * spb;
    if (AC) for (var i = 0; i < bpb * (bars + 1); i++) rhyClick(AC, t0 + i * spb, i % bpb === 0);
    $("#tpBpm").textContent = String(bpm);
    RHY.timer = setInterval(function () {
      if (!RHY) return;
      var n = rhyNow();
      if (n < RHY.recStart) $("#tpCount").textContent = "count-in… " + Math.ceil((RHY.recStart - n) / spb);
      else $("#tpCount").textContent = "● REC bar " + Math.min(bars, 1 + Math.floor((n - RHY.recStart) / (spb * bpb))) + "/" + bars;
    }, 90);
    RHY.doneT = setTimeout(rhythmFinish, (RHY.recEnd - rhyNow() + 0.35) * 1000);
  }
  /* Quantize with mercy:
   *  1. the tapper's systematic lag (audio+touch latency, ~60-120ms) is
   *     estimated as the MEDIAN deviation from the grid and subtracted —
   *     the grid meets the player, not the reverse;
   *  2. both a straight-16th grid and a triplet grid are tried, the one
   *     with less residual error wins (slight bias to straight on ties).
   * The result lands in an editable slot grid before being applied. */
  var RHYRES = null; // { slots:[bool], div:4|3, bpm, bpb, bars }
  // deviations live on a circle (a tap half a slot late ≡ half a slot early
  // to the next) -> the systematic lag must be a CIRCULAR mean, then
  // normalized to "late" (players lag behind the click, they don't rush
  // half a grid ahead).
  function gridFit(rel, div, bpb, bars) {
    var units = rel.map(function (u) { return u * div; });
    var s = 0, c = 0;
    units.forEach(function (x) {
      var v = 2 * Math.PI * (x - Math.round(x));
      s += Math.sin(v); c += Math.cos(v);
    });
    var off = Math.atan2(s, c) / (2 * Math.PI);
    if (off < -0.15) off += 1;
    var err = 0, slots = {};
    units.forEach(function (x) {
      var r = x - off, sl = Math.round(r);
      err += Math.abs(r - sl);
      if (sl >= 0 && sl < bpb * div * bars) slots[sl] = 1;
    });
    // err normalized to TIME (beats), not slot units — otherwise the coarser
    // triplet grid always "wins" on-beat taps by pure unit trickery
    return { slots: slots, err: (err / units.length) / div };
  }
  function rhythmFinish() {
    if (!RHY) return;
    var spb = RHY.spb, bpb = RHY.bpb, bars = RHY.bars, bpm = RHY.bpm;
    var rel = RHY.taps.map(function (t) { return (t - RHY.recStart) / spb; })
      .filter(function (u) { return u > -0.35 && u < bpb * bars + 0.35; });
    rhyStop();
    if (!rel.length) { $("#tpCount").textContent = "no taps caught — ↻ to retry"; return; }
    // straight 16ths by DEFAULT; the triplet grid only wins if it fits
    // clearly better AND produced genuine off-beat triplet onsets
    var f4 = gridFit(rel, 4, bpb, bars);
    var f3 = gridFit(rel, 3, bpb, bars);
    var hasTripletOnsets = Object.keys(f3.slots).some(function (k) { return k % 3 !== 0; });
    var best = (hasTripletOnsets && f3.err < f4.err * 0.7)
      ? { div: 3, slots: f3.slots }
      : { div: 4, slots: f4.slots };
    var arr = new Array(bpb * best.div * bars);
    Object.keys(best.slots).forEach(function (k) { arr[+k] = true; });
    RHYRES = { slots: arr, div: best.div, bpm: bpm, bpb: bpb, bars: bars };
    $("#tpCount").textContent = rel.length + " taps · " +
      (best.div === 4 ? "16th grid" : "TRIPLET grid") + " · timing auto-corrected — tap cells to fix";
    renderRhyUI();
  }

  /* editable grid + pattern + notation. Tokens/SVG live in data.js (shared
   * with the sheet renderers), the pad just feeds them its slots. */
  function rhyPattern() {
    var d = RHYRES.div, per = RHYRES.bpb * d, bars = [];
    for (var b = 0; b < RHYRES.bars; b++) {
      var beats = [];
      for (var bt = 0; bt < RHYRES.bpb; bt++) {
        var cell = "";
        for (var k = 0; k < d; k++) cell += RHYRES.slots[b * per + bt * d + k] ? "x" : "·";
        beats.push(cell);
      }
      bars.push(beats.join(" "));
    }
    return bars.join(" | ");
  }
  function rhyMeta() {
    return "(" + RHYRES.bpm + " BPM · " + RHYRES.bpb + "/4 · " +
      (RHYRES.div === 4 ? "16th" : "triplet") + " grid)";
  }
  function rhyText() {
    if (!RHYRES) return "";
    return rhyPattern() + "\n" + rhyMeta();
  }
  function renderRhyUI() {
    if (!RHYRES) return;
    var d = RHYRES.div, per = RHYRES.bpb * d, html = "";
    for (var b = 0; b < RHYRES.bars; b++) {
      html += '<div class="rhy-bar">';
      for (var i = 0; i < per; i++) {
        var gi = b * per + i;
        html += '<button class="rhy-c' + (RHYRES.slots[gi] ? " on" : "") +
          (i % d === 0 && i > 0 ? " beat-start" : "") + '" data-slot="' + gi + '">' +
          (RHYRES.slots[gi] ? "x" : "·") + "</button>";
      }
      html += "</div>";
    }
    $("#tpRhyGrid").innerHTML = html;
    $("#tpRhyNotes").innerHTML = FG.rhythmSVG(RHYRES.slots, RHYRES.div, RHYRES.bpb, { ink: "#e6edf3", accent: "#ffd27a" });
    $("#tpRhyOut").textContent = rhyText();
    $("#tpRhyBox").hidden = false;
  }
  $("#tpRhyGrid").addEventListener("click", function (e) {
    var c = e.target.closest("[data-slot]"); if (!c || !RHYRES) return;
    var k = +c.getAttribute("data-slot");
    RHYRES.slots[k] = !RHYRES.slots[k];
    renderRhyUI();
  });
  $("#tpRhythm").addEventListener("click", rhythmStart);
  $("#tpRhyAgain").addEventListener("click", rhythmStart);
  $("#tpRhyCopy").addEventListener("click", function () {
    var txt = $("#tpRhyOut").textContent;
    var done = function () { setStatus("✓ Rhythm copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { prompt("Copy:", txt); });
    else prompt("Copy:", txt);
  });
  $("#tpRhyNote").addEventListener("click", function () {
    if (!TAPT || !RHYRES) return;
    var s = STATE.songs[TAPT.si]; if (!s) return;
    // machine-parseable line: every view re-draws it as SVG notation
    var line = "🎵 " + rhyPattern() + " " + rhyMeta();
    pushHistory();
    s.rehearsal = s.rehearsal || {};
    var e = s.rehearsal.__song = s.rehearsal.__song || {};
    e.note = e.note ? e.note + "\n" + line : line;
    touchUpdated(); persist(); updatePreview(); renderEditor();
    setStatus("✓ Rhythm pushed as a song note");
  });

  function tpTap() {
    if (RHY) {                                           // rhythm mode: collect beats
      RHY.taps.push(rhyNow());
      var pad0 = $("#tpHit");
      pad0.classList.add("hit"); setTimeout(function () { pad0.classList.remove("hit"); }, 60);
      return;
    }
    if (!TAPT) return;
    if (!TAPT.taps.length) TAPT.t10 = setTimeout(tapTempoFinish, 10000);
    TAPT.taps.push(performance.now());
    clearTimeout(TAPT.tIdle);
    TAPT.tIdle = setTimeout(tapTempoFinish, 2500);
    var b = tapBpm(TAPT.taps);
    $("#tpBpm").textContent = b ? String(Math.round(b)) : "…";
    $("#tpCount").textContent = TAPT.taps.length + " tap" + (TAPT.taps.length > 1 ? "s" : "");
  }
  $("#tpHit").addEventListener("click", tpTap);
  // desktop: spacebar taps too while the pad is open
  document.addEventListener("keydown", function (e) {
    if (!TAPT) return;
    if (e.code === "Space" || e.key === " ") { e.preventDefault(); tpTap(); }
    else if (e.key === "Escape") { tapPadHide(); }
  });
  $("#tpDone").addEventListener("click", tapTempoFinish);
  $("#tpCancel").addEventListener("click", tapPadHide);
  // scroll or focus elsewhere = the user moved on -> shrink the pad away
  function tapPadDismiss(e) {
    if (!TAPT || Date.now() - TAPT.opened < 350) return;   // ignore the opening click
    if (e.target && e.target.closest && e.target.closest("#tapPad")) return;
    if (RHY) { tapPadHide(); return; }                     // mid-recording: just cancel
    if (TAPT.taps.length >= 3) tapTempoFinish(); else tapPadHide();
  }
  document.addEventListener("scroll", tapPadDismiss, true);
  document.addEventListener("focusin", tapPadDismiss);

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
  var SYM = { bar: "|", repopen: "|:", repclose: ":|", mark: "‡", nl: "↵" };
  // polyphony helpers: a column is one note ["E",6] or a stack
  // ["chord",[["E",6],["A",5]]] — normalize both to a list of pairs
  function colPairs(e) { return e[0] === "chord" ? (e[1] || []) : [[e[0], e[1]]]; }
  function makeColEvent(pairs) {
    return pairs.length === 1 ? [pairs[0][0], pairs[0][1]]
      : ["chord", pairs.map(function (p) { return [p[0], p[1]]; })];
  }
  function isNoteCol(e) { return e[0] !== "bar" && e[0] !== "repopen" && e[0] !== "repclose" && e[0] !== "mark" && e[0] !== "nl"; }

  function openTabEditor(si, ri, fromPreview) {
    var r = STATE.songs[si].riffs[ri];
    TAB = { si: si, ri: ri, events: clone(r.tab || []), fromPreview: !!fromPreview };
    $("#tabModalTitle").textContent = "Tab — " + (r.label || "Riff");
    drawGrid();
    $("#tabModal .modal").scrollTop = 0;
    $("#tabModal").classList.add("open");
  }
  function closeTab() {
    var back = TAB && TAB.fromPreview;
    $("#tabModal").classList.remove("open"); TAB = null;
    if (back) setTimeout(dlBack, 0);
  }

  function drawGrid() {
    var ev = TAB.events;
    var strings = FG.STRINGS; // e B G D A E
    // header tools row
    var head = '<tr class="colhead"><td class="slabel"></td>';
    ev.forEach(function (e, i) {
      head += '<td data-hcol="' + i + '"><div class="coltools">' +
        '<div class="coldrag" draggable="true" data-coldrag="' + i + '" title="Drag to move this column">⠿</div>' +
        '<button data-tg="left" data-col="' + i + '" title="←">←</button>' +
        '<button data-tg="del" data-col="' + i + '" title="suppr">✕</button>' +
        '<button data-tg="right" data-col="' + i + '" title="→">→</button>' +
        "</div></td>";
    });
    head += '<td class="symcol">＋</td></tr>';

    var rows = strings.map(function (str, sIdx) {
      var cells = ev.map(function (e, i) {
        if (e[0] === "bar" || e[0] === "repopen" || e[0] === "repclose" || e[0] === "mark" || e[0] === "nl") {
          // symbol spans visually; show on middle row only, blank elsewhere
          if (sIdx === 0) {
            var label = SYM[e[0]] + (e[0] === "repclose" && e[1] ? "×" + e[1] : "");
            return '<td rowspan="6" class="symcell" data-tg="sym" data-col="' + i + '">' + esc(label) + "</td>";
          }
          return ""; // covered by rowspan
        }
        var mine = null;
        colPairs(e).forEach(function (p) { if (p[0] === str) mine = p; });
        var txt = mine ? esc(String(mine[1])) : "·";
        return '<td><button class="cellbtn ' + (mine ? "set" : "") + '" data-tg="note" data-col="' + i + '" data-str="' + str + '" title="' + (mine ? "Edit (empty = remove)" : "Add a note here — same time as the others in this column") + '">' + txt + "</button></td>";
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
      if (!isNoteCol(ev[col])) return;
      var pairs = colPairs(ev[col]).slice();
      var mineK = -1;
      pairs.forEach(function (p, k) { if (p[0] === str) mineK = k; });
      var nf = promptFret(mineK >= 0 ? pairs[mineK][1] : null);
      if (nf === null) return;
      if (nf === "") {                       // remove THIS string's note only
        if (mineK >= 0) pairs.splice(mineK, 1);
        if (!pairs.length) ev.splice(col, 1); // column empty -> drop it
        else ev[col] = makeColEvent(pairs);
      } else {
        var val = isNaN(+nf) ? nf : +nf;
        if (mineK >= 0) pairs[mineK] = [str, val];
        else pairs.push([str, val]);          // stack onto the column = chord
        ev[col] = makeColEvent(pairs);
      }
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

  /* ---- drag & drop: move a column by its ⠿ grip (desktop) ---- */
  var TDRAG = null; // { from, to, before }
  function tdropClear() {
    $$("#tabGrid .tdrop-l,#tabGrid .tdrop-r").forEach(function (n) {
      n.classList.remove("tdrop-l", "tdrop-r");
    });
  }
  $("#tabGrid").addEventListener("dragstart", function (e) {
    var g = e.target.closest && e.target.closest("[data-coldrag]");
    if (!g || !TAB) return;
    TDRAG = { from: +g.getAttribute("data-coldrag"), to: null, before: true };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", "col"); } catch (_) {}
    }
  });
  $("#tabGrid").addEventListener("dragover", function (e) {
    if (!TDRAG) return;
    var c = e.target.closest && e.target.closest("[data-col],[data-hcol]");
    if (!c) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    var col = +(c.getAttribute("data-col") != null ? c.getAttribute("data-col") : c.getAttribute("data-hcol"));
    var r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    TDRAG.to = col;
    TDRAG.before = r && r.width ? (e.clientX - r.left) < r.width / 2 : true;
    tdropClear();
    var hd = $('#tabGrid [data-hcol="' + col + '"]');
    if (hd) hd.classList.add(TDRAG.before ? "tdrop-l" : "tdrop-r");
  });
  $("#tabGrid").addEventListener("drop", function (e) {
    if (!TDRAG || !TAB) return;
    e.preventDefault();
    if (TDRAG.to != null && TDRAG.to !== TDRAG.from) {
      moveInArray(TAB.events, TDRAG.from, TDRAG.before ? TDRAG.to : TDRAG.to + 1);
    }
    TDRAG = null; tdropClear(); drawGrid();
  });
  $("#tabGrid").addEventListener("dragend", function () { TDRAG = null; tdropClear(); });

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
  var allSetsT = $("#allSetsToggle");
  if (allSetsT) allSetsT.addEventListener("change", function () {
    UI.allSets = this.checked; persistUI(); renderEditor();
  });
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

  function toggleMenu(id) {
    $$(".menu-pop").forEach(function (m) { if (m.id !== id) m.classList.remove("open"); });
    var pop = $("#" + id);
    pop.classList.toggle("open");
    // phones: anchored-absolute pops overflow the viewport -> pin them
    // full-width under their button instead
    if (pop.classList.contains("open") && root.innerWidth <= 880) {
      var btn = pop.parentNode.querySelector("button");
      var top = btn ? btn.getBoundingClientRect().bottom + 6 : 60;
      pop.style.position = "fixed";
      pop.style.left = "8px"; pop.style.right = "8px";
      pop.style.top = top + "px"; pop.style.maxWidth = "none";
    } else {
      pop.style.position = ""; pop.style.left = ""; pop.style.right = "";
      pop.style.top = ""; pop.style.maxWidth = "";
    }
  }
  $("#genBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMenu("genMenu"); });
  $("#dataBtn").addEventListener("click", function (e) { e.stopPropagation(); toggleMenu("dataMenu"); });
  document.addEventListener("click", function () { $$(".menu-pop").forEach(function (m) { m.classList.remove("open"); }); });

  $("#genMenu").addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-act"); if (!a) return;
    // print & PDF export exactly what the scope shows (whole book or the set)
    if (a === "pdf-color") FG.generatePdf(viewState(), { bw: false, chordPt: UI.chordPt, compact: UI.compact });
    else if (a === "pdf-bw") FG.generatePdf(viewState(), { bw: true, chordPt: UI.chordPt, compact: UI.compact });
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
    else if (a === "update") { checkUpdate(); }
    else if (a === "export-memos") { exportWithMemos(); }
    else if (a === "import") { $("#fileInput").click(); }
    else if (a === "demo") { if (confirm("Replace the current content with the demo?")) { pushHistory(); STATE = clone(FG.DEMO); UI.openSong = null; renderAll(); } }
    else if (a === "wipe") {
      if (confirm("Clear everything (empty songbook)? Export first if needed.")) {
        pushHistory(); STATE = FG.emptyState(); UI.openSong = null; renderAll();
      }
    }
  });

  // manual "Update app": version.json gives us a cache-proof deploy SHA;
  // the page-level updater installs that exact worker and reloads on activation.
  function checkUpdate() {
    if (!("serviceWorker" in navigator)) { setStatus("⚠︎ no service-worker support here", true); return; }
    if (!root.TTMUpdate) { setStatus("⚠︎ updater unavailable — reload once online", true); return; }
    setStatus("⟳ checking for update…");
    root.TTMUpdate().then(function (state) {
      if (state === "latest") setStatus("✓ Already the latest version");
      else if (state === "downloading") setStatus("⟳ downloading new version…");
      else setStatus("✓ Updated — reloading…");
    }).catch(function () { setStatus("⚠︎ update check failed (offline?)", true); });
  }

  $("#fileInput").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result);
        if (data && data.__ttm === 2 && data.state) {   // "with memos" export
          importMemos(data.memos);
          data = data.state;
        }
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
  // The preview itself is scoped by the active set now (viewState), so the
  // stage simply walks the rendered sheets.
  function stageSheets() { return $$("#preview .sheet"); }
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
    el.style.transform = "none"; el.style.marginBottom = "";

    var portrait = aH > aW * 1.1;
    document.body.classList.toggle("stage-portrait", portrait);

    if (portrait) {
      // "Edit-pane look", one page, max zoom:
      //  - text keeps its natural size and WRAPS when narrow (like the editor
      //    preview the user likes)
      //  - every ASCII tab shrinks ITS OWN font to fit the sheet width, so a
      //    wide riff never taxes the chords' size again
      //  - the sheet width is iterated until the sheet's shape matches the
      //    screen's shape; filling the width then also fills the height ->
      //    exactly one page, and provably the biggest uniform zoom that fits.
      var target = aW / aH, Wb = 600;
      for (var it = 0; it < 6; it++) {
        el.style.width = Wb + "px";
        fitTabs(el);
        var h = el.offsetHeight; if (!h) break;
        var asp = Wb / h;
        if (Math.abs(asp - target) <= 0.02) break;
        Wb = Math.max(300, Math.min(794, Wb * Math.sqrt(target / asp)));
      }
      el.style.width = Wb + "px";
      fitTabs(el);
      var Wp = el.offsetWidth, Hp = el.offsetHeight;
      if (!Wp || !Hp) return;
      var kp = Math.min(aW / Wp, aH / Hp, 2);        // ×2 cap: sparse ≠ billboard
      var txp = Math.max(0, (aW - kp * Wp) / 2), typ = Math.max(0, (aH - kp * Hp) / 2);
      el.style.transformOrigin = "top left";
      el.style.transform = "translate(" + txp.toFixed(1) + "px," + typ.toFixed(1) + "px) scale(" + kp.toFixed(4) + ")";
      return;
    }

    // Landscape / desktop: biggest scale that fits the WHOLE page on one screen.
    el.style.width = "794px";
    fitTabs(el);                                               // whole tab always visible
    var Wn = el.offsetWidth, Hn = el.offsetHeight;
    if (!Wn || !Hn) return;
    var k = Math.min(aW / Wn, aH / Hn);
    if (!isFinite(k) || k <= 0) k = 1;
    var tx = Math.max(0, (aW - k * Wn) / 2), ty = Math.max(0, (aH - k * Hn) / 2);
    el.style.transformOrigin = "top left";
    el.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
  }
  function renderStageCurrent() {
    var sh = stageSheets(); if (!sh.length) return false;
    stageIdx = Math.max(0, Math.min(sh.length - 1, stageIdx));
    sh.forEach(function (s, i) { s.classList.toggle("stage-current", i === stageIdx); });
    updateStageLabel(); fitStageSheet();
    return true;
  }
  function stageGo(i) {
    var sh = stageSheets(); if (!sh.length) return;
    stageIdx = Math.max(0, Math.min(sh.length - 1, i));
    renderStageCurrent();
    if (window.scrollTo) window.scrollTo(0, 0);      // start at the top of the new song
    var wrap = $(".preview-wrap"); if (wrap) wrap.scrollTop = 0;
  }
  /* ---------------------------------------------------------------------
   *  SCREEN AWAKE — held for the WHOLE of View mode, not just gig night:
   *  nobody wants the sheet to black out mid-song because both hands are
   *  on the instrument. Requested on entering View, released on leaving.
   *
   *  The lock is auto-released by the browser whenever the page is hidden
   *  (tab switch, phone locked, app backgrounded), and it does NOT come
   *  back by itself — hence the re-request on visibilitychange.
   *  iOS: needs Safari 16.4+; iOS Low Power Mode overrides it regardless.
   * ------------------------------------------------------------------- */
  var wakeLock = null, wakePending = false;
  function wakeWanted() { return document.body.classList.contains("stage"); }
  function applyWake() {
    if (wakeWanted()) {
      if (!navigator.wakeLock || wakeLock || wakePending) return;
      if (document.visibilityState !== "visible") return;   // would reject anyway
      wakePending = true;
      navigator.wakeLock.request("screen").then(function (l) {
        wakePending = false;
        if (!wakeWanted()) { l.release().catch(function () {}); return; }  // left meanwhile
        wakeLock = l;
        l.addEventListener("release", function () { wakeLock = null; });
      }).catch(function () { wakePending = false; });       // unsupported / refused: no drama
    } else if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }
  // coming back to a View-mode page: the OS dropped the lock, take it again
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") applyWake();
  });

  /* ---- gig night mode: dark inverted sheet, chords only ---- */
  function applyGig() {
    document.body.classList.toggle("gig", !!UI.gig && document.body.classList.contains("stage"));
    var b = $("#stageGig"); if (b) b.classList.toggle("on", !!UI.gig);
    if (document.body.classList.contains("stage")) renderStageCurrent(); // heights change
  }
  var stageGigBtn = $("#stageGig");
  if (stageGigBtn) stageGigBtn.addEventListener("click", function () {
    UI.gig = !UI.gig; persistUI(); applyGig();
  });

  function enterStage() {
    document.body.classList.add("stage");
    applyWake();          // inside the View-button click: user activation is fresh
    applyGig();
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
    document.body.classList.remove("stage-portrait");
    document.body.classList.remove("gig");
    applyWake();          // stage class is gone -> releases the screen lock
    $$("#preview .sheet").forEach(function (s) {
      s.classList.remove("stage-current");
      s.style.transform = ""; s.style.transformOrigin = ""; s.style.width = "";
      s.style.marginBottom = "";
    });
    updatePreview();     // restore book numbering on the editable preview
  }
  function toggleStage() { document.body.classList.contains("stage") ? exitStage() : enterStage(); }

  var viewBtn = $("#viewBtn"); if (viewBtn) viewBtn.addEventListener("click", toggleStage);
  var sPrev = $("#stagePrev"); if (sPrev) sPrev.addEventListener("click", function () { stageGo(stageIdx - 1); });
  var sNext = $("#stageNext"); if (sNext) sNext.addEventListener("click", function () { stageGo(stageIdx + 1); });
  var sExit = $("#stageExit"); if (sExit) sExit.addEventListener("click", exitStage);
  window.addEventListener("resize", function () { if (document.body.classList.contains("stage")) fitStageSheet(); });

  /* ---------------------------------------------------------------------
   *  SWIPE (phone / tablet): drag the sheet sideways to flip songs.
   *  swipe left = next, swipe right = previous — same as ▶ / ◀ and the arrows.
   *  The gesture locks to an axis after a few px, so a vertical drag or a
   *  pinch is left to the browser, and a swipe swallows its own ghost click
   *  (otherwise releasing over a section pill would open the rehearsal sheet).
   * ------------------------------------------------------------------- */
  (function stageSwipe() {
    var host = $(".preview-wrap"), pv = $("#preview");
    if (!host || !pv || !("ontouchstart" in window)) return;
    var LOCK = 12;          // px travelled before the axis is decided
    var COMMIT = 60;        // px (capped at 20% of the screen) that flips a song
    var sx = 0, sy = 0, dx = 0, live = false, horiz = false, swiped = false, w = 1;

    function busy() {       // an overlay owns the touch -> the sheet stays put
      return !!(TAB || RH || RV) ||
        ["#tabZoom", "#rhModal", "#setModal", "#digestModal", "#reviewModal"]
          .some(function (s) { var m = $(s); return m && m.classList.contains("open"); });
    }
    function shift(px) {
      pv.style.transition = "";
      pv.style.transform = px ? "translateX(" + px.toFixed(1) + "px)" : "";
    }
    function springBack() {
      pv.style.transition = "transform .18s ease-out";
      pv.style.transform = "translateX(0px)";
      setTimeout(function () { pv.style.transition = ""; pv.style.transform = ""; }, 200);
    }

    host.addEventListener("touchstart", function (e) {
      live = false; horiz = false; swiped = false;
      if (!document.body.classList.contains("stage") || busy()) return;
      if (e.touches.length !== 1) return;                  // pinch-zoom stays a pinch
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      dx = 0; live = true; w = host.clientWidth || 1;
    }, { passive: true });

    host.addEventListener("touchmove", function (e) {
      if (!live) return;
      if (e.touches.length !== 1) { live = false; shift(0); return; }
      dx = e.touches[0].clientX - sx;
      var dy = e.touches[0].clientY - sy;
      if (!horiz) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) { live = false; return; }  // vertical: not ours
        horiz = true;
      }
      swiped = true;
      if (e.cancelable) e.preventDefault();
      var last = stageSheets().length - 1;
      var stuck = (dx > 0 && stageIdx <= 0) || (dx < 0 && stageIdx >= last);
      shift(stuck ? dx * 0.25 : dx);                       // rubber-band at both ends
    }, { passive: false });

    function release() {
      if (!live) return;
      live = false;
      if (horiz && Math.abs(dx) > Math.min(COMMIT, w * 0.2)) {
        shift(0);                                          // new song lands centred
        stageGo(stageIdx + (dx < 0 ? 1 : -1));
      } else springBack();
    }
    host.addEventListener("touchend", release, { passive: true });
    host.addEventListener("touchcancel", function () { live = false; shift(0); }, { passive: true });

    // a swipe must not also count as a tap on whatever is under the finger
    host.addEventListener("click", function (e) {
      if (!swiped) return;
      swiped = false;
      e.stopPropagation(); e.preventDefault();
    }, true);
  })();
  // expose for the preview-refresh hook (re-apply current sheet after a re-render)
  root.__ttmStageRefresh = function () { if (document.body.classList.contains("stage")) renderStageCurrent(); };

  // BOOK index of the song shown in stage view (-1 on the cover). The preview
  // is scoped, so the sheet position must be translated back to the book.
  function stageSongIndex() {
    var cur = stageSheets()[stageIdx];
    var vi = cur ? $$("#preview .sheet.songsheet").indexOf(cur) : -1;
    if (vi < 0) return -1;
    var bi = viewToBook(vi);
    return bi == null ? -1 : bi;
  }
  function jumpToSong(bi) {                       // takes a BOOK index
    var vi = bookToView(bi);
    if (vi < 0) return;                           // song not in the current scope
    var target = $$("#preview .sheet.songsheet")[vi];
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
    $("#rhMemoWrap").style.display = memoOK ? "" : "none";
    drawRh();
    $("#rhModal").classList.add("open");
  }
  function closeRh() {
    recStop(); stopPlayback();
    $("#rhModal").classList.remove("open"); RH = null;
  }
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
    if (memoOK) { stopPlayback(); $("#rhMemos").innerHTML = ""; drawMemos(); }
    // pushed notes for this target, one row each, deletable. The textarea is a
    // DRAFT: never overwritten here (a colour tap must not eat what's typed).
    var lines = (cur.note || "").split("\n").filter(Boolean);
    $("#rhNotes").innerHTML = lines.map(function (ln, k) {
      return '<div class="rh-note-row" data-k="' + k + '" title="Tap to edit">' +
        '<span class="rh-n">' + noteNum(k) + "</span>" +
        "<span>" + FG.rhNoteHTML(ln) + "</span>" +
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
  /* ---- tab zoom: tap a shrunken riff on stage -> full-size, ONE line ---- */
  function openTabZoom(song, riff) {
    $("#tzTitle").textContent = (song.num ? song.num + " — " : "") + "Tab — " + (riff.label || "Riff");
    // maxw huge + manual line-skips stripped = one continuous 6-line ribbon
    var evs = (riff.tab || []).filter(function (ev) { return ev[0] !== "nl"; });
    var blocks = FG.renderTab(evs.length ? evs : null, { ascii: false, maxw: 1e9 });
    $("#tzPre").textContent = blocks.map(function (b) { return b.join("\n"); }).join("\n\n");
    $("#tabZoom").classList.add("open");
  }
  function closeTabZoom() { $("#tabZoom").classList.remove("open"); }
  $("#tzClose").addEventListener("click", closeTabZoom);
  $("#tabZoom").addEventListener("click", function (e) { if (e.target === $("#tabZoom")) closeTabZoom(); });

  // stage view taps: pills, chord rows and the song header all open the
  // rehearsal sheet on the right target; a riff opens the tab zoom.
  $("#preview").addEventListener("click", function (e) {
    if (!document.body.classList.contains("stage")) return;
    var i = stageSongIndex(); if (i < 0) return;
    var p = e.target.closest(".pill[data-sec]");
    if (p) { openRehearsal(i, p.getAttribute("data-sec")); return; }
    var tr = e.target.closest(".chords tr");
    if (tr) {
      var cl = tr.querySelector(".cl");
      var sec = cl ? cl.textContent.trim() : "";
      openRehearsal(i, sec || "__song");
      return;
    }
    if (e.target.closest(".songsheet-head")) { openRehearsal(i, "__song"); return; }
    var tp = e.target.closest("pre.tab, .tab-head");
    if (tp) {
      var sheet = e.target.closest(".sheet.songsheet"); if (!sheet) return;
      var myHead = tp.classList.contains("tab-head") ? tp
        : (tp.previousElementSibling && tp.previousElementSibling.classList.contains("tab-head")
           ? tp.previousElementSibling : null);
      var ri = myHead ? $$(".tab-head", sheet).indexOf(myHead) : -1;
      var r = STATE.songs[i] && STATE.songs[i].riffs[ri];
      if (r) openTabZoom(STATE.songs[i], r);
    }
  });

  /* =====================================================================
   *  PREVIEW -> EDITOR deep link (edit mode): DOUBLE-click any read-only
   *  content on the right and land in the matching field on the left —
   *  chord row -> that chord input, pills -> structure, header -> title,
   *  Breaks/Notes -> their inputs, a tab -> the tab grid editor.
   * ===================================================================== */
  // remember where the user WAS before a deep link, for the ↩ button.
  // Desktop scrolls the two panes; phone (single column) scrolls the window.
  var DL = null;
  function dlRemember() {
    var ed = $(".editor"), pw = $(".preview-wrap");
    DL = { edScroll: ed ? ed.scrollTop : 0, pvScroll: pw ? pw.scrollTop : 0,
           winScroll: root.pageYOffset || 0, prevOpen: UI.openSong };
    $("#backBtn").hidden = false;
  }
  function dlBack() {
    $("#backBtn").hidden = true;
    if (!DL) return;
    var dl = DL; DL = null;
    var active = document.activeElement; if (active && active.blur) active.blur();
    UI.openSong = dl.prevOpen != null && dl.prevOpen < STATE.songs.length ? dl.prevOpen : null;
    renderEditor();
    setTimeout(function () {
      var ed = $(".editor"), pw = $(".preview-wrap");
      if (ed) ed.scrollTop = dl.edScroll;
      if (pw) pw.scrollTop = dl.pvScroll;
      if (root.scrollTo) root.scrollTo(0, dl.winScroll);
    }, root.innerWidth <= 880 ? 300 : 0);
  }
  $("#backBtn").addEventListener("click", dlBack);

  function deepLink(e) {
    if (document.body.classList.contains("stage")) return;
    var sheet = e.target.closest(".sheet.songsheet"); if (!sheet) return;
    var vi = $$("#preview .sheet.songsheet").indexOf(sheet); if (vi < 0) return;
    var si = viewToBook(vi); if (si == null || si < 0) return;   // scoped -> book
    dlRemember();
    // tabs open the grid editor directly
    var tabEl = e.target.closest("pre.tab, .tab-head");
    if (tabEl) {
      var myHead = tabEl.classList.contains("tab-head") ? tabEl
        : (tabEl.previousElementSibling && tabEl.previousElementSibling.classList.contains("tab-head")
           ? tabEl.previousElementSibling : null);
      var ri = myHead ? $$(".tab-head", sheet).indexOf(myHead) : -1;
      if (ri >= 0 && STATE.songs[si] && STATE.songs[si].riffs[ri]) { openTabEditor(si, ri, true); return; }
    }
    UI.openSong = si; renderEditor();
    var card = $('[data-card="' + si + '"]');
    var focusEl = null;
    var tr = e.target.closest(".chords tr");
    if (tr) {
      var ci = $$(".chords tr", sheet).indexOf(tr);
      focusEl = $('input[data-song="' + si + '"][data-ci="' + ci + '"][data-part="value"]');
    } else if (e.target.closest(".pills") || (e.target.classList && e.target.classList.contains("raw"))) {
      focusEl = $('textarea[data-song="' + si + '"][data-field="structure"]');
    } else if (e.target.closest(".songsheet-head")) {
      focusEl = $('input[data-song="' + si + '"][data-field="title"]');
    } else if (e.target.closest(".kv")) {
      var kb = e.target.closest(".kv").querySelector("b");
      var key = kb && kb.textContent === "Breaks" ? "breaks" : "notes";
      focusEl = $('input[data-song="' + si + '"][data-field="' + key + '"]');
    }
    if (focusEl) {
      try { focusEl.focus({ preventScroll: true }); } catch (_) { focusEl.focus(); }
      try { var L = focusEl.value.length; focusEl.setSelectionRange(L, L); } catch (_) {}
      if (focusEl.scrollIntoView) setTimeout(function () {
        focusEl.scrollIntoView({ block: "center", behavior: "auto" });
      }, root.innerWidth <= 880 ? 350 : 0);
    } else if (card && card.scrollIntoView) card.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  var preview = $("#preview"), touchStart = null, lastTap = null, touchLinkedAt = 0;
  preview.addEventListener("dblclick", function (e) {
    if (Date.now() - touchLinkedAt > 500) deepLink(e);
  });
  preview.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "touch" && e.isPrimary) touchStart = { x: e.clientX, y: e.clientY };
  });
  preview.addEventListener("pointerup", function (e) {
    if (!touchStart || e.pointerType !== "touch") return;
    var now = Date.now(), dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.hypot(dx, dy) > 12) { lastTap = null; return; }
    var sheet = e.target.closest(".sheet.songsheet");
    if (!sheet) { lastTap = null; return; }
    if (lastTap && sheet === lastTap.sheet && now - lastTap.at < 400 &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null; touchLinkedAt = now; e.preventDefault(); deepLink(e);
    } else {
      lastTap = { at: now, x: e.clientX, y: e.clientY, sheet: sheet };
    }
  });
  preview.addEventListener("pointercancel", function () { touchStart = lastTap = null; });

  /* =====================================================================
   *  VOICE MEMOS — per song+section, IndexedDB (audio is too big for
   *  localStorage and WAY too big for the share URL). Auto-vanish after
   *  MEMO_TTL_DAYS so a phone never silts up with old takes. Device-local;
   *  they only travel via Data → "Export incl. voice memos" (file/AirDrop).
   * ===================================================================== */
  var MEMO_TTL_DAYS = 30;
  var MEMO_MAX_MS = 5 * 60 * 1000;                 // forgotten-mic guard
  var memoOK = typeof indexedDB !== "undefined" &&
               typeof MediaRecorder !== "undefined" &&
               !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  var MDB = null;
  function mdb() {
    return new Promise(function (res, rej) {
      if (MDB) return res(MDB);
      var r = indexedDB.open("ttm-memos", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("m", { keyPath: "id" }); };
      r.onsuccess = function () { MDB = r.result; res(MDB); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function mtx(mode, fn) {
    return mdb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("m", mode), st = tx.objectStore("m");
        var out = fn(st);
        tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function mput(o) { return mtx("readwrite", function (st) { st.put(o); }); }
  function mdel(id) { return mtx("readwrite", function (st) { st.delete(id); }); }
  function mall() {
    return mdb().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction("m").objectStore("m").getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  // TTL sweep — ran once at boot. ONLY age-based on purpose: sweeping
  // "orphans" (memos whose song isn't in STATE) would destroy real memos the
  // moment the user loads the demo or imports another book. Orphans die of
  // old age like everything else here.
  function memoSweep() {
    if (!memoOK) return;
    var cut = Date.now() - MEMO_TTL_DAYS * 864e5;
    mall().then(function (list) {
      list.forEach(function (m) { if (m.created < cut) mdel(m.id); });
    }).catch(function () {});
  }
  function memoDaysLeft(m) {
    return Math.max(0, Math.ceil((m.created + MEMO_TTL_DAYS * 864e5 - Date.now()) / 864e5));
  }
  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /* ---- recording ---- */
  var REC = null;   // { mr, stream, t0, timer }
  var PLAYING = null; // { id, audio, url }
  function recStopUI() {
    var b = $("#rhRec"); if (b) { b.textContent = "🎤 Rec"; b.classList.remove("danger"); }
    var t = $("#rhRecT"); if (t) t.textContent = "";
  }
  function recStop() { if (REC && REC.mr.state !== "inactive") REC.mr.stop(); }
  function recStart() {
    if (!RH) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!RH) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var chunks = [], mr = new MediaRecorder(stream);
      var song = STATE.songs[RH.si], sec = RH.sec;
      REC = { mr: mr, stream: stream, t0: Date.now(), timer: null, wake: null };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        clearInterval(REC.timer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (REC.wake) { REC.wake.release().catch(function () {}); REC.wake = null; }
        var dur = Date.now() - REC.t0;
        REC = null; recStopUI();
        if (!chunks.length || dur < 400) return;
        var blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        mput({ id: uid(), songId: song.id, sec: sec, blob: blob, mime: blob.type,
               dur: dur, size: blob.size, created: Date.now() })
          .then(drawMemos).catch(function () { setStatus("⚠︎ memo save failed", true); });
      };
      mr.start();
      var b = $("#rhRec"); if (b) { b.textContent = "■ Stop"; b.classList.add("danger"); }
      REC.timer = setInterval(function () {
        if (!REC) return;
        var el = Date.now() - REC.t0;
        var t = $("#rhRecT"); if (t) t.textContent = "● " + fmtDur(el);
        if (el >= MEMO_MAX_MS) recStop();
      }, 250);
      // screen lock kills the mic on phones — hold a wake lock while recording.
      // Kept on REC and released in onstop, otherwise the screen would stay
      // awake forever after the first take. Independent of the View-mode lock.
      if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) {
        if (REC) REC.wake = l; else l.release().catch(function () {});  // stopped already
      }).catch(function () {});
    }).catch(function () { alert("Microphone unavailable or permission denied."); });
  }
  $("#rhRec").addEventListener("click", function () { REC ? recStop() : recStart(); });

  /* ---- playback + memo rows (for the section currently targeted) ---- */
  function stopPlayback() {
    if (!PLAYING) return;
    PLAYING.audio.pause();
    URL.revokeObjectURL(PLAYING.url);
    PLAYING = null;
    $$("[data-mid]").forEach(function (b) { b.textContent = "▶"; });   // any memo list
  }
  function playMemo(id, btn) {
    if (PLAYING && PLAYING.id === id) { stopPlayback(); return; }
    stopPlayback();
    mall().then(function (list) {
      var m = list.filter(function (x) { return x.id === id; })[0]; if (!m) return;
      var url = URL.createObjectURL(m.blob), a = new Audio(url);
      PLAYING = { id: id, audio: a, url: url };
      btn.textContent = "⏸";
      a.onended = stopPlayback;
      a.play().catch(stopPlayback);
    });
  }
  function drawMemos() {
    if (!memoOK || !RH) return;
    var song = STATE.songs[RH.si], sec = RH.sec;
    mall().then(function (list) {
      if (!RH || STATE.songs[RH.si] !== song || RH.sec !== sec) return; // stale
      var mine = list.filter(function (m) { return m.songId === song.id && m.sec === sec; })
                     .sort(function (a, b) { return a.created - b.created; });
      $("#rhMemos").innerHTML = mine.map(function (m) {
        return '<div class="memo-row">' +
          '<button class="btn sm" data-mid="' + m.id + '">▶</button>' +
          '<span class="m-meta">' + fmtDur(m.dur) + " · " + Math.round(m.size / 1024) + " KB · " +
            memoDaysLeft(m) + "d left</span>" +
          '<button class="btn sm danger" data-mdel="' + m.id + '">✕</button></div>';
      }).join("");
      // 🎤 badge on chips that have memos
      var bySec = {};
      list.forEach(function (m) { if (m.songId === song.id) bySec[m.sec] = (bySec[m.sec] || 0) + 1; });
      $$("#rhChips .chip").forEach(function (c) {
        var n = bySec[c.getAttribute("data-sec")];
        if (n && !c.querySelector(".mbadge")) {
          var sp = document.createElement("span");
          sp.className = "mbadge"; sp.textContent = " 🎤" + n;
          c.appendChild(sp);
        }
      });
    }).catch(function () {});
  }
  $("#rhMemos").addEventListener("click", function (e) {
    var del = e.target.closest("[data-mdel]");
    if (del) { stopPlayback(); mdel(del.getAttribute("data-mdel")).then(drawMemos); return; }
    var pb = e.target.closest("[data-mid]"); if (!pb) return;
    playMemo(pb.getAttribute("data-mid"), pb);
  });

  /* ---- export / import with memos (file path — NOT the share URL) ---- */
  function blobToDataURL(b) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(b);
    });
  }
  function exportWithMemos() {
    var base = memoOK ? mall() : Promise.resolve([]);
    base.then(function (list) {
      return Promise.all(list.map(function (m) {
        return blobToDataURL(m.blob).then(function (d) {
          return { id: m.id, songId: m.songId, sec: m.sec, mime: m.mime,
                   dur: m.dur, size: m.size, created: m.created, data: d };
        });
      }));
    }).then(function (memos) {
      var payload = JSON.stringify({ __ttm: 2, state: STATE, memos: memos });
      var blob = new Blob([payload], { type: "application/json" });
      var file = new File([blob], "songbook-with-memos.json", { type: "application/json" });
      var mb = Math.round(blob.size / 104857.6) / 10;
      // iPhone: straight to the share sheet (AirDrop); elsewhere: download
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "Songbook + memos" }).catch(function () {});
      } else {
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "songbook-with-memos.json"; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }
      setStatus("✓ Export with memos (" + mb + " MB)");
    }).catch(function () { setStatus("⚠︎ memo export failed", true); });
  }
  function importMemos(memos) {
    if (!memoOK || !Array.isArray(memos)) return;
    memos.forEach(function (m) {
      if (!m || !m.data) return;
      fetch(m.data).then(function (r) { return r.blob(); }).then(function (blob) {
        mput({ id: m.id || uid(), songId: m.songId, sec: m.sec, blob: blob,
               mime: m.mime || blob.type, dur: m.dur || 0, size: blob.size,
               created: m.created || Date.now() });
      }).catch(function () {});
    });
  }

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
        // set rows carry the SET position; the book number shows after the title
        var s2 = STATE.songs[i];
        var shown = { num: String(k + 1).padStart(2, "0"), rehearsal: s2.rehearsal,
                      title: (s2.title || "(untitled)") + "  ·  book " + s2.num };
        return setRow(shown, i,
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
  function openSetlist() { drawSetlist(); $("#setModal").classList.add("open"); }
  var stageSet = $("#stageSet");
  if (stageSet) stageSet.addEventListener("click", openSetlist);
  var setBtn = $("#setBtn");   // also reachable from the main editor screen
  if (setBtn) setBtn.addEventListener("click", function (e) { e.stopPropagation(); openSetlist(); });
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
      renderAll(); drawSetlist();                  // scope drives the preview now
      return;
    }
    var srem = e.target.closest("[data-srem]");    // remove from set
    if (srem && al) {
      pushHistory();
      al.songs.splice(+srem.getAttribute("data-srem"), 1);
      renderAll(); drawSetlist();
      return;
    }
    var sadd = e.target.closest("[data-sadd]");    // add to set
    if (sadd && al) {
      pushHistory();
      al.songs.push(sadd.getAttribute("data-sadd"));
      renderAll(); drawSetlist();
      return;
    }
    var row = e.target.closest(".set-row");
    if (row && !row.hasAttribute("data-noj")) {
      var ti = +row.getAttribute("data-i");
      if (document.body.classList.contains("stage")) jumpToSong(ti);
      else {           // from the editor: open that song's card and scroll to it
        UI.openSong = ti; renderEditor();
        var card = $('[data-card="' + ti + '"]');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      closeSetlist();
    }
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
            return '<span class="rh-nn">' + noteNum(k) + "</span> " + FG.rhNoteHTML(ln);
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
   *  REVIEW QUEUE — inbox-zero triage of rehearsal notes, one at a time:
   *  read the note (play its memos), fix the relevant fields IN PLACE,
   *  "✓ Fixed" clears the note and slides the next in. "Keep" skips.
   * ===================================================================== */
  var RV = null; // { list: [{si, sec}], k, snapped }
  function buildReviewList() {
    var rank = { red: 0, yellow: 1 }, out = [];
    STATE.songs.forEach(function (s, si) {
      var es = FG.rhEntries(s);
      es.sort(function (a, b) {
        return (a[1].c in rank ? rank[a[1].c] : 2) - (b[1].c in rank ? rank[b[1].c] : 2);
      });
      es.forEach(function (kv) { out.push({ si: si, sec: kv[0] }); });
    });
    return out;
  }
  function reviewCount() { return buildReviewList().length; }
  function openReview() { RV = { list: buildReviewList(), k: 0, snapped: false }; drawReview(); $("#reviewModal").classList.add("open"); }
  function closeReview() {
    stopPlayback();
    rvClearHighlight();
    $("#reviewModal").classList.remove("open");
    RV = null;
    renderAll();                                  // reflect all triage edits in the editor
  }
  function rvEntry() {
    if (!RV || !RV.list.length) return null;
    RV.k = Math.max(0, Math.min(RV.list.length - 1, RV.k));
    var it = RV.list[RV.k], s = STATE.songs[it.si];
    var e = s && s.rehearsal && s.rehearsal[it.sec];
    if (!e || (!e.c && !e.note)) {                // entry vanished meanwhile
      RV.list.splice(RV.k, 1);
      return rvEntry();
    }
    return { it: it, s: s, e: e };
  }
  function drawReview() {
    stopPlayback();
    var cur = rvEntry();
    $("#rvProgress").textContent = RV.list.length ? (RV.k + 1) + " / " + RV.list.length : "";
    var foot = $(".rv-actions");
    if (!cur) {
      $("#rvBody").innerHTML = '<div class="empty-hint">Nothing left to review 🎉<br>' +
        '<span style="font-size:.85em;color:var(--muted)">Marks and notes you add in 📖 View will queue up here.</span></div>';
      if (foot) foot.style.display = "none";
      return;
    }
    if (foot) foot.style.display = "";
    var s = cur.s, e = cur.e, sec = cur.it.sec, si = cur.it.si;
    RV.snapped = false;                           // one undo step per entry's edits
    var lines = (e.note || "").split("\n").filter(Boolean);
    var noteHtml = lines.map(function (ln, k) {
      return '<div class="rh-note-row"><span class="rh-n">' + noteNum(k) + "</span>" +
        "<span>" + FG.rhNoteHTML(ln) + "</span>" +
        '<button class="btn sm" data-rvcp="' + k + '" title="Copy this note — ready to paste into a field">⧉</button>' +
        '<button class="btn sm danger" data-rvln="' + k + '" title="Delete this note line">✕</button></div>';
    }).join("") || '<div class="rh-note-row"><span></span><span style="color:var(--muted)">(mark only, no text)</span></div>';
    // chord row whose label matches the section, if any -> editable in place
    var ci = -1;
    (s.chords || []).some(function (c, i) {
      if ((c.label || "").trim().toLowerCase() === sec.trim().toLowerCase()) { ci = i; return true; }
      return false;
    });
    $("#rvBody").innerHTML =
      '<div class="rv-song">' + esc(s.num) + " — " + esc(s.title || "(untitled)") +
        ' <span class="rv-sec' + (e.c ? " " + e.c : "") + '">' + (e.c ? '<span class="rdot ' + e.c + '"></span>' : "") + esc(rhLabel(sec)) + "</span>" +
        ' <a href="#" id="rvOpenCard" style="font-size:.8rem">open full card ›</a></div>' +
      noteHtml +
      '<div id="rvMemos"></div>' +
      '<div class="rv-fields">' +
        '<div class="row"><label>Tempo</label><input data-rvf="tempo" value="' + esc(s.tempo) + '"></div>' +
        '<div class="row"><label>Key</label><input data-rvf="key" value="' + esc(s.key) + '"></div>' +
        (ci >= 0
          ? '<div class="row rv-wide"><label>Chords — ' + esc(s.chords[ci].label) + '</label><input data-rvc="' + ci + '" value="' + esc(s.chords[ci].value) + '"></div>'
          : "") +
        '<div class="row rv-wide"><label>Song notes</label><input data-rvf="notes" value="' + esc(s.notes) + '"></div>' +
      "</div>";
    // memos of this song+section, playable right here
    if (memoOK) mall().then(function (list) {
      if (!RV) return;
      var mine = list.filter(function (m) { return m.songId === s.id && m.sec === sec; });
      var host = $("#rvMemos"); if (!host) return;
      host.innerHTML = mine.map(function (m) {
        return '<div class="memo-row"><button class="btn sm" data-mid="' + m.id + '">▶</button>' +
          '<span class="m-meta">' + fmtDur(m.dur) + " · " + memoDaysLeft(m) + "d left</span></div>";
      }).join("");
    }).catch(function () {});
    var oc = $("#rvOpenCard");
    if (oc) oc.addEventListener("click", function (ev) {
      ev.preventDefault();
      closeReview();
      UI.openSong = si; renderEditor();
      var card = $('[data-card="' + si + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    rvHighlight(si, sec);
  }
  // spotlight the reviewed mark on the sheet behind the modal: scroll the
  // preview to that song and pulse the section pill (or the song header)
  function rvClearHighlight() {
    $$(".rv-target").forEach(function (n) { n.classList.remove("rv-target"); });
  }
  function rvHighlight(si, sec) {
    rvClearHighlight();
    var vi = bookToView(si);
    if (vi < 0) return;                       // song outside the current scope
    var sheet = $$("#preview .sheet.songsheet")[vi]; if (!sheet) return;
    var tgt = null;
    if (sec !== "__song") {
      $$(".pill[data-sec]", sheet).forEach(function (p) {
        if (!tgt && p.getAttribute("data-sec") === sec) tgt = p;
      });
    }
    if (!tgt) tgt = sheet.querySelector(".songsheet-head") || sheet;
    tgt.classList.add("rv-target");
    if (tgt.scrollIntoView) tgt.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  // preview re-renders (debounced) after in-queue edits -> re-apply the spotlight
  root.__ttmRvRefresh = function () {
    if (!RV) return;
    var cur = rvEntry();
    if (cur) rvHighlight(cur.it.si, cur.it.sec);
  };
  function rvSnap() { if (RV && !RV.snapped) { pushHistory(); RV.snapped = true; } }
  $("#rvBody").addEventListener("input", function (ev) {
    var t = ev.target, cur = rvEntry(); if (!cur) return;
    rvSnap(); touchUpdated();
    if (t.hasAttribute("data-rvf")) cur.s[t.getAttribute("data-rvf")] = t.value;
    else if (t.hasAttribute("data-rvc")) {
      var c = cur.s.chords[+t.getAttribute("data-rvc")]; if (c) c.value = t.value;
    } else return;
    updatePreview(); persist();
  });
  $("#rvBody").addEventListener("click", function (ev) {
    var pb = ev.target.closest("[data-mid]");
    if (pb) { playMemo(pb.getAttribute("data-mid"), pb); return; }
    var cp = ev.target.closest("[data-rvcp]");
    if (cp) {                                     // copy note line, ready to paste
      var cur0 = rvEntry(); if (!cur0) return;
      var txt = ((cur0.e.note || "").split("\n").filter(Boolean))[+cp.getAttribute("data-rvcp")] || "";
      var ok = function () {
        cp.textContent = "✓";
        setTimeout(function () { cp.textContent = "⧉"; }, 900);
        setStatus("✓ Note copied — paste it where it belongs");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok, function () { prompt("Copy:", txt); });
      } else prompt("Copy:", txt);
      return;
    }
    var ln = ev.target.closest("[data-rvln]");
    if (!ln) return;
    var cur = rvEntry(); if (!cur) return;
    rvSnap();
    var lines = (cur.e.note || "").split("\n").filter(Boolean);
    lines.splice(+ln.getAttribute("data-rvln"), 1);
    if (lines.length) cur.e.note = lines.join("\n"); else delete cur.e.note;
    if (!cur.e.c && !cur.e.note) {                // nothing left -> entry resolved
      delete cur.s.rehearsal[cur.it.sec];
      if (!Object.keys(cur.s.rehearsal).length) delete cur.s.rehearsal;
      RV.list.splice(RV.k, 1);
    }
    persist(); drawReview();
  });
  $("#rvFixed").addEventListener("click", function () {
    var cur = rvEntry(); if (!cur) return;
    rvSnap(); touchUpdated();
    delete cur.s.rehearsal[cur.it.sec];
    if (cur.s.rehearsal && !Object.keys(cur.s.rehearsal).length) delete cur.s.rehearsal;
    RV.list.splice(RV.k, 1);                      // next one slides into place
    persist(); drawReview();
  });
  $("#rvSkip").addEventListener("click", function () { if (RV && RV.k < RV.list.length - 1) { RV.k++; drawReview(); } });
  $("#rvBack").addEventListener("click", function () { if (RV && RV.k > 0) { RV.k--; drawReview(); } });
  $("#rvClose").addEventListener("click", closeReview);
  $("#reviewModal").addEventListener("click", function (e) { if (e.target === $("#reviewModal")) closeReview(); });
  $("#reviewBtn").addEventListener("click", openReview);

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
      if ($("#tabZoom").classList.contains("open")) { closeTabZoom(); return; }
      if (CP) { closeChordPad(); return; }
      if (RH) { closeRh(); return; }
      if (RV) { closeReview(); return; }
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
  var ast = $("#allSetsToggle"); if (ast) ast.checked = UI.allSets;
  $("#autoNumToggle").checked = !!STATE.autoNumber;
  updateUndoBtn();
  renderAll();
  if (!STORAGE_OK) setStatus("⚠︎ browser storage unavailable — use Export", true);
  else if (RESTORED) setStatus("✓ Restored from browser");
  memoSweep();     // vanish memos past their TTL (and those of deleted songs)
  // link carried a song index -> open stage view on it (after the debounced render)
  if (PENDING_STAGE_SONG != null) {
    setTimeout(function () {
      enterStage();
      jumpToSong(Math.max(0, Math.min(STATE.songs.length - 1, PENDING_STAGE_SONG)));
      PENDING_STAGE_SONG = null;
    }, 400);
  }
})(typeof window !== "undefined" ? window : globalThis);
