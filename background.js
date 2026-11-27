/* global ClaudeUsageRing, UsageData */

// Firefox loads vendor/browser-polyfill.js + shared/*.js via manifest
// background.scripts, so `browser`/`ClaudeUsageRing`/`UsageData` already exist
// here. Chrome/Edge only honor background.service_worker (ignoring `scripts`),
// so the service worker has to pull those files in itself.
if (typeof importScripts === "function" && typeof browser === "undefined") {
  importScripts("vendor/browser-polyfill.js", "shared/ring.js", "shared/usage.js");
}

const CLAUDE_ORIGIN = "https://claude.ai";
const OPENCODE_ORIGIN = UsageData.OPENCODE_ORIGIN;
const ALARM_NAME = "usage-poll";
const POLL_MINUTES = 5;
const CLAUDE_STATE_KEY = "claudeUsageState";
const OPENCODE_STATE_KEY = "opencodeUsageState";
const ORG_ID_KEY = "claudeOrgId";
const SETTINGS_KEY = "claudeSettings";
const DEFAULT_SETTINGS = {
  pollMinutes: POLL_MINUTES,
  orgIdOverride: null,
  opencodeApiKey: "",
  // Which provider's 5-hour window drives the toolbar ring/badge:
  // "claude" | "opencode" | "worst" (lowest remaining of the two).
  iconProvider: "claude",
};
const ICON_PROVIDERS = ["claude", "opencode", "worst"];

const ICON_SIZES = [16, 32, 48];

