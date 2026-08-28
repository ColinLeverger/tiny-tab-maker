/* GitHub Contents API sync for a static, local-first app. */
(function (root) {
  "use strict";
  var KEY = "ttm_github_sync_v1";

  function readConfig() {
    try { return JSON.parse(root.localStorage.getItem(KEY) || "null"); } catch (_) { return null; }
  }
  function writeConfig(config) {
    if (config) root.localStorage.setItem(KEY, JSON.stringify(config));
    else root.localStorage.removeItem(KEY);
  }
  function validate(config) {
    if (!config || !/^[\w.-]+\/[\w.-]+$/.test(config.repo || "")) throw new Error("Use owner/repository for the repository name.");
    if (!(config.token || "").trim()) throw new Error("A fine-grained GitHub token is required.");
    if (!(config.branch || "").trim()) throw new Error("A branch is required.");
    if (!(config.path || "").trim() || /(^|\/)\.\.?($|\/)/.test(config.path)) throw new Error("Choose a safe file path.");
  }
  function encode(text) {
    var bytes = new TextEncoder().encode(text), binary = "";
    for (var i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(binary);
  }
  function decode(text) {
    var binary = atob(text.replace(/\s/g, "")), bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function apiUrl(config, path) {
    var parts = (path || config.path).split("/").map(encodeURIComponent).join("/");
    return "https://api.github.com/repos/" + config.repo + "/contents/" + parts;
  }
  function authHeaders(config) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + config.token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }
  function transferCode(config) {
    var shared = {
      repo: (config.repo || "").trim(), branch: (config.branch || "main").trim(),
      token: (config.token || "").trim(), path: "songbook.json"
    };
    validate(shared); delete shared.path;
    return encode(JSON.stringify(shared)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function readTransferCode(code) {
    code = (code || "").replace(/-/g, "+").replace(/_/g, "/");
    while (code.length % 4) code += "=";
    var shared = JSON.parse(decode(code));
    validate(Object.assign({}, shared, { path: "songbook.json" }));
    return { repo: shared.repo.trim(), branch: shared.branch.trim(), token: shared.token.trim() };
  }

  function create(options) {
    var config = readConfig(), timer, busy = false, started = false, applying = false;
    var lastSeen = JSON.stringify(options.getState());
    function status(kind, text) { if (options.onStatus) options.onStatus(kind, text); }
    function save() { if (config) writeConfig(config); }
    async function request(method, body, path, keepalive) {
      var url = apiUrl(config, path) + (method === "GET" ? "?ref=" + encodeURIComponent(config.branch) : "");
      var response = await root.fetch(url, {
        method: method,
        headers: Object.assign(authHeaders(config), body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store", keepalive: !!keepalive
      });
      if (response.status === 404) return null;
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.message || "GitHub returned " + response.status);
        error.status = response.status;
        throw error;
      }
      return data;
    }
    async function remote() {
      var file = await request("GET");
      if (!file) return null;
      var state = JSON.parse(decode(file.content));
      if (!state || !Array.isArray(state.songs)) throw new Error("The GitHub file is not a Tiny Tab Maker songbook.");
      return { sha: file.sha, state: state };
    }
    async function put(raw, sha, keepalive) {
      if (raw.length > 900000) throw new Error("Songbook is too large for GitHub file sync.");
      var body = { message: "Sync Tiny Tab Maker", content: encode(raw), branch: config.branch };
      if (sha) body.sha = sha;
      var result = await request("PUT", body, null, keepalive && JSON.stringify(body).length < 60000);
      return result.content.sha;
    }
    function fail(error) {
      var conflict = error && (error.status === 409 || error.status === 422);
      status(conflict ? "conflict" : "error", conflict ? "Both copies changed — choose which copy to use in Songbooks & sync" : error.message);
      throw error;
    }
    async function pull(force, createMissing) {
      if (!config || busy) return;
      if (!config.path) { status("idle", "GitHub connected — choose a songbook"); return; }
      busy = true; status("syncing", "Checking GitHub…");
      try {
        var cloud = await remote();
        if (!cloud) {
          if (createMissing) {
            var initial = JSON.stringify(options.getState());
            config.sha = await put(initial, null); config.dirty = false; lastSeen = initial; save();
            status("ok", "Created GitHub sync file"); return;
          }
          status("error", "Sync file does not exist yet"); return;
        }
        if (cloud.sha === config.sha) { config.dirty = false; save(); status("ok", "Up to date"); return; }
        if (config.dirty && !force) { status("conflict", "Cloud changed while this device has edits"); return; }
        applying = true;
        options.applyState(cloud.state);
        applying = false;
        lastSeen = JSON.stringify(options.getState());
        config.sha = cloud.sha; config.dirty = false; save();
        status("ok", "Pulled from GitHub");
      } catch (error) { applying = false; return fail(error); }
      finally { busy = false; }
    }
    async function push(force, keepalive) {
      if (!config || busy) return;
      if (!config.path) { status("idle", "GitHub connected — choose a songbook"); return; }
      clearTimeout(timer); busy = true; status("syncing", "Saving to GitHub…");
      try {
        var sha = config.sha;
        if (force) { var cloud = await remote(); sha = cloud && cloud.sha; }
        var raw = JSON.stringify(options.getState());
        config.sha = await put(raw, sha, keepalive);
        lastSeen = JSON.stringify(options.getState());
        config.dirty = lastSeen !== raw;
        save(); status("ok", "Saved to GitHub");
        if (config.dirty) schedule();
      } catch (error) { return fail(error); }
      finally { busy = false; }
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(function () { push(false).catch(function () {}); }, 30000);
    }
    function changed() {
      if (!started || applying || !config || !config.path) return;
      var current = JSON.stringify(options.getState());
      if (current === lastSeen) return;
      lastSeen = current;
      config.dirty = true; save(); schedule(); status("dirty", "Waiting to sync");
    }
    function syncNow() {
      if (!config) return Promise.resolve("unconfigured");
      if (!config.path) { status("idle", "GitHub connected — choose a songbook"); return Promise.resolve("unselected"); }
      return config.dirty ? push(false) : pull(false, false);
    }
    async function listFiles(settings) {
      var target = {
        repo: (settings.repo || "").trim(), branch: (settings.branch || "main").trim(),
        token: (settings.token || "").trim(), path: "songbooks/list.json"
      };
      validate(target);
      var response = await root.fetch("https://api.github.com/repos/" + target.repo + "/git/trees/" +
        encodeURIComponent(target.branch) + "?recursive=1", { headers: authHeaders(target), cache: "no-store" });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.message || "Could not list GitHub songbooks");
      return (data.tree || []).filter(function (item) {
        return item.type === "blob" && /\.json$/i.test(item.path);
      }).map(function (item) { return item.path; }).sort();
    }
    async function rename(newPath) {
      if (!config) throw new Error("Configure GitHub sync first.");
      newPath = (newPath || "").trim();
      validate(Object.assign({}, config, { path: newPath }));
      if (newPath === config.path) return;
      if (busy) throw new Error("Wait for the current GitHub sync to finish, then rename again.");
      if (config.dirty) await push(false);
      busy = true; status("syncing", "Renaming GitHub songbook…");
      try {
        var oldPath = config.path, oldFile = await request("GET");
        if (!oldFile) throw new Error("The current GitHub songbook no longer exists.");
        if (await request("GET", null, newPath)) throw new Error("A GitHub songbook already exists at " + newPath + ".");
        var created = await request("PUT", {
          message: "Rename Tiny Tab Maker songbook", content: oldFile.content, branch: config.branch
        }, newPath);
        await request("DELETE", {
          message: "Remove renamed Tiny Tab Maker songbook", sha: oldFile.sha, branch: config.branch
        }, oldPath);
        config.path = newPath; config.sha = created.content.sha; save();
        status(config.dirty ? "dirty" : "ok", config.dirty ? "Renamed — waiting to sync edits" : "GitHub songbook renamed");
        if (config.dirty) schedule();
      } catch (error) { return fail(error); }
      finally { busy = false; }
    }
    async function remove() {
      if (!config || !config.path) throw new Error("Connect a GitHub songbook first.");
      if (busy) throw new Error("Wait for the current GitHub sync to finish, then delete again.");
      busy = true; clearTimeout(timer); status("syncing", "Deleting GitHub songbook…");
      try {
        var path = config.path, file = await request("GET");
        if (!file) throw new Error("The connected GitHub songbook no longer exists.");
        await request("DELETE", {
          message: "Delete Tiny Tab Maker songbook", sha: file.sha, branch: config.branch
        });
        config.path = ""; config.sha = null; config.dirty = false;
        lastSeen = JSON.stringify(options.getState()); save();
        status("idle", 'Deleted "' + path + '" — GitHub stays connected; choose another songbook');
        return path;
      } catch (error) { return fail(error); }
      finally { busy = false; }
    }
    function configure(next) {
      next = {
        repo: (next.repo || "").trim(), branch: (next.branch || "main").trim(),
        path: (next.path || "songbook.json").trim(), token: (next.token || "").trim()
      };
      validate(next);
      var same = config && config.repo === next.repo && config.branch === next.branch && config.path === next.path;
      config = Object.assign(next, { sha: same ? config.sha : null, dirty: same ? !!config.dirty : true });
      save(); status("dirty", "Connected — choose which copy to use first");
    }
    function disconnect() { clearTimeout(timer); config = null; writeConfig(null); status("off", "Sync off"); }
    function start() {
      started = true;
      function flush() { if (config && config.path && config.dirty) return push(false, true).catch(function () {}); }
      root.addEventListener("online", function () { syncNow().catch(function () {}); });
      root.addEventListener("focus", function () { if (config && config.path && !config.dirty) pull(false, false).catch(function () {}); });
      root.addEventListener("pagehide", flush);
      if (root.document) root.document.addEventListener("visibilitychange", function () {
        if (root.document.hidden) return flush();
      });
      if (!config) { status("off", "Sync off"); return; }
      if (!config.path) { status("idle", "GitHub connected — choose a songbook"); return; }
      status(config.dirty ? "dirty" : "ok", config.dirty ? "Waiting to sync" : "Sync ready");
      setTimeout(function () { syncNow().catch(function () {}); }, 800);
    }
    return {
      config: function () { return config ? Object.assign({}, config) : null; },
      configured: function () { return !!config; }, configure: configure, disconnect: disconnect,
      changed: changed, syncNow: syncNow, pull: pull, push: push, listFiles: listFiles,
      rename: rename, remove: remove, start: start
    };
  }

  root.TTMGitHubSync = {
    create: create, encode: encode, decode: decode, validate: validate,
    transferCode: transferCode, readTransferCode: readTransferCode
  };
})(typeof window !== "undefined" ? window : globalThis);
