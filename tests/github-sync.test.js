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
  const transfer = { repo: "owner/private-data", branch: "main", token: "github_pat_secret" };
  assert.deepStrictEqual(TTMGitHubSync.readTransferCode(TTMGitHubSync.transferCode(transfer)), transfer);
  assert.throws(() => TTMGitHubSync.readTransferCode("not-a-code"));

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

  const calls = [];
  global.fetch = async function (url, options) {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (options.method === "GET" && url.includes("songbooks%2Frenamed")) throw new Error("path should use slash-separated URL segments");
    if (options.method === "GET" && url.includes("/songbooks/renamed.json")) return { status: 404, ok: false };
    if (options.method === "GET") return { status: 200, ok: true, json: async () => ({ sha: "old-sha", content: TTMGitHubSync.encode(JSON.stringify(state)) }) };
    if (options.method === "PUT") return { status: 200, ok: true, json: async () => ({ content: { sha: "new-sha" } }) };
    return { status: 200, ok: true, json: async () => ({}) };
  };
  await sync.rename("songbooks/renamed.json");
  assert.deepStrictEqual(calls.map(call => call.method), ["GET", "GET", "PUT", "DELETE"]);
  assert.match(calls[2].url, /\/contents\/songbooks\/renamed\.json$/);
  assert.match(calls[3].url, /\/contents\/songbook\.json$/);
  assert.strictEqual(calls[3].body.sha, "old-sha");
  assert.strictEqual(sync.config().path, "songbooks/renamed.json");
  assert.strictEqual(sync.config().sha, "new-sha");

  const existingCalls = [];
  global.fetch = async function (url, options) {
    existingCalls.push(options.method);
    return { status: 200, ok: true, json: async () => ({ sha: "existing-sha", content: TTMGitHubSync.encode(JSON.stringify(state)) }) };
  };
  await assert.rejects(sync.rename("songbooks/existing.json"), /already exists/);
  assert.deepStrictEqual(existingCalls, ["GET", "GET"]);

  const deleteCalls = [];
  global.fetch = async function (_url, options) {
    deleteCalls.push({ method: options.method, body: options.body && JSON.parse(options.body) });
    if (options.method === "GET") return { status: 200, ok: true, json: async () => ({ sha: "delete-sha" }) };
    return { status: 200, ok: true, json: async () => ({}) };
  };
  await sync.remove();
  assert.deepStrictEqual(deleteCalls.map(call => call.method), ["GET", "DELETE"]);
  assert.strictEqual(deleteCalls[1].body.sha, "delete-sha");
  assert.strictEqual(sync.configured(), false);
  await assert.rejects(sync.remove(), /Connect a GitHub songbook first/);
  console.log("github-sync: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
