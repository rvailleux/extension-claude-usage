/**
 * Shared, DOM-free helpers for the non-Claude provider (OpenCode Go
 * subscription). Same loading contract as shared/ring.js: a classic script
 * that defines one global, loaded by the background (manifest
 * `background.scripts` on Firefox, `importScripts` in the Chrome/Edge
 * service worker) and by the popup via a `<script>` tag — never an ES module.
 * `shared/usage.test.js` requires it directly under plain Node.
 */
(function (global) {
  "use strict";

  const OPENCODE_ORIGIN = "https://opencode.ai";
  // Undocumented public usage endpoint of the OpenCode Go subscription,
  // authenticated with the Go API key (Bearer), not with a browser session.
  // Two paths answer the same payload today (`/zen/...` is what the console
  // uses, `/inference/...` is what the API gateway exposes), so try them in
  // order rather than breaking whenever one of them is renamed.
  // Response shape (verified against the live endpoint):
  //   { usage: { rolling: { status, percent, resetsAt },
  //              weekly:  { status, percent, resetsAt },
  //              monthly: { status, percent, resetsAt } } }
  // `percent` is already a 0-100 percentage of the allowance *used*.
  const OPENCODE_USAGE_PATHS = ["/zen/go/v1/usage", "/inference/go/v1/usage"];
  const OPENCODE_USAGE_PATH = OPENCODE_USAGE_PATHS[0];

  const OPENCODE_WINDOW_ORDER = ["rolling", "weekly", "monthly"];

  function clampPercent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Flatten an OpenCode Go usage payload into an ordered list of windows,
   * used-percent normalized to 0-100 plus the derived remaining percent.
   * Windows missing a numeric `percent` are skipped rather than rendered as
   * a fabricated 0% bar. Returns [] for anything that isn't the expected
   * shape (a login page, an error body, ...).
   */
  function opencodeWindows(payload) {
    const usage = payload && typeof payload === "object" ? payload.usage : null;
    if (!usage || typeof usage !== "object") return [];

    const windows = [];
    for (const id of OPENCODE_WINDOW_ORDER) {
      const raw = usage[id];
      if (!raw || typeof raw !== "object") continue;
      const percentUsed = clampPercent(raw.percent);
      if (percentUsed === null) continue;
      windows.push({
        id,
        percentUsed,
        percentLeft: 100 - percentUsed,
        resetsAt: typeof raw.resetsAt === "string" ? raw.resetsAt : null,
        status: typeof raw.status === "string" ? raw.status : "ok",
      });
    }
    return windows;
  }

  /** The 5-hour (rolling) window's remaining percent, or null. */
  function opencodePrimaryPercentLeft(payload) {
    const rolling = opencodeWindows(payload).find((w) => w.id === "rolling");
    return rolling ? rolling.percentLeft : null;
  }

  /**
   * Lowest remaining percent among the given values, ignoring null/NaN —
   * what the toolbar icon shows when the user asks for "worst of both".
   */
  function worstRemaining(values) {
    let worst = null;
    for (const value of values || []) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      worst = worst === null ? value : Math.min(worst, value);
    }
    return worst;
  }

  global.UsageData = {
    OPENCODE_ORIGIN,
    OPENCODE_USAGE_PATH,
    OPENCODE_USAGE_PATHS,
    OPENCODE_WINDOW_ORDER,
    opencodeWindows,
    opencodePrimaryPercentLeft,
    worstRemaining,
  };
})(typeof self !== "undefined" ? self : this);
