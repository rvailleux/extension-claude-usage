# Changelog

All notable changes to this project are documented here, following roughly
the [Keep a Changelog](https://keepachangelog.com/) format. History wasn't
tracked before this file was added, so the current release is the first
entry.

## [Unreleased]

## [1.1.1] - 2026-11-26

### Fixed

- "Couldn't reach opencode.ai" was a catch-all that hid the real cause. A
  request the browser refuses to make (host permission not granted, e.g. after
  an update that added `https://opencode.ai/*`, or with site access set to
  on-click) throws a bare `TypeError: Failed to fetch`, which was reported as a
  network problem. It is now classified against
  `browser.permissions.contains`: the popup says the browser is blocking the
  request, the options page warns before you even try, and the underlying
  message (`Failed to fetch`, `HTTP 502`, `unexpected payload`) is shown as a
  small detail line so a support report is actionable.
- Try `/inference/go/v1/usage` as well as `/zen/go/v1/usage` (both answer the
  same payload today, and the gateway path is the one that works for API keys);
  a 404 moves on to the next path instead of failing the poll.

### Changed

- A non-JSON response (Cloudflare/maintenance interstitial) is now a network
  failure with an "unexpected payload" detail rather than being reported as a
  rejected key.

## [1.1.0] - 2026-11-26

### Added

- **OpenCode Go subscription usage** next to Claude: the popup now has a
  second block with the rolling 5-hour, weekly and monthly windows, each with
  its own reset countdown. Data comes from `GET
  https://opencode.ai/zen/go/v1/usage` with the Go API key as a Bearer token
  (new `https://opencode.ai/*` host permission); a wrong key or a plan-less
  account is reported as an error instead of a fabricated `0%`.
- Options page: an OpenCode Go API key field with a **Check key** button that
  verifies the typed key before saving, and a **Toolbar ring shows** picker
  (Claude / OpenCode Go / lowest of both).
- `shared/usage.js` (+ `shared/usage.test.js`): DOM-free normalization of the
  OpenCode Go payload, skipping windows the API doesn't report a number for.
- `background.test.js`: runs the real `background.js` in a `vm` context with
  a stubbed `browser`/`fetch`, covering both polls, the per-provider
  error/backoff state and the icon-selection rules.

### Changed

- The extension is now named **Usage Ring** (was "Claude Usage Ring"), so the
  packaged artifacts are `usage-ring-<version>.*`. The Firefox add-on id is
  unchanged, so existing installs update in place.
- Each provider is polled into its own storage key (`claudeUsageState`,
  `opencodeUsageState`) with its own failure backoff, so one broken provider
  no longer masks the other.
- The toolbar icon/badge falls back to the other provider when the selected
  one has no data, and only shows `!` when no reading can be displayed.
- `scripts/package.sh` and CI now exclude `*.test.js` and the repo docs
  (`CLAUDE.md`, `CHANGELOG.md`) from the shipped package.

### Fixed

- `scripts/package.sh` now resolves `manifest.json`'s `name` when it's an
  i18n placeholder (`__MSG_extName__`) via `_locales/<default_locale>/messages.json`
  before slugifying it for the output filename. Previously it used the
  literal placeholder text, producing artifacts named e.g.
  `msg-extname-1.0.5.zip` instead of `claude-usage-ring-1.0.5.zip` — this
  is what shipped on the v1.0.5 GitHub Release.

## [1.0.5] - 2026-09-13

### Added

- Chrome/Edge support alongside Firefox: vendored `webextension-polyfill`
  (`vendor/browser-polyfill.js`), a dual `service_worker`/`scripts`
  background declaration, and PNG toolbar icons generated from the existing
  SVG source art.
- Options page (`options/`) to set the poll interval and, for multi-org
  accounts, pick which organization's usage to track (previously always the
  first one).
- `_locales/en/messages.json` — all user-facing strings now go through
  `browser.i18n.getMessage`.
- Keyboard shortcut (`Ctrl+Shift+U` / `MacCtrl+Shift+U`) to open the popup.
- `shared/ring.test.js` unit tests (`node --test`) and a GitHub Actions CI
  workflow running lint + tests on push/PR.
- `aria-live` regions in the popup and options page so screen readers
  announce refreshed usage/status without reopening.
- Explicit `content_security_policy` in the manifest (matches MV3's implicit
  default, documented for clarity).
- Tag-triggered release workflow (`.github/workflows/release.yml`):
  pushing a `v*` tag builds the unsigned zip (Chrome/Edge + Firefox
  temporary-install) and the AMO-signed `.xpi` (permanent Firefox install)
  and publishes both to a GitHub Release.

### Changed

- `claudeFetchJson` now rejects a 200 response with a non-JSON body (e.g. an
  HTML login page) as an auth error instead of surfacing a confusing generic
  failure.
- Repeated poll failures now back off (5m/10m/20m/40m, capped at 60m)
  instead of retrying every `POLL_MINUTES` indefinitely; a manual refresh
  from the popup always bypasses the backoff.

## 1.0.4 and earlier

Firefox-only release history predates this changelog.
