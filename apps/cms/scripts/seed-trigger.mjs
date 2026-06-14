const CMS_URL = process.env.CMS_URL || 'http://localhost:3000'
const SEED_SECRET = process.env.SEED_SECRET || ''
const MAX_RETRIES = 30
const RETRY_DELAY = 2000

async function waitForServer() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(`${CMS_URL}/api/categories`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) return
    } catch {}
    console.log(`Waiting for CMS server... (${i + 1}/${MAX_RETRIES})`)
    await new Promise(r => setTimeout(r, RETRY_DELAY))
  }
  throw new Error('CMS server did not become ready')
}

async function triggerSeed() {
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (SEED_SECRET) headers['Authorization'] = `Bearer ${SEED_SECRET}`

    const res = await fetch(`${CMS_URL}/api/seed`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(120000),
    })

    const data = await res.json()
    if (res.ok) {
      console.log('Seed completed:', data.results?.join(', ') || 'ok')
    } else {
      console.error('Seed failed:', data.error || data)
    }
  } catch (err) {
    console.error('Seed trigger error:', err.message)
  }
}

await waitForServer()
await triggerSeed()
