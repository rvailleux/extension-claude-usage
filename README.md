# Claude Usage Ring

A browser extension (Firefox, Chrome, Edge) that shows your Claude.ai usage
as a rounded progress ring, so you can see how much of your quota is left
without switching tabs.

## Features

- **Toolbar icon** — a small colored ring (green → amber → red as you use up
  your quota) plus a badge number showing the remaining percentage, updated
  automatically in the background.
- **Popup** — click the icon for a bigger ring showing your **current
  5-hour session** limit, with a reset countdown, plus compact bars below
  for your **weekly limits** (all-models, and per-model like Opus/Sonnet if
  your plan reports them), each with its own reset countdown and a manual
  refresh button.
- **Options page** — configure how often it polls, and, if your account
  belongs to more than one organization, which one to track.
- **Keyboard shortcut** — `Ctrl+Shift+U` (`MacCtrl+Shift+U` on macOS) opens
  the popup without touching the mouse; customizable like any other browser
  shortcut.
- Works on **Firefox, Chrome, and Edge** from the same source, with no
  build step.

## How it works

### Where the data comes from

The extension calls the same internal endpoints claude.ai's own web app
uses, reusing your existing logged-in session cookie — it never asks for or
handles your password or an API token:

- `GET https://claude.ai/api/organizations` — to find your organization id.
- `GET https://claude.ai/api/organizations/{orgId}/usage` — returns your
  `five_hour` session bucket and `seven_day*` weekly buckets, each shaped as
  `{ utilization, resets_at }`.

