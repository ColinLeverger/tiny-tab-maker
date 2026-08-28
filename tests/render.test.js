"use strict";

const assert = require("assert");
global.FG = require("../js/data.js");
require("../js/render.js");

const state = FG.emptyState();
state.songs.push(Object.assign(FG.emptySong("01"), { title: "Test", meter: "4/4", feel: "Swing" }));

assert.match(FG.renderPreview(state), /4\/4 · Swing/);
console.log("render tests passed");
