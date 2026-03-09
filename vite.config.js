import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

function leaderboardProxyPlugin() {
  return {
    name: 'leaderboard-proxy',
    configureServer(server) {
      server.middlewares.use('/api/lb', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }

        const env = loadEnv(server.config.mode, process.cwd(), '')
        const apiBaseUrl = (env.LB_API_BASE_URL || env.VITE_LB_API_BASE_URL || 'https://roobetconnect.com').replace(
          /\/+$/,
          '',
        )
        const apiToken = env.LB_API_JWT || env.VITE_LB_API_JWT || ''
        const configuredUserId = env.LB_API_USER_ID || env.VITE_LB_API_USER_ID || ''
        const configuredCategories = env.LB_API_CATEGORIES || env.VITE_LB_API_CATEGORIES || ''

        if (!apiToken) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'Missing LB_API_JWT (or VITE_LB_API_JWT)' }))
          return
        }

        const reqUrl = new URL(req.url || '', 'http://127.0.0.1')
        const startDate = reqUrl.searchParams.get('startDate') || reqUrl.searchParams.get('from') || ''
        const endDate = reqUrl.searchParams.get('endDate') || ''
        const sortBy = reqUrl.searchParams.get('sortBy') || 'wagered'
        const categories = reqUrl.searchParams.get('categories') || configuredCategories || ''
        const providers = reqUrl.searchParams.get('providers') || ''
        const gameIdentifiers = reqUrl.searchParams.get('gameIdentifiers') || ''
        const userId = reqUrl.searchParams.get('userId') || configuredUserId

        if (!userId) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'Missing LB_API_USER_ID (or VITE_LB_API_USER_ID)' }))
          return
        }

        const upstreamParams = new URLSearchParams({
          userId,
          sortBy,
        })
        if (startDate) {
          upstreamParams.set('startDate', startDate)
        }
        if (endDate) {
          upstreamParams.set('endDate', endDate)
        }
        if (categories) {
          upstreamParams.set('categories', categories)
        }
        if (providers) {
          upstreamParams.set('providers', providers)
        }
        if (gameIdentifiers) {
          upstreamParams.set('gameIdentifiers', gameIdentifiers)
        }

        const targetUrl = `${apiBaseUrl}/affiliate/v2/stats?${upstreamParams.toString()}`

        try {
          const upstream = await fetch(targetUrl, {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              Accept: 'application/json',
            },
          })

          const bodyText = await upstream.text()

          if (!upstream.ok) {
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(
              JSON.stringify({
                ok: false,
                error: 'Upstream affiliate stats request failed',
                status: upstream.status,
                targetUrl,
                body: bodyText,
              }),
            )
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(bodyText)
        } catch {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'Network error calling affiliate stats API', targetUrl }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), leaderboardProxyPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
