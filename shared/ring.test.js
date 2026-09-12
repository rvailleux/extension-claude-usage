"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ClaudeUsageRing } = require("./ring.js");

const {
  normalizeUtilizationToPercentUsed,
  percentRemaining,
  levelColor,
  formatCountdown,
  nextBackoffMs,
} = ClaudeUsageRing;

test("normalizeUtilizationToPercentUsed", () => {
  assert.equal(normalizeUtilizationToPercentUsed(0.5), 50);
  assert.equal(normalizeUtilizationToPercentUsed(75), 75);
  assert.equal(normalizeUtilizationToPercentUsed(1), 100, "1 is treated as a fraction (100%), not 1%");
  assert.equal(normalizeUtilizationToPercentUsed(150), 100, "clamped to 100");
  assert.equal(normalizeUtilizationToPercentUsed(-5), 0, "clamped to 0");
  assert.equal(normalizeUtilizationToPercentUsed(NaN), null);
  assert.equal(normalizeUtilizationToPercentUsed("50"), null, "non-numbers are rejected");
  assert.equal(normalizeUtilizationToPercentUsed(undefined), null);
});

test("percentRemaining", () => {
  assert.equal(percentRemaining(0.3), 70);
  assert.equal(percentRemaining(0), 100);
  assert.equal(percentRemaining(1), 0);
  assert.equal(percentRemaining(NaN), null);
});

test("levelColor thresholds", () => {
  assert.equal(levelColor(null), "#9aa0a6", "unknown -> gray");
  assert.equal(levelColor(undefined), "#9aa0a6");
  assert.equal(levelColor(0), "#e5484d", "0% remaining -> red");
  assert.equal(levelColor(10), "#e5484d", "boundary: <=10 -> red");
  assert.equal(levelColor(10.1), "#f5a623", "just above red boundary -> amber");
  assert.equal(levelColor(30), "#f5a623", "boundary: <=30 -> amber");
  assert.equal(levelColor(30.1), "#2fb344", "just above amber boundary -> green");
  assert.equal(levelColor(100), "#2fb344");
});

test("formatCountdown", () => {
  const in_ = (ms) => new Date(Date.now() + ms).toISOString();

  assert.equal(formatCountdown(null), null);
  assert.equal(formatCountdown("not a date"), null);
  assert.equal(formatCountdown(in_(-1000)), "resetting…", "past timestamps");
  assert.equal(formatCountdown(in_(30 * 1000)), "<1m", "under a minute");
  assert.equal(formatCountdown(in_(5 * 60 * 1000)), "5m");
  assert.equal(formatCountdown(in_(2 * 60 * 60 * 1000 + 14 * 60 * 1000)), "2h 14m");
  assert.equal(formatCountdown(in_(60 * 60 * 1000)), "1h 0m");
  assert.equal(formatCountdown(in_(3 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)), "3d 3h");
});

test("nextBackoffMs", () => {
  assert.equal(nextBackoffMs(0), 0, "no failures -> no delay");
  assert.equal(nextBackoffMs(-1), 0);
  assert.equal(nextBackoffMs(NaN), 0);
  assert.equal(nextBackoffMs(1), 5 * 60 * 1000);
  assert.equal(nextBackoffMs(2), 10 * 60 * 1000);
  assert.equal(nextBackoffMs(3), 20 * 60 * 1000);
  assert.equal(nextBackoffMs(4), 40 * 60 * 1000);
  assert.equal(nextBackoffMs(5), 60 * 60 * 1000, "capped at 60m");
  assert.equal(nextBackoffMs(20), 60 * 60 * 1000, "stays capped for large counts");
});
