// 双轨同步：localStorage 镜像 + BroadcastChannel + 可选服务端轮询
import { KEYS, safeGet, safeSet } from './store.js'
import { roomId as roomFromToken } from './share-codec.js'

export { roomFromToken as roomId }

const PING_TTL_MS = 30000
const PING_TIMEOUT_MS = 1500
const POLL_MS = 4000

const pingCache = { at: 0, ok: false }

export function makeEvent(type, segId, data, now = Date.now()) {
  return {
    id: 'ev' + now.toString(36) + Math.random().toString(36).slice(2, 8),
    type,
    segId: String(segId || ''),
    at: now,
    data: data || {},
  }
}

async function fetchJson(url, opts, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 3000)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function probeSync({ now = Date.now(), force = false } = {}) {
  if (!force && now - pingCache.at < PING_TTL_MS) return pingCache.ok
  pingCache.at = now
  pingCache.ok = false
  try {
    const data = await fetchJson('/api/sync/ping', { method: 'GET' }, PING_TIMEOUT_MS)
    pingCache.ok = !!(data && data.ok)
  } catch {
    pingCache.ok = false
  }
  return pingCache.ok
}

export function syncMode() {
  return pingCache.ok ? 'server' : 'device'
}

function readMirror(room) {
  const m = safeGet(KEYS.syncPrefix + room, null)
  if (!m || typeof m !== 'object') return { events: [], presence: null }
  return {
    events: Array.isArray(m.events) ? m.events : [],
    presence: m.presence && typeof m.presence === 'object' ? m.presence : null,
  }
}

function writeMirror(room, events, presence) {
  safeSet(KEYS.syncPrefix + room, { events: events.slice(-200), presence })
}

export function push(room, events, presence) {
  if (!room) return
  const cur = readMirror(room)
  const seen = new Set(cur.events.map(e => e.id))
  const merged = [...cur.events, ...(events || []).filter(e => !seen.has(e.id))]
  const nextPresence = presence || cur.presence
  writeMirror(room, merged, nextPresence)
  try {
    const ch = new BroadcastChannel('ptb-sync-' + room)
    ch.postMessage({ events: events || [], presence: nextPresence })
    ch.close()
  } catch { /* 无 BroadcastChannel 时静默 */ }
  if (pingCache.ok) {
    fetchJson(`/api/sync/${encodeURIComponent(room)}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: events || [], presence: nextPresence }),
    }, 3000).catch(() => {})
  }
}

export function subscribe(room, onChange) {
  if (!room || typeof onChange !== 'function') return () => {}
  let stopped = false
  let cursor = 0
  let pollTimer = null
  let bc = null

  const seen = new Set()
  const deliver = (events, presence) => {
    const fresh = (events || []).filter(e => e && e.id && !seen.has(e.id))
    for (const e of fresh) seen.add(e.id)
    if (fresh.length || presence) onChange(fresh, presence)
  }

  const mirror = readMirror(room)
  deliver(mirror.events, mirror.presence)

  try {
    bc = new BroadcastChannel('ptb-sync-' + room)
    bc.onmessage = (msg) => {
      const d = msg.data || {}
      deliver(d.events, d.presence)
    }
    window.addEventListener('storage', onStorage)
  } catch { /* 静默 */ }

  function onStorage(ev) {
    if (ev.key === KEYS.syncPrefix + room) {
      const m = readMirror(room)
      deliver(m.events, m.presence)
    }
  }

  async function poll() {
    if (stopped || document.hidden || !pingCache.ok) return
    try {
      const data = await fetchJson(`/api/sync/${encodeURIComponent(room)}/pull?since=${cursor}`, { method: 'GET' }, 3000)
      if (data && data.ok) {
        cursor = data.cursor || cursor
        deliver(data.events, data.presence)
      }
    } catch { /* 静默 */ }
  }

  function startPolling() {
    stopPolling()
    if (pingCache.ok) {
      pollTimer = setInterval(poll, POLL_MS)
      poll()
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const onVis = () => {
    if (document.hidden) stopPolling()
    else startPolling()
  }
  document.addEventListener('visibilitychange', onVis)

  probeSync({ force: true }).then(ok => {
    if (ok && !stopped) startPolling()
  })

  return () => {
    stopped = true
    stopPolling()
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('storage', onStorage)
    if (bc) {
      bc.close()
      bc = null
    }
  }
}
