/* global ClaudeUsageRing */

// Firefox loads vendor/browser-polyfill.js + shared/ring.js via manifest
// background.scripts, so `browser`/`ClaudeUsageRing` already exist here.
// Chrome/Edge only honor background.service_worker (ignoring `scripts`), so
// the service worker has to pull those two files in itself.
if (typeof importScripts === "function" && typeof browser === "undefined") {
  importScripts("vendor/browser-polyfill.js", "shared/ring.js");
}

const CLAUDE_ORIGIN = "https://claude.ai";
const ALARM_NAME = "claude-usage-poll";
const POLL_MINUTES = 5;
const STORAGE_KEY = "claudeUsageState";
const ORG_ID_KEY = "claudeOrgId";
const SETTINGS_KEY = "claudeSettings";
const DEFAULT_SETTINGS = { pollMinutes: POLL_MINUTES, orgIdOverride: null };

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

async function fetchUsage() {
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

async function refresh() {
  const previous = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const state = {
    lastUpdated: Date.now(),
    usage: null,
    error: null,
    consecutiveFailures: 0,
    nextAttemptAt: 0,
  };
  try {
    state.usage = await fetchUsage();
  } catch (err) {
    state.error = err.code === "auth" ? "auth" : "network";
    state.consecutiveFailures = (previous.consecutiveFailures || 0) + 1;
    state.nextAttemptAt = Date.now() + ClaudeUsageRing.nextBackoffMs(state.consecutiveFailures);
  }
  await browser.storage.local.set({ [STORAGE_KEY]: state });
  await updateToolbarIcon(state);
  return state;
}

function buildRingImageData(size, remaining, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ClaudeUsageRing.drawRing(ctx, size, remaining, color);
  return ctx.getImageData(0, 0, size, size);
}

async function updateToolbarIcon(state) {
  const remaining = state.usage?.five_hour
    ? ClaudeUsageRing.percentRemaining(state.usage.five_hour.utilization)
    : null;
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

  if (state.error) {
    await browser.action.setBadgeText({ text: "!" });
    await browser.action.setBadgeBackgroundColor({ color: "#9aa0a6" });
    await browser.action.setTitle({ title: browser.i18n.getMessage("badgeUnavailableTitle") });
    return;
  }

  const badgeText = remaining === null ? "" : String(Math.round(remaining));
  await browser.action.setBadgeText({ text: badgeText });
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
        : browser.i18n.getMessage("titleWithPercent", [String(Math.round(remaining))]),
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
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  // Back off from a persistently-erroring endpoint instead of retrying every
  // POLL_MINUTES forever; a manual refresh (below) always bypasses this.
  if (stored?.nextAttemptAt && Date.now() < stored.nextAttemptAt) return;
  refresh();
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "refresh") {
    return refresh();
  }
  if (message?.type === "listOrgs") {
    return claudeFetchJson("/api/organizations");
  }
  return undefined;
});
