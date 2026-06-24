/* =====================================================================
 * demo-data.js — 100% FICTIONAL sample data, safe to commit publicly.
 * Invented band, invented songs, invented chords, invented tabs.
 * Nothing here relates to any real setlist. Load your real data locally
 * (Import JSON / it lives in your browser's localStorage) — never commit it.
 * ===================================================================== */
(function (root) {
  "use strict";

  var DEMO = {
    meta: {
      band: "The Atomic Nanny-Goats",
      subtitle: "Guitar prep — play sheets (DEMO)",
      notation: "Notation: chords EN / flats only — 100% fictional data",
      updated: "2026-06-24"
    },
    songs: [
      {
        num: "01", title: "Cosmic Wake-Up", group: "Demo Vol. 1",
        key: "Em", tempo: "~120 BPM", meter: "4/4", feel: "",
        structure: "Intro (riff) → Verse → Chorus → Solo → Ending",
        chords: [
          { label: "Intro",   value: "Em" },
          { label: "Verse",   value: "Em G D C" },
          { label: "Chorus",  value: "C G D Em" },
          { label: "Solo",    value: "follows the verse (Em G D C)" },
          { label: "Ending",  value: "Em G Em" }
        ],
        riffs: [
          { label: "Riff", note: "intro motif, ×2",
            tab: [["E",0],["E",3],["E",5],["bar"],["A",0],["A",3],["A",5],["bar"],
                  ["E",0],["E",3],["E",5],["E",3],["bar"],["E",0]] }
        ],
        breaks: "N/A", notes: "Light delay on the intro (fictional)"
      },
      {
        num: "02", title: "Sweet Potato", group: "Demo Vol. 1",
        key: "Am", tempo: "~95 BPM", meter: "4/4", feel: "funk",
        structure: "Intro → Verse → Chorus → Break → Chorus → Outro",
        chords: [
          { label: "Intro",   value: "Am (funk, palm mute)" },
          { label: "Verse",   value: "Am Dm Am Dm" },
          { label: "Chorus",  value: "F G Am" },
          { label: "Break",   value: "funk riff — grid below" },
          { label: "Outro",   value: "Am F G Am" }
        ],
        riffs: [
          { label: "Funk riff", note: "×4 — the final (5) is muted on the last pass",
            tab: [["repopen"],
                  ["D",5],["D",7],["D",5],["G",5],["bar"],
                  ["D",5],["D",7],["D",5],["G",5],["bar"],
                  ["D",5],["D",7],["D",5],["G",7],["G",7],["G","(5)"],
                  ["repclose",4]] }
        ],
        breaks: "Funk break (riff)", notes: "Off-beat on the verse (fictional)"
      },
      {
        num: "03", title: "Morning Fog", group: "Demo Vol. 1",
        key: "Dm", tempo: "~80 BPM", meter: "6/8", feel: "",
        structure: "Intro (no guitar) → Verse → Bridge → Chorus → End",
        chords: [
          { label: "Intro",   value: "No guitar" },
          { label: "Verse",   value: "Dm Bb F C" },
          { label: "Bridge",  value: "Gm A Dm" },
          { label: "Chorus",  value: "Bb F C Dm" },
          { label: "End",     value: "Dm" }
        ],
        // a riff with no tab yet -> renders a blank 6×8 grid to fill by hand
        riffs: [ { label: "Riff", note: "", tab: null } ],
        breaks: "N/A", notes: "Guitar comes in on the verse only (fictional)"
      },
      {
        num: "04", title: "Soft Thunder", group: "Live Sessions",
        key: "G", tempo: "~140 BPM", meter: "4/4", feel: "",
        structure: "Intro riff → Verse → Chorus → Solo → Brass break → Ending",
        chords: [
          { label: "Intro riff", value: "G — grid below" },
          { label: "Verse",      value: "G D Em C" },
          { label: "Chorus",     value: "C D G" },
          { label: "Solo",       value: "G D Em C (long)" },
          { label: "Brass break", value: "brass only — no guitar" },
          { label: "Ending",     value: "Power chords G D C G" }
        ],
        riffs: [
          { label: "Intro riff", note: "the ‖: :‖ section ×2 ; the whole thing ×2",
            tab: [["G",12],["G",10],["D",12],["bar"],
                  ["repopen"],
                  ["A",10],["A",10],["A",12],["A",12],
                  ["repclose",2],["bar"],
                  ["D",9],["D",12]] }
        ],
        breaks: "Brass break (↓tempo)", notes: "—"
      },
      {
        num: "05", title: "Royal Nap", group: "Live Sessions",
        key: "Cm", tempo: "~70 BPM", meter: "4/4", feel: "reggae",
        structure: "Intro → Verse → Chorus → Final reggae section",
        chords: [
          { label: "Intro",   value: "Cm" },
          { label: "Verse",   value: "Cm Ab Bb" },
          { label: "Chorus",  value: "Ab Bb Cm" },
          { label: "Final reggae section", value: "Cm Gm" }
        ],
        riffs: [
          { label: "Guitar riff", note: "reggae off-beat",
            tab: [["repopen"],
                  ["A",3],["A",3],["A",5],["A",3],["bar"],
                  ["A",6],["A",6],["A",5],["A",3],
                  ["repclose"]] }
        ],
        breaks: "N/A", notes: "Muted / off-beat (fictional)"
      }
    ]
  };

  if (typeof module !== "undefined" && module.exports) module.exports = DEMO;
  root.FG = root.FG || {};
  root.FG.DEMO = DEMO;
})(typeof window !== "undefined" ? window : globalThis);
