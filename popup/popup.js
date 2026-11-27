/* global ClaudeUsageRing, UsageData */

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const CLAUDE_SECONDARY_LABEL_KEYS = {
  seven_day: "secondaryLabelSevenDay",
  seven_day_opus: "secondaryLabelSevenDayOpus",
  seven_day_sonnet: "secondaryLabelSevenDaySonnet",
  seven_day_cowork: "secondaryLabelSevenDayCowork",
  seven_day_oauth: "secondaryLabelSevenDayOauth",
};
const CLAUDE_SECONDARY_ORDER = [
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_cowork",
  "seven_day_oauth",
];

const OPENCODE_LABEL_KEYS = {
  rolling: "opencodeLabelRolling",
  weekly: "opencodeLabelWeekly",
  monthly: "opencodeLabelMonthly",
};

const els = {
  loading: document.getElementById("state-loading"),
  providers: document.getElementById("providers"),
  providerTemplate: document.getElementById("provider-template"),
  secondaryTemplate: document.getElementById("secondary-item-template"),
  refreshBtn: document.getElementById("refresh-btn"),
  optionsBtn: document.getElementById("options-btn"),
};

let lastStates = {};

function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = browser.i18n.getMessage(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = browser.i18n.getMessage(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", browser.i18n.getMessage(el.dataset.i18nAriaLabel));
  }
}

// Compact time units ("5m ago", "2h 14m") are intentionally plain strings,
// not i18n message keys - see shared/ring.js's formatCountdown for why.
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

/** Normalize a Claude usage payload into the shared per-provider model. */
function claudeModel(usage) {
  const fiveHour = usage?.five_hour;
  const bars = [];
  for (const key of CLAUDE_SECONDARY_ORDER) {
    const bucket = usage?.[key];
    if (!bucket) continue;
    bars.push({
      labelKey: CLAUDE_SECONDARY_LABEL_KEYS[key],
      percentLeft: ClaudeUsageRing.percentRemaining(bucket.utilization),
      resetsAt: bucket.resets_at,
    });
  }
  return {
    primaryLabelKey: "primaryLabel",
    percentLeft: fiveHour ? ClaudeUsageRing.percentRemaining(fiveHour.utilization) : null,
    primaryResetsAt: fiveHour?.resets_at || null,
    bars,
  };
}

/** Normalize an OpenCode Go usage payload into the same model. */
function opencodeModel(usage) {
  const windows = UsageData.opencodeWindows(usage || {});
  const primary = windows.find((w) => w.id === "rolling") || null;
  return {
    primaryLabelKey: "opencodeLabelRolling",
    percentLeft: primary ? primary.percentLeft : null,
    primaryResetsAt: primary ? primary.resetsAt : null,
    bars: windows
      .filter((w) => w.id !== "rolling")
      .map((w) => ({
        labelKey: OPENCODE_LABEL_KEYS[w.id] || w.id,
        percentLeft: w.percentLeft,
        resetsAt: w.resetsAt,
      })),
  };
}

const PROVIDERS = [
  {
    id: "claude",
    storageKey: "claudeUsageState",
    nameKey: "providerClaude",
    model: claudeModel,
    errorKeys: { auth: "errorAuth", network: "errorNetwork", permission: "errorPermission" },
    // Where the "fix it" button sends the user when this provider errors.
    errorAction: { labelKey: "openClaudeLink", href: "https://claude.ai" },
  },
  {
    id: "opencode",
    storageKey: "opencodeUsageState",
    nameKey: "providerOpenCode",
    model: opencodeModel,
    errorKeys: {
      auth: "errorAuthOpenCode",
      network: "errorNetworkOpenCode",
      permission: "errorPermissionOpenCode",
    },
    errorAction: { labelKey: "opencodeOpenOptions", options: true },
  },
];

function renderBars(listEl, bars) {
  for (const bar of bars) {
    const node = els.secondaryTemplate.content.cloneNode(true);
    node.querySelector(".secondary-label").textContent = browser.i18n.getMessage(bar.labelKey) || bar.labelKey;
    node.querySelector(".secondary-percent").textContent =
      bar.percentLeft === null ? "—" : browser.i18n.getMessage("percentLeft", [String(Math.round(bar.percentLeft))]);

    const fill = node.querySelector(".bar-fill");
    fill.style.width = `${bar.percentLeft === null ? 0 : bar.percentLeft}%`;
    fill.style.background = ClaudeUsageRing.levelColor(bar.percentLeft);

    const resetEl = node.querySelector(".secondary-reset");
    const countdown = ClaudeUsageRing.formatCountdown(bar.resetsAt);
    resetEl.textContent = countdown ? browser.i18n.getMessage("resetsIn", [countdown]) : "";

    listEl.appendChild(node);
  }
}

