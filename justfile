# Developer automation for the Bookmark AI Extension.
# Run `just` (or `just --list`) to see the available recipes.
#
# The package.json scripts are the single source of truth for the validation
# baseline. These recipes and lefthook.yml both call those scripts so humans and
# AI workers share one stable command surface (see README.md "Development").

set dotenv-load := false

# Non-functional placeholder OAuth client ID for compile-only builds.
# Extension/production builds must use a real dev/prod client ID via .env.local
# (see README.md and docs/publication.md); this placeholder only lets
# `just validate` confirm the bundle compiles without needing real OAuth values.
dummy_oauth_client_id := "dummy.apps.googleusercontent.com"

# List available recipes (default target).
default:
    @just --list

# Install project dependencies with Bun.
install:
    bun install

# Install the lefthook git hooks for this checkout.
hooks-install:
    bunx lefthook install

# Run the pre-commit hook baseline without creating a commit.
hooks-run:
    bunx lefthook run pre-commit --force

# Type-check the project (tsc --noEmit).
typecheck:
    bun run typecheck

# Run the Vitest suite once.
test:
    bun run test

# Run the format check + type-check + test baseline.
check:
    bun run check

# Check repository formatting without writing changes.
format-check:
    bun run format:check

# Apply repository-wide formatting.
fix:
    bun run fix

# Requires VITE_GOOGLE_OAUTH_CLIENT_ID (.env.local or the environment); fails
# clearly when unset, as production builds never fall back to a placeholder.
#
# Build the extension bundle into dist/.
build:
    bun run build

# Supplies a dummy OAuth client ID for the compile-only build unless
# VITE_GOOGLE_OAUTH_CLIENT_ID is already set, so it runs without real OAuth
# values. AI workers should use this as the default final check.
#
# Aggregate local validation baseline: typecheck + test + build.
validate:
    VITE_GOOGLE_OAUTH_CLIENT_ID="${VITE_GOOGLE_OAUTH_CLIENT_ID:-{{ dummy_oauth_client_id }}}" bun run validate
