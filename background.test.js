"use strict";

// Runs the real background script inside a `vm` context with a stubbed
// `browser`/`fetch`/`OffscreenCanvas`, so the polling orchestration (both
// providers, per-provider error/backoff state, icon selection) is covered by
// `node --test` without a browser. The two shared scripts are evaluated into
// the same context first, exactly like Firefox's manifest `background.scripts`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = __dirname;
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const CLAUDE_USAGE = {
  five_hour: { utilization: 0.42, resets_at: "2026-11-27T02:10:04.000Z" },
  seven_day: { utilization: 61, resets_at: "2026-11-30T00:00:00.000Z" },
};
const OPENCODE_USAGE = {
  usage: {
    rolling: { status: "ok", percent: 28, resetsAt: "2026-11-27T02:10:04.000Z" },
    weekly: { status: "ok", percent: 11, resetsAt: "2026-11-30T00:00:00.000Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-12-26T20:43:57.000Z" },
  },
};

function jsonResponse(body, { status = 200, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  };
}

/** Boot one isolated copy of the background script. */
function boot({ settings = {}, routes = {}, stored = {}, permissionGranted = true } = {}) {
  const calls = { badge: [], badgeColor: [], title: [], icon: 0, fetches: [] };
  const store = { ...stored };
  if (Object.keys(settings).length) store.claudeSettings = settings;
  const listeners = { storage: [], alarm: [], message: [], installed: [], startup: [] };

  const browser = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in store) out[key] = store[key];
          }
          return out;
        },
        set: async (values) => Object.assign(store, values),
      },
      onChanged: { addListener: (fn) => listeners.storage.push(fn) },
    },
    alarms: {
      create() {},
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    action: {
      setBadgeText: async ({ text }) => calls.badge.push(text),
      setBadgeBackgroundColor: async ({ color }) => calls.badgeColor.push(color),
      setBadgeTextColor: async () => {},
      setTitle: async ({ title }) => calls.title.push(title),
      setIcon: async () => calls.icon++,
    },
    i18n: { getMessage: (key, subs) => `${key}${subs ? ":" + subs.join(",") : ""}` },
    permissions: {
      contains: async () => permissionGranted,
      getAll: async () => ({ origins: ["https://claude.ai/*", "https://opencode.ai/*"], permissions: ["storage", "alarms"] }),
    },
  };

  const fetch = async (url, init = {}) => {
    calls.fetches.push({ url, init });
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler(url, init);
  };

  class OffscreenCanvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      const noop = () => {};
      return {
        clearRect: noop,
        beginPath: noop,
        arc: noop,
        stroke: noop,
        getImageData: () => ({ width: this.width, height: this.height }),
      };
    }
  }

  const context = vm.createContext({
    browser,
    fetch,
    OffscreenCanvas,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    Promise,
    String,
    Boolean,
    Array,
    Object,
    JSON,
  });
  for (const file of ["shared/ring.js", "shared/usage.js", "background.js"]) {
    vm.runInContext(read(file), context, { filename: file });
  }

  return { context, calls, store, listeners };
}

const defaultRoutes = (overrides = {}) => ({
  "https://claude.ai/api/organizations": async () => jsonResponse([{ uuid: "org-1" }]),
  "https://claude.ai/api/organizations/org-1/usage": async () => jsonResponse(CLAUDE_USAGE),
  "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse(OPENCODE_USAGE),
  ...overrides,
});

test("refresh polls both providers and shows Claude's 5h window by default", async () => {
  const { context, calls, store } = boot({
    settings: { opencodeApiKey: "go-key", iconProvider: "claude" },
    routes: defaultRoutes(),
  });

  const states = await context.refresh();

  assert.equal(states.claude.error, null);
  assert.equal(states.claude.usage.five_hour.utilization, 0.42);
  assert.deepEqual(states.opencode.usage, OPENCODE_USAGE);
  assert.equal(states.opencode.configured, true);

  const opencodeCall = calls.fetches.find((f) => f.url === "https://opencode.ai/zen/go/v1/usage");
  assert.equal(opencodeCall.init.headers.authorization, "Bearer go-key");

  // 58% of the Claude session left -> badge 58.
  assert.equal(calls.badge.at(-1), "58");
  assert.equal(calls.title.at(-1), "titleClaudeWithPercent:58");
  assert.ok(store.claudeUsageState.lastUpdated > 0, "state persisted for the popup");
});

test("no OpenCode key means no poll and a populated 'not configured' state", async () => {
  const { context, calls, store } = boot({ settings: {}, routes: defaultRoutes() });

  const states = await context.refresh();

  assert.equal(states.opencode.configured, false);
  assert.equal(states.opencode.error, null);
  assert.equal(store.opencodeUsageState.configured, false);
  assert.ok(
    !calls.fetches.some((f) => f.url.includes("opencode.ai")),
    "must not call the OpenCode endpoint without a key"
  );
  assert.equal(calls.badge.at(-1), "58", "Claude data still drives the badge");
});

test("a rejected OpenCode key errors in its own state without disturbing the Claude icon", async () => {
  const { context, calls } = boot({
    settings: { opencodeApiKey: "bad-key" },
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse({ error: "Unauthorized" }, { status: 401 }),
    }),
  });

  const states = await context.refresh();

  assert.equal(states.opencode.error, "auth");
  assert.equal(states.opencode.usage, null);
  assert.equal(states.opencode.consecutiveFailures, 1);
  assert.ok(states.opencode.nextAttemptAt > Date.now(), "backoff scheduled");
  assert.equal(states.claude.error, null);
  // The icon still shows the provider whose number it displays (Claude), so a
  // broken OpenCode key doesn't hide a perfectly good Claude reading.
  assert.equal(calls.badge.at(-1), "58");
});

