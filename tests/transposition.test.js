"use strict";

const assert = require("assert");
const FG = require("../js/data.js");

assert.strictEqual(FG.transposeChord("Bbmaj7", 2, false), "Cmaj7");
assert.strictEqual(FG.transposeChord("D/F#", 2, true), "E/G#");
assert.strictEqual(FG.transposeKey("Em", 2), "F#m");
assert.strictEqual(FG.keyPrefersSharps("F#m"), true);
assert.strictEqual(
  FG.transposeChordText("follows the verse (Em G D C), play softly", 2, true),
  "follows the verse (F#m A E D), play softly"
);
assert.strictEqual(FG.transposeChordText("Am (funk, palm mute)", 1, false), "Bbm (funk, palm mute)");
assert.strictEqual(FG.transposeChordText("G — grid below", 1, false), "Ab — grid below");
assert.strictEqual(FG.transposeChordText("Power chords G D C G", 1, false), "Power chords Ab Eb Db Ab");
assert.strictEqual(FG.transposeChordText("C / G", 1, false), "Db / Ab");
assert.strictEqual(FG.transposeChordText("Play A bit softer", 1, false), "Play A bit softer");
assert.strictEqual(FG.transposeChordText("Key of C, softly", 1, false), "Key of C, softly");

console.log("transposition tests passed");
