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
  var UI = { bw: false, compact: false, chordPt: 12, openSong: null };

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
      pv.innerHTML = FG.renderPreview(STATE, { bw: UI.bw, chordPt: UI.chordPt, compact: UI.compact });
    }, 120);
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
      '<div class="sc-head" data-toggle="' + i + '">' +
        '<span class="num">' + esc(s.num) + "</span>" +
        '<span class="ttl">' + esc(s.title || "(untitled)") + "</span>" +
        '<button class="btn sm" data-act="up" data-song="' + i + '" title="Up">▲</button>' +
        '<button class="btn sm" data-act="down" data-song="' + i + '" title="Down">▼</button>' +
        '<span class="chev">›</span>' +
      "</div>" +
      '<div class="sc-body">' +
        '<div class="grid2">' +
          '<div class="row"><label>No.</label><input data-song="' + i + '" data-field="num" value="' + esc(s.num) + '"></div>' +
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

  function renderAll() { renderEditor(); updatePreview(); persist(); }

  /* ---------------- editor events ---------------- */
  // text inputs: mutate in place, do NOT rebuild editor (keep focus)
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-meta")) {
      STATE.meta[t.getAttribute("data-meta")] = t.value; updatePreview(); persist(); return;
    }
    var si = t.getAttribute && t.getAttribute("data-song");
    if (si == null) return;
    si = +si; var s = STATE.songs[si]; if (!s) return;
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
    if (act === "up" || act === "down") {
      e.stopPropagation();
      var j = act === "up" ? si - 1 : si + 1;
      if (j < 0 || j >= STATE.songs.length) return;
      var tmp = STATE.songs[si]; STATE.songs[si] = STATE.songs[j]; STATE.songs[j] = tmp;
      if (UI.openSong === si) UI.openSong = j; else if (UI.openSong === j) UI.openSong = si;
      renderAll(); return;
    }
    if (act === "delSong") { if (confirm("Delete “" + (s.title || "") + "”?")) { STATE.songs.splice(si, 1); UI.openSong = null; renderAll(); } return; }
    if (act === "addChord") { s.chords.push({ label: "", value: "" }); renderAll(); return; }
    if (act === "delChord") { s.chords.splice(+btn.getAttribute("data-ci"), 1); renderAll(); return; }
    if (act === "addRiff") { s.riffs.push({ label: "Riff", note: "", tab: null }); renderAll(); return; }
    if (act === "delRiff") { s.riffs.splice(+btn.getAttribute("data-ri"), 1); renderAll(); return; }
    if (act === "editTab") { openTabEditor(si, +btn.getAttribute("data-ri")); return; }
  });

  $("#addSong").addEventListener("click", function () {
    var n = String(STATE.songs.length + 1).padStart(2, "0");
    STATE.songs.push(FG.emptySong(n)); UI.openSong = STATE.songs.length - 1; renderAll();
  });

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
    var r = STATE.songs[TAB.si].riffs[TAB.ri];
    r.tab = TAB.events.length ? clone(TAB.events) : null;
    closeTab(); renderAll();
  });

  /* =====================================================================
   *  TOPBAR: generate, data, options
   * ===================================================================== */
  $("#chordPt").addEventListener("input", function () { UI.chordPt = +this.value || 12; updatePreview(); });
  $("#bwToggle").addEventListener("change", function () { UI.bw = this.checked; updatePreview(); });
  $("#compactToggle").addEventListener("change", function () { UI.compact = this.checked; updatePreview(); });

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
    else if (a === "demo") { if (confirm("Replace the current content with the demo?")) { STATE = clone(FG.DEMO); UI.openSong = null; renderAll(); } }
    else if (a === "wipe") {
      if (confirm("Clear everything (empty songbook)? Export first if needed.")) {
        STATE = FG.emptyState(); UI.openSong = null; renderAll();
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
        STATE = data; UI.openSong = null; renderAll();
      } catch (err) { alert("Import failed: " + err.message); }
    };
    rd.readAsText(f); this.value = "";
  });

  // keyboard: Esc closes modal
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && TAB) closeTab(); });

  /* ---------------- boot ---------------- */
  $("#chordPt").value = UI.chordPt;
  renderAll();
  if (!STORAGE_OK) setStatus("⚠︎ browser storage unavailable — use Export", true);
  else if (RESTORED) setStatus("✓ Restored from browser");
})(typeof window !== "undefined" ? window : globalThis);
