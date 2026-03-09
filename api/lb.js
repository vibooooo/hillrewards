export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const apiBaseUrl = (process.env.LB_API_BASE_URL || 'https://roobetconnect.com').replace(/\/+$/, '')
  const apiToken = process.env.LB_API_JWT || ''
  const configuredUserId = process.env.LB_API_USER_ID || ''
  const configuredCategories = process.env.LB_API_CATEGORIES || ''

  if (!apiToken) {
    res.status(500).json({ ok: false, error: 'Missing LB_API_JWT' })
    return
  }

  const query = req.query || {}
  const startDate = String(query.startDate || query.from || '')
  const endDate = String(query.endDate || '')
  const sortBy = String(query.sortBy || 'wagered')
  const categories = String(query.categories || configuredCategories || '')
  const providers = String(query.providers || '')
  const gameIdentifiers = String(query.gameIdentifiers || '')
  const userId = String(query.userId || configuredUserId || '')

  if (!userId) {
    res.status(500).json({ ok: false, error: 'Missing LB_API_USER_ID' })
    return
  }

  const upstreamParams = new URLSearchParams({ userId, sortBy })
  if (startDate) upstreamParams.set('startDate', startDate)
  if (endDate) upstreamParams.set('endDate', endDate)
  if (categories) upstreamParams.set('categories', categories)
  if (providers) upstreamParams.set('providers', providers)
  if (gameIdentifiers) upstreamParams.set('gameIdentifiers', gameIdentifiers)

  const targetUrl = `${apiBaseUrl}/affiliate/v2/stats?${upstreamParams.toString()}`

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
      },
    })

    const bodyText = await upstream.text()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (!upstream.ok) {
      res.status(upstream.status).send(
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

    res.status(200).send(bodyText)
  } catch {
    res.status(502).json({ ok: false, error: 'Network error calling affiliate stats API', targetUrl })
  }
}
