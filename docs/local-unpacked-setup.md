# Local Unpacked Setup Guide

This guide explains how to start using Bookmark AI Extension locally as an
unpacked Chrome extension. It is intended for personal testing and manual smoke
runs before Chrome Web Store submission.

> Status: local use is OK after the steps below. Public Chrome Web Store
> submission still requires the manual smoke checklist in
> [`smoke-checklist.md`](./smoke-checklist.md) to be executed and recorded.

## What this setup creates

After setup, the extension will:

- run from the local `dist/` build loaded via `chrome://extensions`;
- request Google OAuth with only the `drive.file` scope;
- create or reuse a visible Google Drive folder named `bookmark-ai/`;
- store bookmarks in `bookmark-ai/bookmarks.jsonl`;
- use Chrome Built-in AI / Prompt API when available;
- still save bookmarks with `aiStatus: "unavailable"` when Prompt API is not
  available.

The extension does **not** store raw page excerpts and does **not** use external
AI APIs in the MVP.

## Prerequisites

Install or prepare:

1. Bun, matching the project tooling.
2. Google Chrome.
3. Access to a Google account that can create or configure a Google Cloud
   project.
4. A Google Cloud project with the Google Drive API enabled.
5. An OAuth consent screen configured for local testing.
6. If you want to test the AI-ready path, a Chrome channel/configuration where
   Chrome Built-in AI / Prompt API is available.

The AI-unavailable path can be tested on normal Chrome without Prompt API.

## Guided setup script

You can use the guided shell script for the build and prompt-driven parts of
this setup:

```sh
scripts/setup-local-unpacked.sh
```

The script automates dependency installation, the dummy build, `.env.local`
updates, and the real rebuild. It also opens the relevant Chrome and Google
Cloud Console pages when possible. The following steps still require manual
confirmation in Chrome or Google Cloud Console:

- loading `dist/` with **Load unpacked**;
- creating/configuring the Google Cloud OAuth client;
- pasting the generated extension ID and OAuth client ID back into the script;
- clicking the Chrome extension reload button.

Use this when you want a guided flow. Use the manual steps below when you want
to perform each command yourself.

To print help without running setup steps:

```sh
scripts/setup-local-unpacked.sh --help
```

To avoid opening browser tabs automatically:

```sh
scripts/setup-local-unpacked.sh --no-open
```

## Step 1: Install dependencies

From the repository root:

```sh
bun install
```

Optional sanity check:

```sh
just validate
```

`just validate` injects a dummy OAuth client ID for compile-only validation. It
proves the project builds, but it does not make real Google OAuth work.

## Step 2: Build once with a dummy OAuth client ID

A Chrome Extension OAuth client must be bound to the extension ID. For an
unpacked extension, Chrome generates that ID after the extension is loaded.
Build once with a dummy value so Chrome can load `dist/` and show the local ID:

```sh
VITE_GOOGLE_OAUTH_CLIENT_ID=dummy.apps.googleusercontent.com bun run build
```

This build is only for obtaining the local unpacked extension ID. Do not use it
for real sign-in.

## Step 3: Load `dist/` as an unpacked extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository's `dist/` directory.
6. Copy the generated **Extension ID** shown on the extension card.

Keep this Chrome tab open. You will reload the same unpacked extension after
creating the real OAuth client.

## Step 4: Enable Google Drive API

In Google Cloud Console:

1. Open or create the Google Cloud project for local development.
2. Go to **APIs & Services** → **Library**.
3. Search for **Google Drive API**.
4. Enable it.

The extension only needs Drive API access for the app-created
`bookmark-ai/bookmarks.jsonl` file.

## Step 5: Configure the OAuth consent screen

In Google Cloud Console:

1. Go to **APIs & Services** → **OAuth consent screen**.
2. Choose the user type appropriate for your account/project.
3. Set the app name and support email.
4. Add yourself as a test user if the consent screen is in testing mode.
5. Keep the scope explanation aligned with the MVP: the extension uses only
   `https://www.googleapis.com/auth/drive.file`.

For local testing, it is acceptable for the OAuth app to remain in testing mode
as long as your Google account is allowed as a test user.

## Step 6: Create the development OAuth client

In Google Cloud Console:

1. Go to **APIs & Services** → **Credentials**.
2. Click **Create credentials** → **OAuth client ID**.
3. Select application type **Chrome Extension**.
4. Paste the local unpacked **Extension ID** copied from `chrome://extensions`.
5. Create the client.
6. Copy the generated OAuth client ID. It should look like:

   ```txt
   xxxxx.apps.googleusercontent.com
   ```

