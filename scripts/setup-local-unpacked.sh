#!/usr/bin/env bash
set -euo pipefail

DUMMY_OAUTH_CLIENT_ID="dummy.apps.googleusercontent.com"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
ENV_FILE="$PROJECT_ROOT/.env.local"

OPEN_BROWSER="${OPEN_BROWSER:-1}"

step() {
	printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

info() {
	printf '    %s\n' "$1"
}

warn() {
	printf '\033[1;33mWarning:\033[0m %s\n' "$1"
}

fail() {
	printf '\033[1;31mError:\033[0m %s\n' "$1" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: scripts/setup-local-unpacked.sh [options]

Guided local setup for Bookmark AI Extension as an unpacked Chrome extension.
The script runs builds and writes .env.local, but Google Cloud OAuth setup,
Chrome Load unpacked, and Chrome extension reload remain manual confirmation
steps.

Options:
  --no-open       Do not try to open Chrome/Google Cloud Console URLs.
  -h, --help      Show this help and exit without running setup steps.

Environment:
  OPEN_BROWSER=0  Same as --no-open.
EOF
}

pause() {
	local prompt="${1:-Press Enter to continue...}"
	printf '\n%s' "$prompt"
	if ! read -r _; then
		fail "Input is required to continue. Re-run this script in an interactive shell."
	fi
}

prompt_required() {
	local prompt="$1"
	local value=""
	while [ -z "$value" ]; do
		printf '%s' "$prompt"
		if ! read -r value; then
			fail "Input is required. Re-run this script in an interactive shell."
		fi
		value="$(printf '%s' "$value" | tr -d '[:space:]')"
	done
	printf '%s' "$value"
}

open_url() {
	local url="$1"
	if [ "$OPEN_BROWSER" = "0" ]; then
		info "Browser auto-open disabled. Open manually: $url"
		return 0
	fi

	if command -v open >/dev/null 2>&1; then
		if [ -d "/Applications/Google Chrome.app" ]; then
			open -a "Google Chrome" "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1 || true
		else
			open "$url" >/dev/null 2>&1 || true
		fi
	elif command -v xdg-open >/dev/null 2>&1; then
		xdg-open "$url" >/dev/null 2>&1 || true
	elif command -v cmd.exe >/dev/null 2>&1; then
		cmd.exe /c start "" "$url" >/dev/null 2>&1 || true
	else
		info "Could not auto-open a browser. Open manually: $url"
	fi
}

write_env_client_id() {
	local client_id="$1"

	if [ -f "$ENV_FILE" ]; then
		local backup="$ENV_FILE.backup.$(date +%Y%m%d%H%M%S)"
		cp "$ENV_FILE" "$backup"
		info "Backed up existing .env.local to ${backup#$PROJECT_ROOT/}"
	fi

	local tmp
	tmp="$(mktemp)"
	if [ -f "$ENV_FILE" ]; then
		awk -v id="$client_id" '
			BEGIN { replaced = 0 }
			/^VITE_GOOGLE_OAUTH_CLIENT_ID=/ {
				print "VITE_GOOGLE_OAUTH_CLIENT_ID=" id
				replaced = 1
				next
			}
			{ print }
			END {
				if (replaced == 0) {
					print "VITE_GOOGLE_OAUTH_CLIENT_ID=" id
				}
			}
		' "$ENV_FILE" > "$tmp"
	else
		printf 'VITE_GOOGLE_OAUTH_CLIENT_ID=%s\n' "$client_id" > "$tmp"
	fi
	mv "$tmp" "$ENV_FILE"
}

validate_client_id() {
	local client_id="$1"
	case "$client_id" in
		*.apps.googleusercontent.com) return 0 ;;
		*)
			warn "Client ID does not end with .apps.googleusercontent.com. Continuing because Google may change formats."
			return 0
			;;
	esac
}

validate_extension_id() {
	local extension_id="$1"
	case "$extension_id" in
		????????????????????????????????) return 0 ;;
		*)
			warn "Chrome extension IDs are usually 32 characters. Please double-check: $extension_id"
			return 0
			;;
	esac
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--no-open)
			OPEN_BROWSER=0
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			usage >&2
			fail "Unknown option: $1"
			;;
	esac
