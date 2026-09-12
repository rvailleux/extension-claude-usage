# Claude Usage Ring

A Firefox/Chrome/Edge extension that shows your Claude.ai usage as a rounded
progress ring:

- **Toolbar icon** — a small colored ring (green → amber → red as you use up
  your quota) plus a badge number, so you can see your remaining % at a
  glance without opening anything. A keyboard shortcut (`Ctrl+Shift+U` /
  `MacCtrl+Shift+U`, customizable) opens the popup too.
- **Popup** — a big ring for your **current 5-hour session** limit with the
  % remaining in the center and a reset countdown, plus compact bars below
  for your **weekly limits** (all-models, and per-model like Opus/Sonnet if
  your plan reports them), each with their own reset countdown.
- **Options page** — set the poll interval, and pick which organization to
  track if your account belongs to more than one.

## How it gets the data

It calls the same internal endpoints claude.ai's own web app uses, reusing
your existing logged-in session cookie (you must be signed in to claude.ai
in this browser — the extension never sees or stores your password/token):

- `GET https://claude.ai/api/organizations` — to find your organization id
  (cached locally).
- `GET https://claude.ai/api/organizations/{orgId}/usage` — returns your
  `five_hour` session bucket and `seven_day*` weekly buckets, each as
  `{ utilization, resets_at }`.

This is an **undocumented, internal API** — not a public Anthropic API — so
Anthropic could change or remove it at any time, which would surface as an
"unavailable" state in the popup (badge shows `!`). No API key or account
credentials are requested or handled by the extension itself; permissions
are limited to `storage`, `alarms`, and host access to `https://claude.ai/*`.

It polls every 5 minutes by default (configurable in the options page) via
`browser.alarms`, and you can force an immediate refresh from the popup's
refresh button. Repeated failures back off (5m → 10m → 20m → 40m, capped at
60m) instead of hammering the endpoint; a manual refresh always bypasses
that backoff.

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

## Package for distribution

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
`web-ext-artifacts/claude_usage_ring-<version>.zip` (README.md and the
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

## Project layout

```
manifest.json          Manifest V3, permissions, background/popup/options wiring
background.js          Polls the usage API, updates the toolbar ring icon + badge
shared/ring.js         Pure helpers shared by background + popup: % math, color
                        thresholds, reset countdown formatting, canvas ring
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
.github/workflows/ci.yml  Lint + unit tests on push/PR
```

No build step — plain JS/CSS/SVG, loaded directly by the browser. Third-party
code is vendored (`vendor/`) rather than pulled in via a package manager.

## Testing

```
node --test
```

Runs the unit tests in `shared/ring.test.js` (percent/color math, countdown
formatting, poll-backoff calculation) using Node's built-in test runner — no
dependencies needed. The same command runs in CI (`.github/workflows/ci.yml`)
alongside `web-ext lint`.

## Known limitations

- If `utilization` for a bucket is missing from the API response, that ring
  simply shows `—` (unknown) rather than guessing.
- Relies on an internal endpoint (see above) — if Anthropic changes its
  shape, the popup will show the "unavailable" error state until the code
  is updated.
- Only English strings are provided (`_locales/en`); the i18n plumbing is in
  place for further locales but none are translated yet.
