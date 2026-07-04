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

    return '<div class="song-card' + (open ? " open" : "") + '" data-card="' + i + '">' +
      '<div class="sc-head" data-toggle="' + i + '" data-drag="song" data-song="' + i + '" draggable="true" title="Drag the bar to reorder">' +
        '<span class="grip" aria-hidden="true">⠿</span>' +
        '<span class="num">' + esc(s.num) + "</span>" +
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
          '<div class="row"><label>Tempo</label><input data-song="' + i + '" data-field="tempo" value="' + esc(s.tempo) + '"></div>' +
          '<div class="row"><label>Meter</label><input data-song="' + i + '" data-field="meter" value="' + esc(s.meter) + '"></div>' +
          '<div class="row"><label>Feel</label><input data-song="' + i + '" data-field="feel" value="' + esc(s.feel) + '"></div>' +
        "</div>" +
        '<div class="row"><label>Structure (sections separated by →)</label>' +
          '<textarea data-song="' + i + '" data-field="structure" rows="2">' + esc(s.structure) + "</textarea></div>" +
        '<div class="sub">Chords by section</div>' + chordRows +
        '<button class="addline" data-act="addChord" data-song="' + i + '">＋ chord section</button>' +
        '<div class="sub">Riffs / tabs</div>' + riffRows +
        '<button class="addline" data-act="addRiff" data-song="' + i + '">＋ riff</button>' +
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

  function renderAll() { applyAutoNumber(); renderEditor(); updatePreview(); persist(); }

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
  });

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
  });

  $("#dataMenu").addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-act"); if (!a) return;
    if (a === "export") {
      var blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "songbook-data.json"; link.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (a === "import") { $("#fileInput").click(); }
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

  // keyboard: Esc closes modal / leaves View; arrows flip songs in View mode
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (TAB) { closeTab(); return; }
      if (document.body.classList.contains("stage")) { exitStage(); return; }
    }
    if (document.body.classList.contains("stage") && !TAB) {
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
})(typeof window !== "undefined" ? window : globalThis);
