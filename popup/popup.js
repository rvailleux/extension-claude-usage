/* global ClaudeUsageRing */

const STORAGE_KEY = "claudeUsageState";
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const SECONDARY_LABELS = {
  seven_day: "Weekly (all models)",
  seven_day_opus: "Weekly Opus",
  seven_day_sonnet: "Weekly Sonnet",
  seven_day_cowork: "Weekly Cowork",
  seven_day_oauth: "Weekly (API)",
};
const SECONDARY_ORDER = [
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_cowork",
  "seven_day_oauth",
];

const els = {
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  errorMessage: document.getElementById("error-message"),
  data: document.getElementById("state-data"),
  ringProgress: document.getElementById("ring-progress"),
  ringPercent: document.getElementById("ring-percent"),
  sessionReset: document.getElementById("session-reset"),
  secondaryList: document.getElementById("secondary-list"),
  lastUpdated: document.getElementById("last-updated"),
  refreshBtn: document.getElementById("refresh-btn"),
  template: document.getElementById("secondary-item-template"),
};

els.ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);

let lastState = null;

function showOnly(sectionEl) {
  for (const el of [els.loading, els.error, els.data]) {
    el.hidden = el !== sectionEl;
  }
}

function relativeTime(ts) {
  if (!ts) return "";
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function renderSecondary(usage) {
  els.secondaryList.innerHTML = "";
  for (const key of SECONDARY_ORDER) {
    const bucket = usage[key];
    if (!bucket) continue;

    const remaining = ClaudeUsageRing.percentRemaining(bucket.utilization);
    const node = els.template.content.cloneNode(true);

    node.querySelector(".secondary-label").textContent = SECONDARY_LABELS[key] || key;
    node.querySelector(".secondary-percent").textContent =
      remaining === null ? "—" : `${Math.round(remaining)}% left`;

    const fill = node.querySelector(".bar-fill");
    const color = ClaudeUsageRing.levelColor(remaining);
    fill.style.width = `${remaining === null ? 0 : remaining}%`;
    fill.style.background = color;

    const resetEl = node.querySelector(".secondary-reset");
    const countdown = ClaudeUsageRing.formatCountdown(bucket.resets_at);
    resetEl.textContent = countdown ? `Resets in ${countdown}` : "";

    els.secondaryList.appendChild(node);
  }
}

function render(state) {
  lastState = state;

  if (!state) {
    showOnly(els.loading);
    return;
  }

  if (state.error) {
    showOnly(els.error);
    els.errorMessage.textContent =
      state.error === "auth"
        ? "Not signed in to claude.ai. Sign in, then reopen this popup."
        : "Couldn't reach claude.ai. Check your connection and try again.";
    els.lastUpdated.textContent = state.lastUpdated ? `Last tried ${relativeTime(state.lastUpdated)}` : "";
    return;
  }

  if (!state.usage) {
    showOnly(els.loading);
    return;
  }

  showOnly(els.data);

  const fiveHour = state.usage.five_hour;
  const remaining = fiveHour ? ClaudeUsageRing.percentRemaining(fiveHour.utilization) : null;
  const color = ClaudeUsageRing.levelColor(remaining);

  els.ringPercent.textContent = remaining === null ? "—" : `${Math.round(remaining)}%`;
  els.ringProgress.style.stroke = color;
  const fraction = remaining === null ? 0 : remaining / 100;
  els.ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));

  const countdown = fiveHour ? ClaudeUsageRing.formatCountdown(fiveHour.resets_at) : null;
  els.sessionReset.textContent = countdown ? `Resets in ${countdown}` : "";

  renderSecondary(state.usage);

  els.lastUpdated.textContent = state.lastUpdated ? `Updated ${relativeTime(state.lastUpdated)}` : "";
}

async function loadInitial() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  render(stored[STORAGE_KEY] || null);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue);
  }
});

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.classList.add("spinning");
  try {
    await browser.runtime.sendMessage({ type: "refresh" });
  } finally {
    els.refreshBtn.classList.remove("spinning");
  }
});

// Keep "Updated Xm ago" / countdowns fresh even with no new data.
setInterval(() => {
  if (lastState) render(lastState);
}, 30000);

loadInitial();