done

cd "$PROJECT_ROOT"

step "Bookmark AI Extension local unpacked setup"
info "Repository: $PROJECT_ROOT"
info "This script automates builds and .env.local updates, then guides the Chrome/Google Cloud manual steps."
info "It cannot click Chrome's Load unpacked/reload buttons or create Google Cloud OAuth clients for you."

step "Check prerequisites"
command -v bun >/dev/null 2>&1 || fail "bun is required but was not found on PATH."
info "bun: $(bun --version)"

if command -v just >/dev/null 2>&1; then
	info "just: available"
else
	warn "just was not found. The setup can continue, but project validation recipes require just."
fi

step "Install dependencies"
info "Running bun install"
bun install

step "Build once with dummy OAuth client ID"
info "Running dummy build to create dist/ and obtain a local unpacked extension ID."
VITE_GOOGLE_OAUTH_CLIENT_ID="$DUMMY_OAUTH_CLIENT_ID" bun run build
[ -d "$DIST_DIR" ] || fail "dist/ was not created."
info "Built: $DIST_DIR"

step "Load dist/ in Chrome"
open_url "chrome://extensions"
cat <<EOF

In Chrome:
  1. Open chrome://extensions.
  2. Enable Developer mode.
  3. Click Load unpacked.
  4. Select this directory:

     $DIST_DIR

  5. Copy the generated Extension ID from the extension card.
EOF

extension_id="$(prompt_required "\nPaste the local unpacked Extension ID, then press Enter: ")"
validate_extension_id "$extension_id"

step "Open Google Cloud Console pages"
cat <<EOF

Use Google Cloud Console to prepare OAuth:
  1. Enable Google Drive API.
  2. Configure OAuth consent screen.
  3. Create OAuth client ID:
     - Application type: Chrome Extension
     - Extension ID: $extension_id
EOF

open_url "https://console.cloud.google.com/apis/library/drive.googleapis.com"
pause "\nPress Enter after the Drive API is enabled or already confirmed... "

open_url "https://console.cloud.google.com/apis/credentials/consent"
pause "\nPress Enter after the OAuth consent screen is configured and your account is allowed as a test user... "

open_url "https://console.cloud.google.com/apis/credentials"
cat <<EOF

Create credentials in Google Cloud Console:
  1. Click Create credentials -> OAuth client ID.
  2. Select Chrome Extension.
  3. Paste this Extension ID:

     $extension_id

  4. Create the client and copy the generated Client ID.
EOF

client_id="$(prompt_required "\nPaste the dev OAuth Client ID, then press Enter: ")"
validate_client_id "$client_id"

step "Write .env.local"
write_env_client_id "$client_id"
info "Updated ${ENV_FILE#$PROJECT_ROOT/}"
info "Do not commit .env.local. It is ignored by .gitignore."

step "Rebuild with real dev OAuth client ID"
bun run build

step "Reload the unpacked extension"
open_url "chrome://extensions/?id=$extension_id"
cat <<EOF

Back in Chrome:
  1. Find Bookmark AI Extension.
  2. Click the reload button on the extension card.
  3. Confirm the extension remains enabled.
  4. Open a normal web page, open the extension popup, and click Save.
  5. Confirm Google OAuth asks only for drive.file access.

If reload or OAuth fails, see docs/local-unpacked-setup.md Troubleshooting.
EOF

pause "\nPress Enter after you have reloaded the extension (or press Ctrl+C to stop here)... "

step "Next manual smoke steps"
cat <<EOF

Local setup automation is complete.

Recommended next checks:
  - Save a normal page from the popup.
  - Verify Google Drive contains bookmark-ai/bookmarks.jsonl.
  - Open options and confirm list/search/delete behavior.
  - Record the formal run in docs/smoke-checklist.md before Web Store submission.

Useful docs:
  - docs/local-unpacked-setup.md
  - docs/smoke-checklist.md
  - docs/publication.md
EOF
