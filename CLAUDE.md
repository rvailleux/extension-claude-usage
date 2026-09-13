# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cross-browser WebExtension (Manifest V3; Firefox, Chrome, Edge) that shows
the user's claude.ai usage (5-hour session + weekly limits) as a rounded
progress ring in the toolbar icon/badge, a popup, and an options page. Plain
JS/CSS/SVG, no build step, no package manager — third-party code (the
`browser.*` polyfill) is vendored directly instead. Loaded directly by the
browser from source.

## Commands

- **Load into Firefox for dev**: open `about:debugging#/runtime/this-firefox`
  → *Load Temporary Add-on…* → select `manifest.json`. Reload after every
  change; temporary add-ons are dropped on browser restart.
- **Load into Chrome/Edge for dev**: open `chrome://extensions` (or
  `edge://extensions`), enable Developer mode, **Load unpacked** → select
  this folder. Reload from that page after changes.
- **Lint**: `npx web-ext@latest lint --source-dir .` (also run automatically
  by `scripts/package.sh` and in CI). Expect exactly one warning,
  `BACKGROUND_SERVICE_WORKER_IGNORED` — that's Firefox correctly ignoring the
  `service_worker` key it doesn't use (see Architecture below); anything else
  is a real issue.
- **Unit tests**: `node --test` (runs `shared/ring.test.js`, no dependencies
  needed). Also run in CI (`.github/workflows/ci.yml`).
- **Package (unsigned zip)**: `./scripts/package.sh` — Firefox-targeted:
  lints, then builds `web-ext-artifacts/<slug>-<version>.zip` via
  `web-ext build --filename`. Unsigned zips only install temporarily in
  Firefox. For Chrome/Edge store submission, zip the source directly (same
  `--ignore-files` list) instead.
- **Package + sign (installable .xpi, Firefox only)**:
  `./scripts/package.sh --sign` (add `--channel listed` to submit for full
  AMO review instead of the default `unlisted` self-distribution channel).
  Requires `JWT_ISSUER` / `JWT_SECRET` (AMO API key/secret from
  https://addons.mozilla.org/developers/addon/api/key/) either exported or
  in a git-ignored `.env` file; the script maps them onto the
  `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` env vars `web-ext` itself reads.
  **AMO rejects re-signing a version it has already seen** (even a no-op
  retry) — bump `manifest.json`'s `version` before re-running `--sign` if a
  prior attempt for the current version already succeeded or conflicted.

## Architecture

**Cross-browser background**: Firefox and Chrome/Edge load the background
context differently, so `manifest.json`'s `background` key declares both:
`scripts: [vendor/browser-polyfill.js, shared/ring.js, background.js]` (what
Firefox actually uses — an event page, all three files sharing one global)
and `service_worker: background.js` (what Chrome/Edge use, ignoring
`scripts` entirely). Because Chrome's service worker never receives the
first two files via `scripts`, `background.js` opens with a guarded
`importScripts("vendor/browser-polyfill.js", "shared/ring.js")` that only
runs when `importScripts` exists and `browser` isn't already defined — a
no-op on Firefox. `web-ext lint` will always report
`BACKGROUND_SERVICE_WORKER_IGNORED` for this; that's expected, not a bug.
`popup/popup.html` and `options/options.html` each load
`vendor/browser-polyfill.js` via a `<script>` tag for the same reason (it's a
no-op where `browser` already exists).

**Data source**: `background.js` polls claude.ai's own internal (undocumented)
web API, not a public Anthropic API — it can change shape without notice.
Two calls, both `credentials: "include"` so the user's existing claude.ai
session cookie authenticates them (the extension never reads/stores cookies
itself; `host_permissions` for `https://claude.ai/*` is what makes the
cookie-bearing fetch possible):
1. `GET /api/organizations` → org id, cached in `storage.local` under
   `claudeOrgId` — unless the user picked one explicitly in the options page
   (`claudeSettings.orgIdOverride`), which always wins.
2. `GET /api/organizations/{orgId}/usage` → `{ five_hour, seven_day,
   seven_day_opus, ... }`, each bucket `{ utilization, resets_at }`.

A 200 response whose body isn't JSON (typically an HTML login/interstitial
page) is treated as an auth failure, not a generic network error.

Fetched state is written to `browser.storage.local` under one key
(`claudeUsageState` = `{ lastUpdated, usage, error, consecutiveFailures,
nextAttemptAt }`) — this is the single source of truth both the toolbar icon
and the popup render from. `consecutiveFailures`/`nextAttemptAt` drive a
capped exponential backoff (`ClaudeUsageRing.nextBackoffMs`, in
`shared/ring.js`) so the alarm handler skips polling while backing off; a
manual refresh (the popup's button, or the `{ type: "refresh" }` message)
always bypasses it.

**shared/ring.js** is a dependency-free, classic (non-ES-module) script that
defines a global `ClaudeUsageRing` object. It's loaded in three contexts —
background, popup, and options — via a `<script>` tag or `importScripts`
(never as an ES module import), so any new shared logic here must stay
DOM-free to keep working in all of them. `shared/ring.test.js` covers it
directly with `node --test`, requiring the file via CommonJS (`global` in
its IIFE resolves to `module.exports` under Node).

**Toolbar icon**: `background.js` redraws the ring itself on every refresh
(`OffscreenCanvas` + `ClaudeUsageRing.drawRing`) and calls
`browser.action.setIcon` with the resulting `ImageData`, plus sets the badge
text/color — there's no static "current usage" icon asset, it's generated
per-poll. The manifest's static icons (`icons/icon-*.png`, generated from the
`.svg` source art via ImageMagick — Chrome/Edge don't accept SVG manifest
icons) are only ever seen before the first successful poll or if
`setIcon`/`OffscreenCanvas` fails on some platform.

**Refresh triggers**: a `browser.alarms` timer (period from
`claudeSettings.pollMinutes`, default 5 min, configurable in the options
page — changing it in storage re-creates the alarm) plus
`onInstalled`/`onStartup`, and an on-demand `{ type: "refresh" }` runtime
message sent by the popup's refresh button. The popup itself never fetches —
it only reads `storage.local` and re-renders via `browser.storage.onChanged`.

**Options page** (`options/`): reads/writes `claudeSettings` (`{ pollMinutes,
orgIdOverride }`) in `storage.local` directly, and sends a `{ type:
"listOrgs" }` message to the background script (which reuses
`claudeFetchJson`) to populate the organization picker.

**i18n**: every user-facing string lives in `_locales/en/messages.json` and
is applied either via `__MSG_<key>__` manifest placeholders, or in
popup.js/options.js via a small `applyI18n()` helper that walks
`[data-i18n]`/`[data-i18n-title]`/`[data-i18n-aria-label]` attributes plus
direct `browser.i18n.getMessage()` calls for dynamic/substituted strings
(countdowns, percentages, error text).

**scripts/package.sh** is the single packaging entrypoint (lint → build, or
lint → build → sign). Its `IGNORE_ARGS` list is what keeps `README.md`,
`scripts/`, and repo/tooling files out of the shipped package — extend that
list rather than `.gitignore` if a new repo-only file needs excluding from
the extension zip/xpi too. `web-ext sign` (unlike `build`) has no
`--filename` flag and names its output after the AMO-assigned extension id,
so the script renames the result after the fact to match `build`'s
`<slug>-<version>` convention.
