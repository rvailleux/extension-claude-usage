# vendor/

Third-party files committed directly instead of via npm, to keep this a
no-build-step extension (see README.md's "no build step" note).

## browser-polyfill.js

Mozilla's [webextension-polyfill](https://github.com/mozilla/webextension-polyfill),
MPL-2.0 licensed. Provides the `browser.*` promise-based namespace on
Chrome/Edge (a no-op on Firefox, which already has `browser`).

To update to a newer release:

```
curl -sL https://unpkg.com/webextension-polyfill@<version>/dist/browser-polyfill.js -o vendor/browser-polyfill.js
```

Current version: 0.12.0.