async function getSettings() {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function createAlarm() {
  const settings = await getSettings();
  const periodInMinutes = Number(settings.pollMinutes) > 0 ? Number(settings.pollMinutes) : POLL_MINUTES;
  browser.alarms.create(ALARM_NAME, { periodInMinutes });
}

/**
 * Fetch JSON from claude.ai, relying on the user's existing session cookies
 * (host_permissions grants us cookie-bearing requests to this origin without
 * ever touching the cookies ourselves).
 */
async function claudeFetchJson(path) {
  const res = await fetch(`${CLAUDE_ORIGIN}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("Not authenticated with claude.ai");
    err.code = "auth";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`claude.ai request failed (${res.status})`);
    err.code = "network";
    throw err;
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    // A 200 with a non-JSON body (e.g. an HTML login/interstitial page) means
    // the session cookie isn't authenticating us, even though the status looks fine.
    const err = new Error("Unexpected non-JSON response from claude.ai");
    err.code = "auth";
    throw err;
  }
  return res.json();
}

async function getOrgId({ forceRefresh = false } = {}) {
  const settings = await getSettings();
  if (settings.orgIdOverride) return settings.orgIdOverride;

  if (!forceRefresh) {
    const cached = await browser.storage.local.get(ORG_ID_KEY);
    if (cached[ORG_ID_KEY]) return cached[ORG_ID_KEY];
  }
  const orgs = await claudeFetchJson("/api/organizations");
  if (!Array.isArray(orgs) || orgs.length === 0) {
    const err = new Error("No claude.ai organizations found for this account");
    err.code = "auth";
    throw err;
  }
  // Most personal accounts have exactly one organization; if there are
  // several and the user hasn't picked one in the options page
  // (settings.orgIdOverride, checked above), just take the first one.
  const orgId = orgs[0].uuid || orgs[0].id;
  await browser.storage.local.set({ [ORG_ID_KEY]: orgId });
  return orgId;
}

async function fetchClaudeUsage() {
  let orgId = await getOrgId();
  let usage;
  try {
    usage = await claudeFetchJson(`/api/organizations/${orgId}/usage`);
  } catch (err) {
    if (err.code === "auth") {
      // Org id may be stale (org changed) - retry once with a fresh lookup.
      orgId = await getOrgId({ forceRefresh: true });
      usage = await claudeFetchJson(`/api/organizations/${orgId}/usage`);
    } else {
      throw err;
    }
  }
  return usage;
}

/**
 * OpenCode Go subscription usage. Unlike claude.ai this endpoint is not
 * cookie-authenticated: it wants the Go API key the user copied from
 * https://opencode.ai/auth, sent as a Bearer token. A 401/403 means the key is
 * wrong or the account no longer has a Go plan.
 *
 * Failure kinds matter for the user: a fetch that never leaves the browser
 * (host permission not granted) looks exactly like "no network" unless it is
 * classified, which is what `permission` is for. `detail` carries the HTTP
 * status or the browser's own message so the popup can say more than
 * "couldn't reach opencode.ai".
 */
function hasOpenCodeHostPermission() {
  try {
    const result = browser.permissions.contains({ origins: [`${OPENCODE_ORIGIN}/*`] });
    // Never turn an API quirk into a wrong accusation: unknown means "granted".
    return Promise.resolve(result).catch(() => true);
  } catch (e) {
    return Promise.resolve(true);
  }
}

function usageError(code, message, detail) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail ? String(detail).slice(0, 120) : null;
  return err;
}

async function fetchOpenCodeUsage(apiKey) {
  const paths = UsageData.OPENCODE_USAGE_PATHS || [UsageData.OPENCODE_USAGE_PATH];

  for (const path of paths) {
    let res;
    try {
      res = await fetch(`${OPENCODE_ORIGIN}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      });
    } catch (err) {
      // `fetch` throws only on transport-level failures (offline, DNS, CORS or
      // a missing host permission). Ask the browser which of those it was.
      const granted = await hasOpenCodeHostPermission();
      throw usageError(
        granted ? "network" : "permission",
        granted ? "Could not reach opencode.ai" : "No permission for opencode.ai",
        err && err.message ? err.message : err
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw usageError("auth", "OpenCode Go rejected the API key");
    }
    if (res.status === 404) {
      // Wrong/retired path: try the next alias before calling it a failure.
      continue;
    }
    if (!res.ok) {
      throw usageError("network", `opencode.ai request failed (${res.status})`, `HTTP ${res.status}`);
    }

    const payload = await res.json().catch(() => null);
    if (!payload || UsageData.opencodeWindows(payload).length === 0) {
      // Non-JSON interstitial (Cloudflare, maintenance page) or a plan that
      // reports no windows: nothing usable, and never a fabricated "0% used".
      throw usageError("network", "Unexpected OpenCode Go usage payload", "unexpected payload");
    }
    return payload;
  }

  throw usageError("network", "No OpenCode usage path answered", "HTTP 404");
}

function inBackoff(state) {
  return Boolean(state && state.nextAttemptAt && Date.now() < state.nextAttemptAt);
}

/** Poll one provider into its own state key, with its own failure backoff. */
async function pollProvider(stateKey, fetcher) {
  const previous = (await browser.storage.local.get(stateKey))[stateKey] || {};
  const state = {
    configured: true,
    lastUpdated: Date.now(),
    usage: null,
    error: null,
    errorDetail: null,
    consecutiveFailures: 0,
    nextAttemptAt: 0,
  };
  try {
    state.usage = await fetcher();
  } catch (err) {
    state.error = err.code === "auth" ? "auth" : err.code === "permission" ? "permission" : "network";
    state.errorDetail = typeof err.detail === "string" ? err.detail : null;
    state.consecutiveFailures = (previous.consecutiveFailures || 0) + 1;
    state.nextAttemptAt = Date.now() + ClaudeUsageRing.nextBackoffMs(state.consecutiveFailures);
  }
  await browser.storage.local.set({ [stateKey]: state });
  return state;
}

async function refreshOpenCode(settings) {
  const apiKey = String(settings.opencodeApiKey || "").trim();
  if (!apiKey) {
    // No key configured is not an error and must not feed the backoff: the
    // popup just points at the options page.
    const state = {
      configured: false,
      lastUpdated: null,
      usage: null,
      error: null,
      errorDetail: null,
      consecutiveFailures: 0,
      nextAttemptAt: 0,
    };
    await browser.storage.local.set({ [OPENCODE_STATE_KEY]: state });
    return state;
  }
  return pollProvider(OPENCODE_STATE_KEY, () => fetchOpenCodeUsage(apiKey));
}

/**
 * Poll both providers. `respectBackoff` is what the alarm uses; a manual
 * refresh from the popup always polls regardless.
 */
async function refresh({ respectBackoff = false } = {}) {
  const settings = await getSettings();
  const stored = await browser.storage.local.get([CLAUDE_STATE_KEY, OPENCODE_STATE_KEY]);
  const previous = {
    claude: stored[CLAUDE_STATE_KEY] || null,
    opencode: stored[OPENCODE_STATE_KEY] || null,
  };

  const claudeTask =
    respectBackoff && inBackoff(previous.claude)
      ? Promise.resolve(previous.claude)
      : pollProvider(CLAUDE_STATE_KEY, fetchClaudeUsage);
  const opencodeTask =
    respectBackoff && inBackoff(previous.opencode) ? Promise.resolve(previous.opencode) : refreshOpenCode(settings);

  const [claude, opencode] = await Promise.all([claudeTask, opencodeTask]);
  const states = { claude, opencode };
  await updateToolbarIcon(states, settings);
  return states;
}

function buildRingImageData(size, remaining, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ClaudeUsageRing.drawRing(ctx, size, remaining, color);
  return ctx.getImageData(0, 0, size, size);
}

/** Remaining percent of one provider's 5-hour (rolling) window, or null. */
function providerPercentLeft(id, states) {
  if (id === "claude") {
    const fiveHour = states.claude?.usage?.five_hour;
    return fiveHour ? ClaudeUsageRing.percentRemaining(fiveHour.utilization) : null;
  }
  if (id === "opencode") {
    return states.opencode?.usage ? UsageData.opencodePrimaryPercentLeft(states.opencode.usage) : null;
  }
  return null;
}

/**
 * What the toolbar icon shows: `remaining` (0-100 or null) plus which
 * provider that number came from, so the tooltip can name it.
 */
function iconReading(states, settings) {
  const mode = ICON_PROVIDERS.includes(settings.iconProvider) ? settings.iconProvider : "claude";
  const claudeLeft = providerPercentLeft("claude", states);
  const opencodeLeft = providerPercentLeft("opencode", states);

  if (mode === "opencode") {
    return opencodeLeft !== null
      ? { remaining: opencodeLeft, provider: "opencode" }
      : { remaining: claudeLeft, provider: "claude" };
  }
  if (mode === "worst") {
    const remaining = UsageData.worstRemaining([claudeLeft, opencodeLeft]);
    const provider =
      remaining !== null && claudeLeft !== null && opencodeLeft !== null && opencodeLeft < claudeLeft
        ? "opencode"
        : "claude";
    return { remaining, provider };
  }
  return claudeLeft !== null
    ? { remaining: claudeLeft, provider: "claude" }
    : { remaining: opencodeLeft, provider: "opencode" };
}

async function updateToolbarIcon(states, settings) {
  const { remaining, provider } = iconReading(states, settings);
  const color = ClaudeUsageRing.levelColor(remaining);

  const imageData = {};
  for (const size of ICON_SIZES) {
    imageData[size] = buildRingImageData(size, remaining, color);
  }

  try {
    await browser.action.setIcon({ imageData });
  } catch (e) {
    // OffscreenCanvas/setIcon with imageData can fail on some platforms;
    // fall back silently to the static SVG icon already set in the manifest.
  }

  const chosenState = provider === "opencode" ? states.opencode : states.claude;
  const unavailable =
    Boolean(chosenState?.error) || (remaining === null && Boolean(states.claude?.error || states.opencode?.error));

  if (unavailable) {
    await browser.action.setBadgeText({ text: "!" });
    await browser.action.setBadgeBackgroundColor({ color: "#9aa0a6" });
    await browser.action.setTitle({ title: browser.i18n.getMessage("badgeUnavailableTitle") });
    return;
  }

  await browser.action.setBadgeText({ text: remaining === null ? "" : String(Math.round(remaining)) });
  await browser.action.setBadgeBackgroundColor({ color });
  try {
    await browser.action.setBadgeTextColor({ color: "#ffffff" });
  } catch (e) {
    // Not supported on all Firefox versions - badge is still readable without it.
  }
  await browser.action.setTitle({
    title:
      remaining === null
        ? browser.i18n.getMessage("actionTitle")
        : browser.i18n.getMessage(provider === "opencode" ? "titleOpencodeWithPercent" : "titleClaudeWithPercent", [
            String(Math.round(remaining)),
          ]),
  });
}

browser.runtime.onInstalled.addListener(() => {
  createAlarm();
  refresh();
});

browser.runtime.onStartup.addListener(() => {
  createAlarm();
  refresh();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  const oldValue = changes[SETTINGS_KEY].oldValue || {};
  const newValue = changes[SETTINGS_KEY].newValue || {};
  if (oldValue.pollMinutes !== newValue.pollMinutes) createAlarm();
  if (oldValue.orgIdOverride !== newValue.orgIdOverride) refresh();
  if (oldValue.opencodeApiKey !== newValue.opencodeApiKey) refresh();
  if (oldValue.iconProvider !== newValue.iconProvider) {
    // No re-poll needed: re-render the icon from the states already stored.
    Promise.all([getSettings(), browser.storage.local.get([CLAUDE_STATE_KEY, OPENCODE_STATE_KEY])]).then(
      ([settings, stored]) =>
        updateToolbarIcon(
          { claude: stored[CLAUDE_STATE_KEY] || null, opencode: stored[OPENCODE_STATE_KEY] || null },
          settings
        )
    );
  }
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  // Back off from a persistently-erroring endpoint instead of retrying every
  // POLL_MINUTES forever (per provider); a manual refresh always bypasses this.
  refresh({ respectBackoff: true });
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "refresh") {
    return refresh();
  }
  if (message?.type === "listOrgs") {
    return claudeFetchJson("/api/organizations");
  }
  if (message?.type === "testOpenCodeKey") {
    // Used by the options page's "Check key" button with the typed (not yet
    // saved) key, so a wrong key is caught before it feeds the poll state.
    // The reply carries the failure kind + detail so the page can explain a
    // permission/CORS refusal instead of blaming the key.
    const apiKey = String(message.apiKey || "").trim();
    if (!apiKey) return Promise.resolve({ ok: false, code: "auth", detail: null });
    return fetchOpenCodeUsage(apiKey).then(
      () => ({ ok: true, code: null, detail: null }),
      (err) => ({
        ok: false,
        code: err.code === "auth" ? "auth" : err.code === "permission" ? "permission" : "network",
        detail: typeof err.detail === "string" ? err.detail : null,
      })
    );
  }
  return undefined;
});