function renderNote(section, { noteKey, action, detail }) {
  const note = section.querySelector(".provider-note");
  const detailEl = section.querySelector(".provider-detail");
  const button = section.querySelector(".provider-action");

  if (noteKey) {
    note.textContent = browser.i18n.getMessage(noteKey);
    note.hidden = false;
  }
  if (detail) {
    detailEl.textContent = detail;
    detailEl.hidden = false;
  }
  if (action) {
    button.textContent = browser.i18n.getMessage(action.labelKey);
    button.hidden = false;
    button.addEventListener("click", () => {
      if (action.options) browser.runtime.openOptionsPage();
      else if (action.href) window.open(action.href, "_blank", "noopener");
    });
  }
}

function renderProvider(provider, state) {
  const section = els.providerTemplate.content.cloneNode(true);
  section.querySelector(".provider").dataset.provider = provider.id;
  applyI18n(section);

  section.querySelector(".provider-name").textContent = browser.i18n.getMessage(provider.nameKey) || provider.id;
  section.querySelector(".provider-updated").textContent = state?.lastUpdated
    ? browser.i18n.getMessage("updatedAgo", [relativeTime(state.lastUpdated)])
    : "";

  const ring = section.querySelector(".ring-progress");
  ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE);

  const hideRing = () => {
    section.querySelector(".ring-wrap").hidden = true;
    section.querySelector(".primary-meta").hidden = true;
  };

  if (state && state.configured === false) {
    hideRing();
    renderNote(section, { noteKey: "opencodeNoKey", action: { labelKey: "opencodeOpenOptions", options: true } });
    return section;
  }

  if (state && state.error) {
    hideRing();
    renderNote(section, {
      noteKey: provider.errorKeys[state.error] || "errorNetwork",
      action: provider.errorAction,
      detail: state.errorDetail || null,
    });
    return section;
  }

  if (!state || !state.usage) {
    hideRing();
    renderNote(section, { noteKey: "loadingText" });
    return section;
  }

  const model = provider.model(state.usage);
  const remaining = model.percentLeft;
  const color = ClaudeUsageRing.levelColor(remaining);

  section.querySelector(".ring-percent").textContent = remaining === null ? "—" : `${Math.round(remaining)}%`;
  ring.style.stroke = color;
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - (remaining === null ? 0 : remaining / 100)));

  section.querySelector(".primary-label").textContent = browser.i18n.getMessage(model.primaryLabelKey);
  const countdown = ClaudeUsageRing.formatCountdown(model.primaryResetsAt);
  section.querySelector(".primary-meta .reset-text").textContent = countdown
    ? browser.i18n.getMessage("resetsIn", [countdown])
    : "";

  renderBars(section.querySelector(".secondary-list"), model.bars);
  return section;
}

function render(states) {
  lastStates = states || {};
  els.providers.innerHTML = "";
  els.loading.hidden = PROVIDERS.some((p) => lastStates[p.id]);

  for (const provider of PROVIDERS) {
    els.providers.appendChild(renderProvider(provider, lastStates[provider.id] || null));
  }
}

async function loadInitial() {
  applyI18n();
  const stored = await browser.storage.local.get(PROVIDERS.map((p) => p.storageKey));
  const states = {};
  for (const provider of PROVIDERS) states[provider.id] = stored[provider.storageKey] || null;
  render(states);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let changed = false;
  for (const provider of PROVIDERS) {
    if (changes[provider.storageKey]) {
      lastStates[provider.id] = changes[provider.storageKey].newValue || null;
      changed = true;
    }
  }
  if (changed) render(lastStates);
});

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.classList.add("spinning");
  try {
    await browser.runtime.sendMessage({ type: "refresh" });
  } finally {
    els.refreshBtn.classList.remove("spinning");
  }
});

els.optionsBtn.addEventListener("click", () => browser.runtime.openOptionsPage());

// Keep "Updated Xm ago" / countdowns fresh even with no new data.
setInterval(() => {
  if (Object.keys(lastStates).length > 0) render(lastStates);
}, 30000);

loadInitial();
