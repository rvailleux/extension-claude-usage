"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { UsageData } = require("./usage.js");

const { opencodeWindows, opencodePrimaryPercentLeft, worstRemaining } = UsageData;

// Shape captured from the live endpoint (`GET https://opencode.ai/zen/go/v1/usage`).
const LIVE_PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 28, resetsAt: "2026-11-27T02:10:04.000Z" },
    weekly: { status: "ok", percent: 11, resetsAt: "2026-11-30T00:00:00.000Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-12-26T20:43:57.000Z" },
  },
};

test("opencodeWindows flattens the live payload in rolling/weekly/monthly order", () => {
  const windows = opencodeWindows(LIVE_PAYLOAD);
  assert.deepEqual(
    windows.map((w) => w.id),
    ["rolling", "weekly", "monthly"]
  );
  assert.equal(windows[0].percentUsed, 28);
  assert.equal(windows[0].percentLeft, 72);
  assert.equal(windows[0].resetsAt, "2026-11-27T02:10:04.000Z");
  assert.equal(windows[1].percentLeft, 89);
  assert.equal(windows[2].percentLeft, 95);
  assert.equal(windows[0].status, "ok");
});

test("opencodeWindows clamps out-of-range percentages", () => {
  const windows = opencodeWindows({ usage: { rolling: { percent: 140 }, weekly: { percent: -3 } } });
  assert.equal(windows[0].percentUsed, 100);
  assert.equal(windows[0].percentLeft, 0);
  assert.equal(windows[1].percentUsed, 0);
  assert.equal(windows[1].percentLeft, 100);
});

test("opencodeWindows skips windows without a numeric percent", () => {
  const windows = opencodeWindows({
    usage: { rolling: { percent: 10 }, weekly: { status: "ok" }, monthly: { percent: "7" } },
  });
  assert.deepEqual(windows.map((w) => w.id), ["rolling"], "no fabricated bars for missing metrics");
});

test("opencodeWindows tolerates payloads that are not the expected shape", () => {
  assert.deepEqual(opencodeWindows(null), []);
  assert.deepEqual(opencodeWindows({}), []);
  assert.deepEqual(opencodeWindows({ usage: null }), []);
  assert.deepEqual(opencodeWindows("<html>login</html>"), []);
  assert.deepEqual(opencodeWindows({ usage: { rolling: null } }), []);
});

test("opencodePrimaryPercentLeft reads the rolling window only", () => {
  assert.equal(opencodePrimaryPercentLeft(LIVE_PAYLOAD), 72);
  assert.equal(opencodePrimaryPercentLeft({ usage: { weekly: { percent: 50 } } }), null);
  assert.equal(opencodePrimaryPercentLeft(null), null);
});

test("worstRemaining picks the lowest finite value", () => {
  assert.equal(worstRemaining([72, 11]), 11);
  assert.equal(worstRemaining([null, 11]), 11);
  assert.equal(worstRemaining([null, undefined, NaN]), null);
  assert.equal(worstRemaining([]), null);
  assert.equal(worstRemaining(null), null);
  assert.equal(worstRemaining([0, 40]), 0);
});
