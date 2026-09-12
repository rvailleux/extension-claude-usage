const SETTINGS_KEY = "claudeSettings";
const DEFAULT_POLL_MINUTES = 5;

function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = browser.i18n.getMessage(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = browser.i18n.getMessage(el.dataset.i18nTitle);
  }
}

const els = {
  pollMinutes: document.getElementById("poll-minutes"),
  orgSelect: document.getElementById("org-select"),
  orgHint: document.getElementById("org-hint"),
  reloadOrgsBtn: document.getElementById("reload-orgs-btn"),
  saveBtn: document.getElementById("save-btn"),
  saveStatus: document.getElementById("save-status"),
};

async function loadSettings() {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return {
    pollMinutes: stored.pollMinutes || DEFAULT_POLL_MINUTES,
    orgIdOverride: stored.orgIdOverride || null,
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

async function init() {
  applyI18n();
  const settings = await loadSettings();
  els.pollMinutes.value = settings.pollMinutes;
  await loadOrgs(settings.orgIdOverride);
}

els.reloadOrgsBtn.addEventListener("click", () => loadOrgs(els.orgSelect.value));

els.saveBtn.addEventListener("click", async () => {
  const pollMinutes = Math.min(1440, Math.max(1, Number(els.pollMinutes.value) || DEFAULT_POLL_MINUTES));
  els.pollMinutes.value = pollMinutes;
  const orgIdOverride = els.orgSelect.value || null;

  await browser.storage.local.set({ [SETTINGS_KEY]: { pollMinutes, orgIdOverride } });

  els.saveStatus.textContent = browser.i18n.getMessage("savedStatus");
  setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2000);
});

init();
