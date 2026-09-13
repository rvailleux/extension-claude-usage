#!/usr/bin/env bash
# Lints, packages, and (optionally) signs the extension via Mozilla's AMO API.
#
# Usage:
#   ./scripts/package.sh                # lint + build an unsigned zip
#   ./scripts/package.sh --sign          # lint + build + sign -> installable .xpi
#   ./scripts/package.sh --sign --channel listed   # sign for full AMO listing/review
#
# Signing requires AMO API credentials (JWT issuer/secret) from:
#   https://addons.mozilla.org/developers/addon/api/key/
# Provide them either as already-exported env vars:
#   export JWT_ISSUER=your-jwt-issuer
#   export JWT_SECRET=your-jwt-secret
# or in a .env file next to this script's project root (loaded automatically
# when --sign is used):
#   JWT_ISSUER=your-jwt-issuer
#   JWT_SECRET=your-jwt-secret
#
# Requires network access on first run (downloads web-ext via npx; cached
# afterwards). Nothing is installed into the project itself - no
# package.json/node_modules is added, keeping this a no-build-step extension.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ARTIFACTS_DIR="web-ext-artifacts"
DO_SIGN=false
CHANNEL="unlisted" # unlisted = self-distribute the signed .xpi yourself, no AMO review/listing.

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (used to read name/version from manifest.json) but was not found in PATH." >&2
  exit 1
fi

# Output filename: <slugified manifest name>-<version>, e.g. "claude-usage-ring-1.0.1".
# manifest.json's "name" may be an i18n placeholder (__MSG_key__) rather than
# a literal string; resolve it via _locales/<default_locale>/messages.json so
# the output isn't literally named e.g. "msg-extname-1.0.5.zip".
MANIFEST_NAME="$(jq -r '.name' manifest.json)"
if [[ "$MANIFEST_NAME" =~ ^__MSG_(.+)__$ ]]; then
  MSG_KEY="${BASH_REMATCH[1]}"
  DEFAULT_LOCALE="$(jq -r '.default_locale // "en"' manifest.json)"
  MESSAGES_FILE="_locales/$DEFAULT_LOCALE/messages.json"
  if [[ -f "$MESSAGES_FILE" ]]; then
    MANIFEST_NAME="$(jq -r --arg k "$MSG_KEY" '.[$k].message // empty' "$MESSAGES_FILE")"
  fi
  if [[ -z "$MANIFEST_NAME" ]]; then
    echo "Couldn't resolve manifest name placeholder __MSG_${MSG_KEY}__ from $MESSAGES_FILE" >&2
    exit 1
  fi
fi
MANIFEST_VERSION="$(jq -r '.version' manifest.json)"
SLUG="$(echo "$MANIFEST_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
OUTPUT_BASENAME="${SLUG}-${MANIFEST_VERSION}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sign)
      DO_SIGN=true
      shift
      ;;
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--sign] [--channel listed|unlisted]" >&2
      exit 1
      ;;
  esac
done

if [[ "$CHANNEL" != "listed" && "$CHANNEL" != "unlisted" ]]; then
  echo "Invalid --channel '$CHANNEL' (must be 'listed' or 'unlisted')" >&2
  exit 1
fi

# Files that belong in the repo but not in the shipped extension package.
IGNORE_ARGS=(
  --ignore-files "README.md"
  --ignore-files "scripts/**"
  --ignore-files "*.sh"
  --ignore-files "$ARTIFACTS_DIR/**"
  --ignore-files ".git/**"
)

echo "==> Linting extension"
npx --yes web-ext@latest lint --source-dir .

if [[ "$DO_SIGN" == false ]]; then
  echo "==> Building unsigned package"
  npx --yes web-ext@latest build \
    --source-dir . \
    --artifacts-dir "$ARTIFACTS_DIR" \
    --filename "${OUTPUT_BASENAME}.zip" \
    --overwrite-dest \
    "${IGNORE_ARGS[@]}"

  echo "==> Done. Unsigned zip written to $ARTIFACTS_DIR/ (temporary-install only)."
  ls -la "$ARTIFACTS_DIR"
  exit 0
fi

# Load .env (if present) without executing it - plain KEY=VALUE lines only,
# and without ever echoing the values.
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "==> Loading credentials from .env"
  while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    [[ -z "$key" || "$key" == \#* ]] && continue
    value="${value%$'\r'}"
    export "$key=$value"
  done < "$ENV_FILE"
fi

if [[ -z "${JWT_ISSUER:-}" || -z "${JWT_SECRET:-}" ]]; then
  echo "==> --sign requires AMO API credentials." >&2
  echo "    Get a key/secret pair at:" >&2
  echo "      https://addons.mozilla.org/developers/addon/api/key/" >&2
  echo "    Then either export:" >&2
  echo "      export JWT_ISSUER=your-jwt-issuer" >&2
  echo "      export JWT_SECRET=your-jwt-secret" >&2
  echo "    or put JWT_ISSUER/JWT_SECRET in $ENV_FILE" >&2
  exit 1
fi

# web-ext's flags are named --api-key/--api-secret; map our JWT_* naming onto them.
export WEB_EXT_API_KEY="$JWT_ISSUER"
export WEB_EXT_API_SECRET="$JWT_SECRET"

echo "==> Building and signing package (channel: $CHANNEL)"
# web-ext sign builds the zip itself from --source-dir; reads WEB_EXT_API_KEY /
# WEB_EXT_API_SECRET from the environment automatically. Unlike `build`, `sign`
# has no --filename flag - it names the downloaded .xpi after the AMO-assigned
# extension id, so rename it to our convention afterwards.
BEFORE_XPIS="$(ls -1 "$ARTIFACTS_DIR"/*.xpi 2>/dev/null || true)"

npx --yes web-ext@latest sign \
  --source-dir . \
  --artifacts-dir "$ARTIFACTS_DIR" \
  --channel "$CHANNEL" \
  "${IGNORE_ARGS[@]}"

NEW_XPI="$(comm -13 <(echo "$BEFORE_XPIS" | sort) <(ls -1 "$ARTIFACTS_DIR"/*.xpi 2>/dev/null | sort) | head -n1)"
if [[ -z "$NEW_XPI" ]]; then
  # Fallback: most recently modified .xpi, in case the filename happened to
  # already exist (e.g. an identical previous artifact wasn't cleaned up).
  NEW_XPI="$(ls -t "$ARTIFACTS_DIR"/*.xpi 2>/dev/null | head -n1)"
fi
if [[ -n "$NEW_XPI" ]]; then
  mv -f "$NEW_XPI" "$ARTIFACTS_DIR/${OUTPUT_BASENAME}.xpi"
fi

echo "==> Done. Signed .xpi written to $ARTIFACTS_DIR/${OUTPUT_BASENAME}.xpi (install directly, no dev flags needed)."
ls -la "$ARTIFACTS_DIR"