This client ID is not a secret, but keep local development values out of commits
so dev and production environments remain separate.

## Step 7: Create `.env.local`

Create `.env.local` in the repository root:

```env
VITE_GOOGLE_OAUTH_CLIENT_ID=<your-dev-client-id>.apps.googleusercontent.com
```

Do not commit `.env.local`.

## Step 8: Rebuild with the real dev OAuth client ID

Run:

```sh
bun run build
```

The build reads `.env.local` and injects the dev OAuth client ID into the
extension manifest.

If this fails with a missing OAuth client ID error, confirm that `.env.local` is
in the repository root and the variable name is exactly
`VITE_GOOGLE_OAUTH_CLIENT_ID`.

## Step 9: Reload the unpacked extension

Back in `chrome://extensions`:

1. Find the Bookmark AI Extension card.
2. Click the reload button.
3. Confirm the extension stays enabled.

If Chrome shows a manifest or OAuth-related error, rebuild and reload again
after fixing the configuration.

## Step 10: First real save and OAuth consent

1. Open a normal web page in Chrome.
2. Open the Bookmark AI Extension popup.
3. Click the save/analyze action.
4. Chrome should show a Google OAuth consent prompt.
5. Confirm the requested access is only `drive.file`:
   `See, edit, create, and delete only the specific Google Drive files you use
   with this app`.
6. Grant access.

After consent, the extension should save the current page. The popup connection
badge should read connected on a later open.

## Step 11: Verify Google Drive output

Open Google Drive and verify:

1. A visible folder named `bookmark-ai/` exists.
2. The folder contains `bookmarks.jsonl`.
3. The file contains one JSON line for the saved page.
4. The record has fields such as `url`, `canonicalUrl`, `title`, timestamps, and
   `aiStatus`.
5. The record does **not** contain raw page excerpt text.

## Step 12: Test expected runtime paths

At minimum, test these local-use flows:

- save a normal page from the popup;
- open the options page and confirm the bookmark appears;
- search/filter bookmarks in options;
- delete a bookmark and confirm it does not reappear after sync;
- save while Prompt API is unavailable and confirm `aiStatus: "unavailable"`;
- if Prompt API is available, confirm Japanese `description`, `genre`, and
  `tags` are written with `aiStatus: "ready"`.

For the formal pre-release run, use the full
[`smoke-checklist.md`](./smoke-checklist.md) checklist and record each section in
its run record.

## Re-analyze limitation

Re-analysis intentionally follows the MVP permission model:

- the extension uses `activeTab` + `scripting`;
- it can only extract the page that is currently active and user-granted;
- options-page re-analyze for a saved record requires that record's page to be
  the active tab in the current window;
- from an unrelated active tab, the extension should show a safe "open the page
  in the active tab" error and leave the bookmark unchanged.

This avoids broad host permissions and the `tabs` permission.

## Troubleshooting

### OAuth consent does not appear

Check:

- `.env.local` exists and has the real dev client ID.
- You rebuilt with `bun run build` after creating `.env.local`.
- You reloaded the unpacked extension after rebuilding.
- The OAuth client type is **Chrome Extension**.
- The OAuth client is bound to the exact unpacked extension ID shown in
  `chrome://extensions`.
- Your Google account is added as a test user if the OAuth consent screen is in
  testing mode.

### `redirect_uri_mismatch` or OAuth client errors

Usually this means the OAuth client was created for a different extension ID.
Copy the ID again from `chrome://extensions`, update or recreate the Chrome
Extension OAuth client, rebuild, and reload.

### Drive folder or file is not created

Check:

- Google Drive API is enabled in the selected Cloud project.
- OAuth consent was granted successfully.
- The consent screen requested only `drive.file`.
- The extension popup or options page shows a safe sync error.

### Prompt API is unavailable

This is allowed for local MVP use. The extension should still save bookmarks with
`aiStatus: "unavailable"`. Use a Prompt API-enabled Chrome channel only when you
want to verify the AI-ready path.

### Local changes are pending

If Drive is offline or token access fails, local mutations can be marked pending.
Restore Drive connectivity and click **Sync now** or perform another save to push
the cached local state.

## Web Store submission is separate

Do not treat this local setup as production release readiness. Before Chrome Web
Store submission, complete the production flow in [`publication.md`](./publication.md):

1. create a Chrome Web Store draft item;
2. obtain the production extension ID;
3. create a production Chrome Extension OAuth client for that ID;
4. rebuild with the production OAuth client ID;
5. upload the final production package;
6. complete and record the manual smoke checklist.
