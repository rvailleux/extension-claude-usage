/**
 * Shared, DOM-free helpers used by both the background script (drawing the
 * toolbar icon on an OffscreenCanvas) and the popup (drawing an SVG ring).
 * Loaded as a plain classic script in both contexts, so it hangs everything
 * off a global `ClaudeUsageRing` object rather than using ES modules.
 */
(function (global) {
  "use strict";

  /**
   * Claude's `usage` API reports each bucket as either a 0-1 fraction or a
   * 0-100 percentage depending on endpoint version. Normalize to 0-100.
   */
  function normalizeUtilizationToPercentUsed(utilization) {
    if (typeof utilization !== "number" || Number.isNaN(utilization)) {
      return null;
    }
    const pct = utilization <= 1 ? utilization * 100 : utilization;
    return Math.max(0, Math.min(100, pct));
  }

  /** Percent of the quota still remaining (0-100), clamped. */
  function percentRemaining(utilization) {
    const used = normalizeUtilizationToPercentUsed(utilization);
    if (used === null) return null;
    return Math.max(0, Math.min(100, 100 - used));
  }

  /** Color for a given "remaining" percentage: green -> amber -> red. */
  function levelColor(remaining) {
    if (remaining === null || remaining === undefined) return "#9aa0a6"; // gray/unknown
    if (remaining <= 10) return "#e5484d"; // red
    if (remaining <= 30) return "#f5a623"; // amber
    return "#2fb344"; // green
  }

  /**
   * Human countdown like "2h 14m" / "5d 3h" / "<1m" until an ISO timestamp.
   * Units are plain strings rather than i18n message keys: this file has to
   * stay dependency-free (loaded via classic <script>/importScripts in three
   * contexts, and required directly under plain Node for ring.test.js), and
   * `browser.i18n` isn't available in that last one.
   */
  function formatCountdown(resetsAtIso) {
    if (!resetsAtIso) return null;
    const resetMs = new Date(resetsAtIso).getTime();
    if (Number.isNaN(resetMs)) return null;
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0) return "resetting…";

    const minutes = Math.floor(diffMs / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m`;
    return "<1m";
  }

  const BACKOFF_BASE_MS = 5 * 60 * 1000;
  const BACKOFF_CAP_MS = 60 * 60 * 1000;

  /**
   * Delay (ms) before the next poll should be attempted after N consecutive
   * failures: 0 after success, then 5m/10m/20m/40m, capped at 60m. Keeps a
   * persistently-erroring endpoint from being hit every POLL_MINUTES forever.
   */
  function nextBackoffMs(consecutiveFailures) {
    if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0;
    const ms = BACKOFF_BASE_MS * Math.pow(2, consecutiveFailures - 1);
    return Math.min(BACKOFF_CAP_MS, ms);
  }

  /** Draw a rounded-cap progress ring into a 2D canvas context. */
  function drawRing(ctx, size, remaining, color) {
    const center = size / 2;
    const lineWidth = Math.max(2, Math.round(size * 0.18));
    const radius = center - lineWidth / 2 - 1;

    ctx.clearRect(0, 0, size, size);

    // Track
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(127,127,127,0.35)";
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    if (remaining === null || remaining === undefined) return;

    // Progress arc, starting at 12 o'clock, clockwise.
    const fraction = Math.max(0, Math.min(1, remaining / 100));
    if (fraction <= 0) return;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + fraction * Math.PI * 2;

    ctx.beginPath();
    ctx.arc(center, center, radius, startAngle, endAngle);
    ctx.strokeStyle = color || levelColor(remaining);
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  global.ClaudeUsageRing = {
    normalizeUtilizationToPercentUsed,
    percentRemaining,
    levelColor,
    formatCountdown,
    nextBackoffMs,
    drawRing,
  };
})(typeof self !== "undefined" ? self : this);
