const assert = require("assert");

global.localStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; }
};
global.addEventListener = function () {};
require("../js/github-sync.js");

(async function () {
  const unicode = "Couplet: F♯ → B♭";
  assert.strictEqual(TTMGitHubSync.decode(TTMGitHubSync.encode(unicode)), unicode);
  assert.throws(() => TTMGitHubSync.validate({ repo: "bad", branch: "main", path: "songbook.json", token: "x" }));

  let state = { meta: {}, songs: [] }, applied;
  global.fetch = async function (_url, options) {
    assert.strictEqual(options.headers.Authorization, "Bearer token");
    return { status: 200, ok: true, json: async () => ({ sha: "cloud-sha", content: TTMGitHubSync.encode(JSON.stringify(state)) }) };
  };
  const sync = TTMGitHubSync.create({ getState: () => state, applyState: value => { applied = value; } });
  sync.configure({ repo: "owner/private-data", branch: "main", path: "songbook.json", token: "token" });
  await sync.pull(true, false);
  assert.deepStrictEqual(applied, state);
  assert.strictEqual(sync.config().sha, "cloud-sha");
  global.fetch = async function (url) {
    assert.match(url, /\/git\/trees\/main\?recursive=1$/);
    return { status: 200, ok: true, json: async () => ({ tree: [
      { type: "blob", path: "songbook.json" },
      { type: "blob", path: "songbooks/gig-book.json" },
      { type: "blob", path: "README.md" }
    ] }) };
  };
  assert.deepStrictEqual(await sync.listFiles({ repo: "owner/private-data", branch: "main", token: "token" }),
    ["songbook.json", "songbooks/gig-book.json"]);
  console.log("github-sync: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
