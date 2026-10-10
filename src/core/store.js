import { reactive } from 'vue'

export const KEYS = {
  accounts: 'ptb:accounts',
  session: 'ptb:session',
  dataPrefix: 'ptb:data:',
  legacyAuth: 'ptb:auth',
  legacyData: 'ptb:data',
  migrated: 'ptb:migrated',
  elderPrefs: 'ptb:elder:prefs',
  elderStatePrefix: 'ptb:elder:state:',
  syncPrefix: 'ptb:sync:',
  model: 'ptb:model',
}

export const ELDER_SCALES = [1, 1.12, 1.25]
export const ELDER_THEMES = ['day', 'contrast', 'night']

export function elderScaleName(v) {
  return v === 1.25 ? '超大' : v === 1.12 ? '大' : '标准'
}

export function elderThemeName(v) {
  return v === 'night' ? '夜间' : v === 'contrast' ? '高对比' : '日间'
}

export function emptyData() {
  return { trips: [], family: [], shares: [], draft: null }
}

export function safeGet(k, fallback) {
  try {
    const raw = localStorage.getItem(k)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function safeSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch { /* 存储满或被禁用时静默 */ }
}

export function safeDel(k) {
  try { localStorage.removeItem(k) } catch { /* 同上 */ }
}

export function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const store = reactive({
  ready: false,
  account: null,
  data: emptyData(),
  toasts: [],
})

let toastSeq = 0

export function toast(msg, kind = 'info', ms = 2600) {
  const id = ++toastSeq
  store.toasts.push({ id, msg, kind })
  setTimeout(() => {
    const i = store.toasts.findIndex(t => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, ms)
}

function dataKey(accountId) {
  return KEYS.dataPrefix + accountId
}

function persist() {
  if (!store.account) return
  safeSet(dataKey(store.account.id), store.data)
}

function migrateLegacy(accountId) {
  const old = safeGet(KEYS.legacyData, null)
  const bucket = safeGet(dataKey(accountId), null)
  if (!old) return bucket || emptyData()
  const merged = bucket || emptyData()
  for (const list of ['trips', 'family', 'shares']) {
    if (!Array.isArray(old[list])) continue
    const seen = new Set(merged[list].map(x => x && x.id))
    for (const item of old[list]) {
      if (item && typeof item.id === 'string' && !seen.has(item.id)) {
        merged[list].push(item)
        seen.add(item.id)
      }
    }
  }
  if (!merged.draft && old.draft) merged.draft = old.draft
  return merged
}

export function attachAccount(account, data) {
  store.account = account
  store.data = data || migrateLegacy(account.id)
  persist()
}

export function detachAccount() {
  safeDel(KEYS.session)
  store.account = null
  store.data = emptyData()
}

export function initStore() {
  const session = safeGet(KEYS.session, null)
  if (session && typeof session.accountId === 'string') {
    const accounts = safeGet(KEYS.accounts, [])
    const acc = accounts.find(a => a.id === session.accountId)
    if (acc) {
      store.account = acc
      store.data = safeGet(dataKey(acc.id), null) || migrateLegacy(acc.id)
    } else {
      safeDel(KEYS.session)
    }
  }
  store.ready = true
}

export function saveSession(accountId) {
  safeSet(KEYS.session, { accountId, ts: Date.now() })
}

export function mergeBackup(current, incoming) {
  const out = {
    trips: [...current.trips],
    family: [...current.family],
    shares: [...current.shares],
  }
  const added = { trips: 0, family: 0, shares: 0 }
  let skipped = 0
  if (!incoming || typeof incoming !== 'object') {
    return { ok: false, data: current, added, skipped }
  }
  for (const list of ['trips', 'family', 'shares']) {
    if (!Array.isArray(incoming[list])) continue
    const seen = new Set(out[list].map(x => x && x.id))
    for (const item of incoming[list]) {
      if (!item || typeof item.id !== 'string') { skipped++; continue }
      if (seen.has(item.id)) { skipped++; continue }
      out[list].push(item)
      seen.add(item.id)
      added[list]++
    }
  }
  return { ok: true, data: { ...out, draft: current.draft }, added, skipped }
}

export function persistData() { persist() }

export function upsertTrip(trip) {
  const i = store.data.trips.findIndex(t => t.id === trip.id)
  trip.updatedAt = Date.now()
  if (i >= 0) store.data.trips[i] = trip
  else store.data.trips.unshift(trip)
  persist()
}

export function removeTrip(id) {
  const i = store.data.trips.findIndex(t => t.id === id)
  if (i >= 0) store.data.trips.splice(i, 1)
  persist()
}

export function getTrip(id) {
  return store.data.trips.find(t => t.id === id) || null
}

export function setDraft(draft) {
  store.data.draft = draft
  persist()
}

export function clearDraft() {
  store.data.draft = null
  persist()
}

export function upsertFamily(member) {
  const i = store.data.family.findIndex(f => f.id === member.id)
  if (i >= 0) store.data.family[i] = member
  else store.data.family.push(member)
  persist()
}

export function removeFamily(id) {
  const i = store.data.family.findIndex(f => f.id === id)
  if (i >= 0) store.data.family.splice(i, 1)
  persist()
}

export function saveShare(share) {
  const i = store.data.shares.findIndex(s => s.id === share.id)
  if (i >= 0) store.data.shares[i] = share
  else store.data.shares.unshift(share)
  persist()
}

export function listShares() {
  return [...store.data.shares]
}

// 没设过返回 null（交给分享里的预设）
export function loadElderPrefs() {
  const raw = safeGet(KEYS.elderPrefs, null)
  if (!raw || typeof raw !== 'object') return null
  return {
    scale: ELDER_SCALES.includes(raw.scale) ? raw.scale : 1,
    theme: ELDER_THEMES.includes(raw.theme) ? raw.theme : 'day',
  }
}

export function saveElderPrefs(prefs) {
  const next = {
    scale: ELDER_SCALES.includes(prefs && prefs.scale) ? prefs.scale : 1,
    theme: ELDER_THEMES.includes(prefs && prefs.theme) ? prefs.theme : 'day',
  }
  safeSet(KEYS.elderPrefs, next)
  return next
}

// 生效优先级：长辈自己调过的 > 子女分享时预设的 > 默认
export function resolveElderPrefs(sharePrefs) {
  const local = loadElderPrefs()
  const fromShare = sharePrefs && typeof sharePrefs === 'object' ? sharePrefs : null
  const pick = local || fromShare || {}
  return {
    scale: ELDER_SCALES.includes(pick.scale) ? pick.scale : 1,
    theme: ELDER_THEMES.includes(pick.theme) ? pick.theme : 'day',
    // 位置共享是「子女授权」，只认分享里带的，本机偏好不能自己给自己开权限
    shareLocation: !!(fromShare && fromShare.shareLocation),
    source: local ? 'local' : (fromShare ? 'share' : 'default'),
  }
}