test("an HTML interstitial instead of a usage payload is an 'unexpected payload' failure, not a 0% quota", async () => {
  const { context } = boot({
    settings: { opencodeApiKey: "go-key" },
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () =>
        jsonResponse({}, { contentType: "text/html" }),
    }),
  });

  const states = await context.refresh();
  assert.equal(states.opencode.error, "network");
  assert.equal(states.opencode.errorDetail, "unexpected payload");
  assert.equal(states.opencode.usage, null);
});

test("iconProvider 'opencode' and 'worst' pick the matching provider's number", async () => {
  const opencode = boot({
    settings: { opencodeApiKey: "go-key", iconProvider: "opencode" },
    routes: defaultRoutes(),
  });
  await opencode.context.refresh();
  assert.equal(opencode.calls.badge.at(-1), "72");
  assert.equal(opencode.calls.title.at(-1), "titleOpencodeWithPercent:72");

  const worst = boot({
    settings: { opencodeApiKey: "go-key", iconProvider: "worst" },
    routes: defaultRoutes(),
  });
  await worst.context.refresh();
  assert.equal(worst.calls.badge.at(-1), "58", "Claude (58%) is lower than OpenCode (72%)");
  assert.equal(worst.calls.title.at(-1), "titleClaudeWithPercent:58");
});

test("with iconProvider 'opencode', a failing OpenCode key falls back to the Claude number", async () => {
  const { context, calls } = boot({
    settings: { opencodeApiKey: "go-key", iconProvider: "opencode" },
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse({}, { status: 500 }),
    }),
  });

  const states = await context.refresh();
  assert.equal(states.opencode.error, "network");
  assert.equal(states.opencode.consecutiveFailures, 1);
  assert.equal(calls.badge.at(-1), "58");
  assert.equal(calls.title.at(-1), "titleClaudeWithPercent:58");
});

test("the badge shows '!' when the only polled providers all failed", async () => {
  const { context, calls } = boot({
    settings: {},
    routes: defaultRoutes({
      "https://claude.ai/api/organizations": async () => jsonResponse({}, { status: 500 }),
    }),
  });

  const states = await context.refresh();
  assert.equal(states.claude.error, "network");
  assert.equal(calls.badge.at(-1), "!");
  assert.ok(calls.title.at(-1).startsWith("badgeUnavailableTitle"));
});

test("a 404 on the first usage path falls back to the second alias", async () => {
  const { context, calls } = boot({
    settings: { opencodeApiKey: "go-key" },
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse({}, { status: 404 }),
      "https://opencode.ai/inference/go/v1/usage": async () => jsonResponse(OPENCODE_USAGE),
    }),
  });

  const states = await context.refresh();

  assert.equal(states.opencode.error, null);
  assert.deepEqual(states.opencode.usage, OPENCODE_USAGE);
  assert.equal(states.opencode.errorDetail, null);
  assert.deepEqual(
    calls.fetches.filter((f) => f.url.includes("opencode.ai")).map((f) => new URL(f.url).pathname),
    ["/zen/go/v1/usage", "/inference/go/v1/usage"]
  );
});

test("a blocked request (host permission not granted) is reported as 'permission', with the browser's message", async () => {
  const { context, calls } = boot({
    settings: { opencodeApiKey: "go-key" },
    permissionGranted: false,
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    }),
  });

  const states = await context.refresh();

  assert.equal(states.opencode.error, "permission");
  assert.equal(states.opencode.errorDetail, "NetworkError when attempting to fetch resource.");
  assert.equal(calls.badge.at(-1), "58", "the Claude number is still what the icon shows");
});

test("the same thrown fetch with the permission granted stays a network error", async () => {
  const { context } = boot({
    settings: { opencodeApiKey: "go-key" },
    permissionGranted: true,
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
  });

  const states = await context.refresh();
  assert.equal(states.opencode.error, "network");
  assert.equal(states.opencode.errorDetail, "Failed to fetch");
});

test("an unexpected HTTP status keeps its code in the state detail", async () => {
  const { context } = boot({
    settings: { opencodeApiKey: "go-key" },
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse({}, { status: 502 }),
    }),
  });

  const states = await context.refresh();
  assert.equal(states.opencode.error, "network");
  assert.equal(states.opencode.errorDetail, "HTTP 502");
});

test("testOpenCodeKey reports the failure kind and detail back to the options page", async () => {
  const blocked = boot({
    settings: {},
    permissionGranted: false,
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    }),
  });
  const blockedReply = await blocked.listeners.message[0]({ type: "testOpenCodeKey", apiKey: "go-key" });
  assert.equal(blockedReply.ok, false);
  assert.equal(blockedReply.code, "permission");
  assert.match(blockedReply.detail, /NetworkError/);

  const working = boot({ settings: {}, routes: defaultRoutes() });
  const okReply = await working.listeners.message[0]({ type: "testOpenCodeKey", apiKey: "go-key" });
  assert.equal(okReply.ok, true);
  assert.equal(okReply.code, null);
  assert.equal(okReply.detail, null);

  const rejected = boot({
    settings: {},
    routes: defaultRoutes({
      "https://opencode.ai/zen/go/v1/usage": async () => jsonResponse({ error: "Unauthorized" }, { status: 401 }),
    }),
  });
  const authReply = await rejected.listeners.message[0]({ type: "testOpenCodeKey", apiKey: "bad-key" });
  assert.equal(authReply.code, "auth");
});
