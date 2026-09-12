# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Firefox WebExtension (Manifest V3) that shows the user's claude.ai usage
(5-hour session + weekly limits) as a rounded progress ring in the toolbar
icon/badge and a popup. Plain JS/CSS/SVG, no build step, no dependencies —
loaded directly by Firefox from source.

## Commands

- **Load into Firefox for dev**: open `about:debugging#/runtime/this-firefox`
  → *Load Temporary Add-on…* → select `manifest.json`. Reload after every
  change; temporary add-ons are dropped on browser restart.
- **Lint**: `npx web-ext@latest lint --source-dir .` (also run automatically
  by `scripts/package.sh`).
- **Package (unsigned zip)**: `./scripts/package.sh` — lints, then builds
  `web-ext-artifacts/<slug>-<version>.zip` via `web-ext build --filename`.
  Unsigned zips only install temporarily in Firefox.
- **Package + sign (installable .xpi)**: `./scripts/package.sh --sign`
  (add `--channel listed` to submit for full AMO review instead of the
  default `unlisted` self-distribution channel). Requires `JWT_ISSUER` /
  `JWT_SECRET` (AMO API key/secret from
  https://addons.mozilla.org/developers/addon/api/key/) either exported or
  in a git-ignored `.env` file; the script maps them onto the
  `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` env vars `web-ext` itself reads.
  **AMO rejects re-signing a version it has already seen** (even a no-op
  retry) — bump `manifest.json`'s `version` before re-running `--sign` if a
  prior attempt for the current version already succeeded or conflicted.
- There is no automated test suite; verification is `web-ext lint` plus
  manually loading the temporary add-on in Firefox.

## Architecture

**Data source**: `background.js` polls claude.ai's own internal (undocumented)
web API, not a public Anthropic API — it can change shape without notice.
Two calls, both `credentials: "include"` so the user's existing claude.ai
session cookie authenticates them (the extension never reads/stores cookies
itself; `host_permissions` for `https://claude.ai/*` is what makes the
cookie-bearing fetch possible):
1. `GET /api/organizations` → org id, cached in `storage.local` (only the
   first org is used if the account has several — no multi-org UI yet).
2. `GET /api/organizations/{orgId}/usage` → `{ five_hour, seven_day,
   seven_day_opus, ... }`, each bucket `{ utilization, resets_at }`.

Fetched state is written to `browser.storage.local` under one key
(`claudeUsageState` = `{ lastUpdated, usage, error }`) — this is the single
source of truth both the toolbar icon and the popup render from.

**shared/ring.js** is a dependency-free, classic (non-ES-module) script that
defines a global `ClaudeUsageRing` object. It's loaded twice — once as a
background script, once via a `<script>` tag in `popup.html` — because the
background context has `OffscreenCanvas` but no `document`, while the popup
has `document` but draws its ring as SVG instead of canvas. Keep any new
shared logic here DOM-free so it keeps working in both contexts.

**Toolbar icon**: `background.js` redraws the ring itself on every refresh
(`OffscreenCanvas` + `ClaudeUsageRing.drawRing`) and calls
`browser.action.setIcon` with the resulting `ImageData`, plus sets the badge
text/color — there's no static "current usage" icon asset, it's generated
per-poll.

**Refresh triggers**: a `browser.alarms` timer (`POLL_MINUTES` in
`background.js`, currently 5 min) plus `onInstalled`/`onStartup`, and an
on-demand `{ type: "refresh" }` runtime message sent by the popup's refresh
button. The popup itself never fetches — it only reads `storage.local` and
re-renders via `browser.storage.onChanged`.

**scripts/package.sh** is the single packaging entrypoint (lint → build, or
lint → build → sign). Its `IGNORE_ARGS` list is what keeps `README.md`,
`scripts/`, and repo/tooling files out of the shipped package — extend that
list rather than `.gitignore` if a new repo-only file needs excluding from
the extension zip/xpi too. `web-ext sign` (unlike `build`) has no
`--filename` flag and names its output after the AMO-assigned extension id,
so the script renames the result after the fact to match `build`'s
`<slug>-<version>` convention.
