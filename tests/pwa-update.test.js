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

test("service worker installs a fresh shell under canonical URLs", async () => {
  const script = fs.readFileSync("sw.js", "utf8");
  const handlers = {}, fetched = [], cached = [];
  const context = {
    URL, Promise, encodeURIComponent,
    self: {
      addEventListener(type, fn) { handlers[type] = fn; },
      skipWaiting() { return Promise.resolve(); },
      clients: { claim() { return Promise.resolve(); } }
    },
    fetch(url, options) {
      fetched.push([url, options]);
      return Promise.resolve({ ok: true });
    },
    caches: {
      open() { return Promise.resolve({ put(url) { cached.push(url); return Promise.resolve(); } }); },
      keys() { return Promise.resolve([]); },
      match() { return Promise.resolve(); },
      delete() { return Promise.resolve(); }
    }
  };
  vm.runInNewContext(script, context);
  let installed;
  handlers.install({ waitUntil(promise) { installed = promise; } });
  await installed;

  assert.ok(fetched.length > 0);
  assert.ok(fetched.every(([url, options]) => url.includes("?v=ttm-dev-emoji-pdf") && options.cache === "no-store"));
  assert.deepEqual(cached, ["./", "index.html", "tap.html", "css/styles.css", "js/data.js", "js/demo-data.js", "js/render.js", "js/pdf.js", "js/github-sync.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]);
});
