/* global ClaudeUsageRing */

const CLAUDE_ORIGIN = "https://claude.ai";
const ALARM_NAME = "claude-usage-poll";
const POLL_MINUTES = 5;
const STORAGE_KEY = "claudeUsageState";
const ORG_ID_KEY = "claudeOrgId";

const ICON_SIZES = [16, 32, 48];

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
  return res.json();
}

async function getOrgId({ forceRefresh = false } = {}) {
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
  // several, just take the first one. (Multi-org selection could be added
  // as a popup setting later.)
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
  const state = { lastUpdated: Date.now(), usage: null, error: null };
  try {
    state.usage = await fetchUsage();
  } catch (err) {
    state.error = err.code === "auth" ? "auth" : "network";
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
    await browser.action.setTitle({ title: "Claude usage: unavailable (click for details)" });
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
    title: remaining === null ? "Claude usage" : `Claude usage: ${Math.round(remaining)}% of session remaining`,
  });
}

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
  refresh();
});

browser.runtime.onStartup.addListener(() => {
  browser.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
  refresh();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refresh();
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "refresh") {
    return refresh();
  }
  return undefined;
});
