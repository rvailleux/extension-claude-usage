# Changelog

All notable changes to this project are documented here, following roughly
the [Keep a Changelog](https://keepachangelog.com/) format. History wasn't
tracked before this file was added, so the current release is the first
entry.

## [Unreleased]

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
