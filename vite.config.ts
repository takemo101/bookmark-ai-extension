import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { resolveOAuthClientId } from './config/oauth-client-id'
import { createManifest } from './manifest.config'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // `vite build` produces the loadable extension, so the OAuth client ID is
  // mandatory there. `vite dev` may use the documented dev placeholder.
  const oauthClientId = resolveOAuthClientId(env.VITE_GOOGLE_OAUTH_CLIENT_ID, {
    requireForBuild: command === 'build',
  })

  return {
    plugins: [react(), crx({ manifest: createManifest(oauthClientId) })],
  }
})
