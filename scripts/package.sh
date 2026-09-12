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
# WEB_EXT_API_SECRET from the environment automatically.
npx --yes web-ext@latest sign \
  --source-dir . \
  --artifacts-dir "$ARTIFACTS_DIR" \
  --channel "$CHANNEL" \
  "${IGNORE_ARGS[@]}"

echo "==> Done. Signed .xpi written to $ARTIFACTS_DIR/ (install directly, no dev flags needed)."
ls -la "$ARTIFACTS_DIR"
