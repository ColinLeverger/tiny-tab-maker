const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

test("one update request waits for activation and reloads", async () => {
  const html = fs.readFileSync("index.html", "utf8");
  const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].pop()[1];
  const badge = {
    dataset: { build: "old" }, textContent: "", title: "",
    classList: { add() {}, toggle() {} }
  };
  const registration = { active: { scriptURL: "https://example.test/sw.js?v=old" } };
  let reloads = 0;
  const context = {
    URL, Date, Promise, setTimeout,
    document: { getElementById() { return badge; } },
    fetch() {
      return Promise.resolve({
        ok: true,
        json() { return Promise.resolve({ sha: "new", deployedAt: "2026-01-01T00:00:00Z" }); }
      });
    },
    navigator: { serviceWorker: {
      getRegistration() { return Promise.resolve(registration); },
      register() { return Promise.resolve(registration); }
    } },
    sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} },
    window: {
      location: { reload() { reloads++; } },
      setMobileUpdateState() {}
    }
  };

  vm.runInNewContext(script, context);
  setTimeout(() => { registration.active.scriptURL = "https://example.test/sw.js?v=new"; }, 20);

  assert.equal(await context.window.TTMUpdate(), "reloading");
  assert.equal(reloads, 1);
});
