const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const app = fs.readFileSync("js/app.js", "utf8");
const css = fs.readFileSync("css/styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("night view and hidden tabs are independent, persisted View preferences", () => {
  assert.match(html, /id="stageGig"/);
  assert.match(html, /id="stageTabs"/);
  assert.match(app, /UI\.hideTabs = !UI\.hideTabs; persistUI\(\); applyStagePrefs\(\)/);
  assert.match(app, /classList\.toggle\("on", !UI\.hideTabs\)/);
  assert.match(app, /gig: UI\.gig, hideTabs: UI\.hideTabs/);
  assert.match(css, /body\.stage\.hide-tabs pre\.tab\{display:none\}/);
  assert.doesNotMatch(css, /body\.stage\.gig[^}]*pre\.tab/);
  assert.doesNotMatch(css, /body\.stage\.gig[^}]*font-size/);
});
