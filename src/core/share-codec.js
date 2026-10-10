// 分享链接编解码：FNV-1a 校验和 + base64url 载荷 + v2 紧凑字段
import { packCards, expandCards } from './agents.js'

export function fnv1a(str) {
  const s = String(str)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// base64url：走 btoa/atob（浏览器与 Node 16+ 均原生支持），解码产物必须是
// Uint8Array —— TextDecoder 只认 BufferSource，普通数组会直接抛 TypeError。
function bytesToB64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlToBytes(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  let bin
  try { bin = atob(s + pad) } catch { return null }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const te = new TextEncoder()
const td = new TextDecoder()

export function DEFAULT_TTL_DAYS() { return 30 }

// payload 完整视图：{ title, exp(ms), cards, contacts, prefs, eid?, gen? }
export function encodeShare(payload) {
  const eid = payload.eid || ('e' + Date.now().toString(36))
  const gen = payload.gen || Date.now()
  const exp = payload.exp || (Date.now() + DEFAULT_TTL_DAYS() * 86400000)
  const compact = {
    v: 2,
    t: String(payload.title || '行程').slice(0, 60),
    x: Math.floor(exp / 1000).toString(36),
    c: packCards(payload.cards || []),
  }
  const contacts = (payload.contacts || []).filter(p => p && p.name)
  if (contacts.length) {
    compact.p = contacts.map(p => [p.name, p.phone || '', p.relation || '', p.im || '', p.note || ''])
  }
  const prefs = payload.prefs || {}
  const f = [prefs.scale ?? 1, prefs.theme || 'day', prefs.shareLocation ? 1 : 0]
  compact.f = f

  const json = JSON.stringify(compact)
  const sum = fnv1a(json).toString(36).padStart(7, '0')
  const body = bytesToB64Url(te.encode(json))
  return { token: sum + '.' + body, eid, gen, exp }
}

export function decodeShare(token) {
  const t = String(token || '')
  const dot = t.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const sum = t.slice(0, dot)
  const bytes = b64UrlToBytes(t.slice(dot + 1))
  if (!bytes) return { ok: false, reason: 'malformed' }
  let json
  try { json = td.decode(bytes) } catch { return { ok: false, reason: 'malformed' } }
  if (fnv1a(json).toString(36).padStart(7, '0') !== sum) return { ok: false, reason: 'malformed' }
  let raw
  try { raw = JSON.parse(json) } catch { return { ok: false, reason: 'malformed' } }
  if (!raw || typeof raw !== 'object' || raw.v !== 2 || typeof raw.t !== 'string' || typeof raw.x !== 'string' || !Array.isArray(raw.c)) {
    return { ok: false, reason: 'malformed' }
  }
  const expSec = parseInt(raw.x, 36)
  if (!Number.isFinite(expSec)) return { ok: false, reason: 'malformed' }
  const exp = expSec * 1000
  const f = Array.isArray(raw.f) ? raw.f : [1, 'day', 0]
  const payload = {
    title: raw.t,
    exp,
    cards: expandCards(raw.c),
    contacts: (raw.p || []).filter(Array.isArray).map(p => ({
      name: String(p[0] || ''), phone: String(p[1] || ''), relation: String(p[2] || ''),
      im: String(p[3] || ''), note: String(p[4] || ''),
    })),
    prefs: {
      scale: [1, 1.12, 1.25].includes(f[0]) ? f[0] : 1,
      theme: ['day', 'contrast', 'night'].includes(f[1]) ? f[1] : 'day',
      shareLocation: !!f[2],
    },
  }
  if (Date.now() > exp) return { ok: false, reason: 'expired', payload }
  return { ok: true, payload }
}

export function makeShareCode(payload) {
  const material = (payload.eid || '') + '|' + (payload.gen || '') + '|' + (payload.title || '')
  const h = fnv1a(material)
  return String(h % 1000000).padStart(6, '0')
}

export function extractToken(text) {
  const m = String(text || '').match(/([0-9a-z]{7,8}\.[A-Za-z0-9_-]{16,})/)
  return m ? m[1] : ''
}

export function buildShareUrl(token) {
  const base = location.origin + location.pathname
  return base + '#/e/' + token
}

// room = 双重 FNV-1a，各 36 进制 7 位，拼成 14 位
export function roomId(token) {
  const h1 = fnv1a(String(token || ''))
  const s1 = h1.toString(36).padStart(7, '0')
  const h2 = fnv1a(s1)
  const s2 = h2.toString(36).padStart(7, '0')
  return s1 + s2
}
