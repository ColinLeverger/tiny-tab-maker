// The sync sheet is pure markup wired by id from js/app.js. A renamed or dropped
// element fails at runtime, not at parse time, so assert the contract statically.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");

// Every id the sync code addresses must exist exactly once in the markup.
const required = [
  "syncModal", "syncClose", "syncDone", "syncState", "syncSummary", "syncRetry",
  "syncConflict", "syncPull", "syncPush",
  "syncRemote", "syncRefresh", "syncLoad", "syncNew", "syncRename", "syncDelete",
  "syncScan", "syncConn", "syncQrBox", "syncQr",
  "syncRepo", "syncBranch", "syncPath", "syncToken", "syncDisconnect",
  "desktopSyncBadge"
];
for (const id of required) {
  const hits = html.split(`id="${id}"`).length - 1;
  assert.strictEqual(hits, 1, `index.html must define #${id} exactly once (found ${hits})`);
}

// The destructive conflict controls stay hidden until the sheet is in a conflict state.
assert.ok(/\.sync-conflict\{[^}]*display:none/.test(css), ".sync-conflict must default to display:none");
assert.ok(/\.sync-sheet\.has-conflict \.sync-conflict\{display:block\}/.test(css),
  ".has-conflict on the sheet must reveal .sync-conflict");
assert.ok(/sheet\.classList\.toggle\("has-conflict", bad\)/.test(app),
  "syncStatus must toggle has-conflict for conflict/error states");

// The state pill must not be overwritten by the songbook listing count any more.
assert.ok(!/#syncState"\)\.textContent = files\.length/.test(app),
  "refreshSyncFiles must not clobber the sync state pill");

// The top-bar badge distinguishes pushed / not-pushed / broken.
for (const label of ["✓ On GitHub", "⬆ Not pushed", "⚠ Conflict"]) {
  assert.ok(app.includes(label), `syncStatus needs the "${label}" badge label`);
}
assert.ok(/\.app-version\.pending\{/.test(css), "the badge needs a pending (amber) style");

console.log("sync-modal-dom: ok");
