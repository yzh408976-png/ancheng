import { KEYS, safeGet, safeSet, safeDel, uid, attachAccount, saveSession, detachAccount } from './store.js'

export const ACCOUNT_HINT = '账号只存在这台设备上（浏览器本地存储），不联网、不上传、没有云端。换设备需要重新注册，数据可以用「我的 → 导出备份」搬过去。'

export const rules = {
  name(v) {
    if (!v) return '请写账号名'
    if (!/^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_-]{1,19}$/.test(v)) {
      return '账号名 2-20 位，字母或汉字开头，可用字母、数字、下划线、连字符'
    }
    return ''
  },
  email(v) {
    if (!v) return '请写邮箱'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '邮箱格式好像不对'
    return ''
  },
  phone(v) {
    if (!v) return '请写手机号'
    if (!/^1\d{10}$/.test(v)) return '手机号是 1 开头的 11 位数字'
    return ''
  },
  password(v) {
    if (!v) return '请写密码'
    if (v.length < 8) return '密码至少 8 位'
    if (/^\d+$/.test(v)) return '密码不能是纯数字'
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return '密码要同时有字母和数字'
    return ''
  },
}

export function validateRegister(form) {
  const errors = {}
  for (const key of ['name', 'email', 'phone', 'password']) {
    const msg = rules[key](form[key])
    if (msg) errors[key] = msg
  }
  if (!errors.password && form.password !== form.confirm) {
    errors.confirm = '两次输入的密码不一样'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

export function randomSalt() {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

const encoder = new TextEncoder()

async function hashStrong(password, salt) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(salt + '::' + password))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hashWeak(password, salt) {
  let h = 0x811c9dc5
  const s = salt + '::' + password + '::ancheng'
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  let out = 'w1'
  for (let r = 0; r < 8; r++) {
    h = Math.imul(h ^ 0x9E3779B9, 0x85EBCA6B) >>> 0
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

export async function hashPassword(password, salt) {
  if (globalThis.crypto && crypto.subtle && globalThis.isSecureContext) {
    try { return await hashStrong(password, salt) } catch { /* 走弱哈希 */ }
  }
  return hashWeak(password, salt)
}

export function listAccounts() {
  return safeGet(KEYS.accounts, [])
}

function writeAccounts(list) {
  safeSet(KEYS.accounts, list)
}

export function isIdentifierTaken(identifier) {
  const id = String(identifier || '').trim().toLowerCase()
  if (!id) return false
  return listAccounts().some(a =>
    a.name.toLowerCase() === id ||
    (a.email || '').toLowerCase() === id ||
    a.phone === id
  )
}

export function removeAccount(id) {
  const list = listAccounts()
  const acc = list.find(a => a.id === id)
  if (!acc) return { ok: false, loggedOut: false }
  writeAccounts(list.filter(a => a.id !== id))
  safeDel(KEYS.dataPrefix + id)
  let loggedOut = false
  const session = safeGet(KEYS.session, null)
  if (session && session.accountId === id) {
    detachAccount()
    loggedOut = true
  }
  return { ok: true, loggedOut, name: acc.name }
}

export async function register(form) {
  const v = validateRegister(form)
  if (!v.ok) return { ok: false, errors: v.errors }
  for (const idf of [form.name, form.email, form.phone]) {
    if (isIdentifierTaken(idf)) {
      return { ok: false, errors: { name: '这个账号名 / 邮箱 / 手机号已经注册过了' } }
    }
  }
  const salt = randomSalt()
  const hash = await hashPassword(form.password, salt)
  const account = {
    id: uid('acc'),
    name: form.name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    salt,
    hash,
    createdAt: Date.now(),
    lastLogin: Date.now(),
  }
  writeAccounts([...listAccounts(), account])
  saveSession(account.id)
  attachAccount(account, null)
  return { ok: true, account }
}

export async function login(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase()
  const acc = listAccounts().find(a =>
    a.name.toLowerCase() === id ||
    (a.email || '').toLowerCase() === id ||
    a.phone === id
  )
  if (!acc) return { ok: false, error: '账号或密码不对' }
  const hash = await hashPassword(password, acc.salt)
  if (hash !== acc.hash) return { ok: false, error: '账号或密码不对' }
  const list = listAccounts()
  const mine = list.find(a => a.id === acc.id)
  mine.lastLogin = Date.now()
  writeAccounts(list)
  saveSession(acc.id)
  attachAccount(mine, null)
  return { ok: true, account: mine }
}

export function logout() {
  detachAccount()
}

export function publicAccount(a) {
  if (!a) return null
  return { id: a.id, name: a.name, email: a.email, phone: a.phone, lastLogin: a.lastLogin }
}

export const LEGACY_FAMILY_TITLES = ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆']

export function isLegacyFamilyTitle(v) {
  return LEGACY_FAMILY_TITLES.includes(v)
}