This is an **undocumented, internal API**, not a public Anthropic one, so
Anthropic could change or remove it at any time. If that happens (or if
you're simply not signed in), the popup shows an "unavailable"/"not signed
in" state and the toolbar badge shows `!` instead of a percentage, rather
than failing silently or showing stale numbers.

### Background script and refresh cycle

`background.js` is the only piece that talks to the network. It:

1. Runs on a `browser.alarms` timer (5 minutes by default, configurable in
   the options page) and also on browser startup / extension install.
2. Fetches usage, redraws the toolbar ring icon from scratch on an
   `OffscreenCanvas` (there's no static "current usage" icon — it's
   generated every poll), and sets the badge text/color/tooltip.
3. Writes the result to `browser.storage.local` under one key
   (`claudeUsageState`), which is the single source of truth: the popup
   never fetches anything itself, it just reads that key and re-renders
   whenever it changes (`browser.storage.onChanged`). A manual refresh from
   the popup's button sends a one-off message to the background script and
   bypasses the timer.
4. Backs off on repeated failures instead of retrying forever: after
   consecutive errors it waits 5m → 10m → 20m → 40m, capped at 60m, before
   trying again. A manual refresh always bypasses this backoff.
5. Rechecks organization membership automatically if the cached org id
   stops working (e.g. because it changed), and always defers to a manually
   chosen organization from the options page if one is set.

### Cross-browser background loading

Firefox and Chrome/Edge load MV3 background code differently, so
`manifest.json` declares both `background.scripts` (what Firefox actually
uses — a classic, non-worker event page) and `background.service_worker`
(what Chrome/Edge use, ignoring `scripts` entirely). Because Chrome's
worker never receives the extra files Firefox's `scripts` array lists,
`background.js` opens with a small guarded `importScripts(...)` call that
only runs there. `vendor/browser-polyfill.js` (Mozilla's
`webextension-polyfill`, committed directly rather than pulled in via a
package manager — see `vendor/README.md`) is what makes the same
`browser.*` promise-based API available on Chrome/Edge, which natively only
expose `chrome.*`.

### Shared logic

`shared/ring.js` is a small, dependency-free module with no DOM access,
loaded in all three surfaces (background, popup, options): percent/color
math, the reset-countdown formatter, the poll-backoff calculation, and the
canvas ring-drawing routine used for the toolbar icon. Being DOM-free means
it can also be `require()`'d directly under plain Node for
`shared/ring.test.js`, with no test framework or dependencies needed.

### Internationalization

Every user-facing string lives in `_locales/en/messages.json` and is applied
via `browser.i18n.getMessage`, either through `__MSG_<key>__` placeholders in
the manifest or a small `applyI18n()` helper in `popup.js`/`options.js` that
fills in any element tagged `data-i18n`. Only English is provided today, but
adding a locale is just a matter of adding another `_locales/<lang>/` folder.

## Privacy & security

- **No credentials handled by the extension.** It relies entirely on the
  browser's own cookie jar for `https://claude.ai` (via `credentials:
  "include"` on its `fetch` calls) — it never reads, stores, or transmits
  your password, session cookie, or an API key anywhere.
- **Minimal permissions.** Only `storage`, `alarms`, and host access scoped
  to `https://claude.ai/*` — no `<all_urls>`, no `tabs`, no `cookies`
  permission, no content scripts injected into any page.
- **Nothing leaves your machine except the two calls above.** The org id
  and usage numbers are cached locally in `browser.storage.local`; there is
  no analytics, telemetry, or third-party server involved.
- **No remote code.** Everything shipped is static JS/CSS/SVG/PNG bundled
  in the extension itself (including the vendored polyfill); nothing is
  fetched and executed at runtime.
- The one accepted risk is structural, not a vulnerability: this uses an
  **undocumented internal API**, so Anthropic could change its shape or
  restrict access without notice — see "Where the data comes from" above
  for how that's surfaced to you.

## Browser support

| Browser | Status | Notes |
| --- | --- | --- |
| Firefox (desktop) | Supported | `strict_min_version: 140.0` |
| Firefox for Android | Supported | `strict_min_version: 142.0`; toolbar popup behavior follows Firefox Android's own UI conventions |
| Chrome | Supported | Manifest V3 service worker |
| Edge | Supported | Chromium-based, same code path as Chrome |

## Install (temporary, for development)

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this folder.
4. Make sure you're signed in to [claude.ai](https://claude.ai) in the same
   Firefox profile, then click the toolbar icon.

(Temporary add-ons are removed when Firefox restarts — reload as needed
during development.)

**Chrome / Edge**

1. Open `chrome://extensions` (or `edge://extensions`) and enable
   **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Make sure you're signed in to [claude.ai](https://claude.ai) in the same
   browser profile, then click the toolbar icon.

(Unpacked extensions stay installed across restarts, but Chrome/Edge will
flag them as "unpacked"/developer-mode; reload from `chrome://extensions`
after pulling new changes.)

## Configuration

Open the options page from `about:addons` (Firefox — find the extension,
open its menu, choose **Options**) or `chrome://extensions`/`edge://extensions`
(Chrome/Edge — find the extension, click **Details**, choose **Extension
options**):

- **Poll interval** — how often, in minutes, the background script checks
  for updated usage. Changing it re-creates the alarm immediately.
- **Organization** — if your claude.ai account belongs to more than one
  organization, pick which one to track (defaults to "Automatic", the first
  one returned by the API). Use the reload button next to the dropdown to
  re-fetch the list if it changed.

## Package for distribution

This section is the manual, local equivalent of what the [Releasing](#releasing)
workflow does automatically on a version tag push — use it to build/sign a
one-off package without cutting a full release.

`scripts/package.sh` targets **Firefox** distribution via
[web-ext](https://github.com/mozilla/web-ext) and Mozilla's signing API (see
below). For Chrome/Edge, zip this folder (or reuse the same
`web-ext build`/`--ignore-files` list) and upload it through the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
or [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/) —
neither needs the AMO signing step described below.

```
./scripts/package.sh
```

Lints the extension, then builds an **unsigned** zip at
`web-ext-artifacts/claude-usage-ring-<version>.zip` (README.md and the
`scripts/` folder are excluded from the package). This zip can only be
loaded temporarily (`about:debugging` → Load Temporary Add-on) — Firefox
refuses to install it permanently until it's signed by Mozilla.

### Sign it (permanent install, no dev flags needed)

1. Get a free API key/secret pair from
   [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/)
   (requires a Firefox Account).
2. Either export them, or put them in a `.env` file in the project root
   (loaded automatically by the script, and git-ignored):
   ```
   JWT_ISSUER=your-jwt-issuer
   JWT_SECRET=your-jwt-secret
   ```
3. Run:
   ```
   ./scripts/package.sh --sign
   ```
   This produces a signed `.xpi` in `web-ext-artifacts/` you can drag into
   `about:addons` (or double-click) to install permanently — no
   `about:config` flags or temporary-add-on reload needed.

By default this signs for the **`unlisted`** channel — self-distribution:
Mozilla auto-signs it (usually within seconds/minutes, no human review)
and it's yours to install or share as a file. Pass
`./scripts/package.sh --sign --channel listed` instead to submit it for
the public AMO catalog, which goes through Mozilla's manual review
process and can take longer, and which also needs `--amo-metadata` (see
`web-ext sign --help`) for listing details like a public name/description.

See [Signing and distributing your
add-on](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
for background on the two channels.

## Releasing

Pushing a version tag builds both artifacts and publishes them to a GitHub
Release, so the latest build for each platform is always available from
this repo without a manual build step:

1. Bump `manifest.json`'s `version`, commit it.
2. Tag that commit and push the tag:
   ```
   git tag v1.0.5
   git push origin v1.0.5
   ```
3. `.github/workflows/release.yml` builds the unsigned zip (Chrome/Edge +
   Firefox temporary-install) and the signed `.xpi` (permanent Firefox
   install), then attaches both to a new Release named after the tag.

This requires two repository secrets, from an AMO API key/secret pair (see
"Sign it" above): **Settings → Secrets and variables → Actions → New
repository secret** — `JWT_ISSUER` and `JWT_SECRET`. The workflow fails
fast if the tag's version doesn't match `manifest.json`'s (a mismatch
usually means the version bump wasn't committed before tagging).

## Testing

```
node --test
```

Runs the unit tests in `shared/ring.test.js` (percent/color math, countdown
formatting, poll-backoff calculation) using Node's built-in test runner — no
dependencies needed. The same command runs in CI
(`.github/workflows/ci.yml`), alongside `web-ext lint`, on every push and
pull request.

## Project layout

```
manifest.json          Manifest V3, permissions, background/popup/options wiring
background.js          Polls the usage API, updates the toolbar ring icon + badge
shared/ring.js         Pure helpers shared by background + popup + options: % math,
                        color thresholds, reset countdown formatting, canvas ring
                        drawing, poll-backoff calculation
shared/ring.test.js    Unit tests for shared/ring.js (node --test)
popup/popup.html       Popup markup
popup/popup.css        Theme-aware (light/dark) styling, shared by the options page
popup/popup.js         Renders the SVG ring + weekly bars from stored usage state
options/options.html   Options page markup (poll interval, org picker)
options/options.js     Reads/writes settings, lists organizations via background
vendor/browser-polyfill.js  Vendored webextension-polyfill (see vendor/README.md)
_locales/en/messages.json  User-facing strings (browser.i18n)
icons/icon-*.svg       Source art
icons/icon-*.png       Generated from the SVGs (Chrome/Edge require PNG icons);
                        overwritten dynamically once real usage data loads
.github/workflows/ci.yml       Lint + unit tests on push/PR
.github/workflows/release.yml  Builds + publishes a GitHub Release on a version tag push
scripts/package.sh     Lints, builds, and (optionally) signs the Firefox package
```

No build step — plain JS/CSS/SVG, loaded directly by the browser. Third-party
code is vendored (`vendor/`) rather than pulled in via a package manager.

## Known limitations

- If `utilization` for a bucket is missing from the API response, that ring
  simply shows `—` (unknown) rather than guessing.
- Relies on an internal endpoint (see "Privacy & security" above) — if
  Anthropic changes its shape, the popup will show the "unavailable" error
  state until the code is updated.
- Only English strings are provided (`_locales/en`); the i18n plumbing is in
  place for further locales but none are translated yet.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
