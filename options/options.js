const SETTINGS_KEY = "claudeSettings";
const DEFAULT_POLL_MINUTES = 5;
const ICON_PROVIDERS = ["claude", "opencode", "worst"];

function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = browser.i18n.getMessage(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = browser.i18n.getMessage(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = browser.i18n.getMessage(el.dataset.i18nPlaceholder);
  }
}

const els = {
  pollMinutes: document.getElementById("poll-minutes"),
  orgSelect: document.getElementById("org-select"),
  orgHint: document.getElementById("org-hint"),
  reloadOrgsBtn: document.getElementById("reload-orgs-btn"),
  iconProvider: document.getElementById("icon-provider"),
  opencodeKey: document.getElementById("opencode-key"),
  opencodeStatus: document.getElementById("opencode-status"),
  testOpenCodeBtn: document.getElementById("test-opencode-btn"),
  saveBtn: document.getElementById("save-btn"),
  saveStatus: document.getElementById("save-status"),
};

async function loadSettings() {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return {
    pollMinutes: stored.pollMinutes || DEFAULT_POLL_MINUTES,
    orgIdOverride: stored.orgIdOverride || null,
    opencodeApiKey: stored.opencodeApiKey || "",
    iconProvider: ICON_PROVIDERS.includes(stored.iconProvider) ? stored.iconProvider : "claude",
  };
}

function addOrgOption(org) {
  const id = org.uuid || org.id;
  if (!id) return;
  const option = document.createElement("option");
  option.value = id;
  option.textContent = org.name ? `${org.name} (${id.slice(0, 8)}…)` : id;
  els.orgSelect.appendChild(option);
}

async function loadOrgs(selectedOrgId) {
  els.orgHint.textContent = browser.i18n.getMessage("orgLoading");
  try {
    const orgs = await browser.runtime.sendMessage({ type: "listOrgs" });
    while (els.orgSelect.options.length > 1) {
      els.orgSelect.remove(1);
    }
    for (const org of orgs || []) addOrgOption(org);
    els.orgSelect.value = selectedOrgId || "";
    els.orgHint.textContent = orgs && orgs.length > 1 ? browser.i18n.getMessage("orgMultiple") : "";
  } catch (err) {
    els.orgHint.textContent = browser.i18n.getMessage("orgLoadError");
  }
}

async function checkOpenCodeKey() {
  const apiKey = els.opencodeKey.value.trim();
  if (!apiKey) {
    els.opencodeStatus.textContent = browser.i18n.getMessage("opencodeNoKey");
    return;
  }
  els.opencodeStatus.textContent = browser.i18n.getMessage("opencodeChecking");
  try {
    const result = await browser.runtime.sendMessage({ type: "testOpenCodeKey", apiKey });
    if (result?.ok) {
      els.opencodeStatus.textContent = browser.i18n.getMessage("opencodeKeyOk");
    } else {
      els.opencodeStatus.textContent = browser.i18n.getMessage(
        result?.code === "auth" ? "errorAuthOpenCode" : "errorNetworkOpenCode"
      );
    }
  } catch (err) {
    els.opencodeStatus.textContent = browser.i18n.getMessage("errorNetworkOpenCode");
  }
}

async function init() {
  applyI18n();
  const settings = await loadSettings();
  els.pollMinutes.value = settings.pollMinutes;
  els.iconProvider.value = settings.iconProvider;
  els.opencodeKey.value = settings.opencodeApiKey;
  await loadOrgs(settings.orgIdOverride);
}

els.reloadOrgsBtn.addEventListener("click", () => loadOrgs(els.orgSelect.value));
els.testOpenCodeBtn.addEventListener("click", checkOpenCodeKey);

els.saveBtn.addEventListener("click", async () => {
  const pollMinutes = Math.min(1440, Math.max(1, Number(els.pollMinutes.value) || DEFAULT_POLL_MINUTES));
  els.pollMinutes.value = pollMinutes;
  const orgIdOverride = els.orgSelect.value || null;
  const opencodeApiKey = els.opencodeKey.value.trim();
  els.opencodeKey.value = opencodeApiKey;
  const iconProvider = ICON_PROVIDERS.includes(els.iconProvider.value) ? els.iconProvider.value : "claude";

  await browser.storage.local.set({ [SETTINGS_KEY]: { pollMinutes, orgIdOverride, opencodeApiKey, iconProvider } });

  els.saveStatus.textContent = browser.i18n.getMessage("savedStatus");
  setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2000);
});

init();
