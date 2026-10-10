// 通知通道：短信/邮件 —— 始终提供设备端深链兜底，服务端可用时走服务端
export const KIND_SMS = 'sms'
export const KIND_EMAIL = 'email'

export function mailSubject(tripTitle) {
  return `安程：${tripTitle || '家人行程'}已经排好`
}

export function notifyText({ link, code6, name, tripTitle } = {}) {
  const who = name ? `${name}，` : ''
  const title = tripTitle ? `「${tripTitle}」` : '行程'
  return `${who}行程排好了：${title}。打开这个链接就能看：${link}（或在本机打开安程长辈端，输入 ${code6}）`
}

export function buildSmsHref({ phone, text } = {}) {
  const p = String(phone || '').replace(/\s/g, '')
  const body = encodeURIComponent(text || '')
  const joiner = p.includes('?') ? '&' : '?'
  return `sms:${p}${joiner}body=${body}`
}

export function buildMailtoHref({ to, subject, text } = {}) {
  const params = []
  if (subject) params.push('subject=' + encodeURIComponent(subject))
  if (text) params.push('body=' + encodeURIComponent(text))
  return `mailto:${to || ''}${params.length ? '?' + params.join('&') : ''}`
}

const channelCache = { at: 0, data: null }

export async function probeChannel(kind, { base = '' } = {}) {
  if (Date.now() - channelCache.at < 30000 && channelCache.data) {
    return channelCache.data[kind] || null
  }
  channelCache.at = Date.now()
  channelCache.data = { sms: null, email: null }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(base + '/api/notify/config', { signal: ctrl.signal })
    clearTimeout(timer)
    const data = await res.json()
    if (data && typeof data === 'object') {
      channelCache.data = { sms: data.sms || null, email: data.email || null }
    }
  } catch { /* 静默，走深链兜底 */ }
  return channelCache.data[kind] || null
}

export async function sendViaServer({ channel, to, text, subject, base = '' } = {}) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(base + '/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, to, text, subject }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const data = await res.json()
    if (data && data.ok) return { ok: true, provider: data.via || 'server' }
    return { ok: false, reason: (data && data.reason) || 'server' }
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  }
}

export async function deliver({ channel, to, link, code6, name, tripTitle, base = '' } = {}) {
  const text = notifyText({ link, code6, name, tripTitle })
  const provider = await probeChannel(channel, { base })
  if (provider) {
    const out = await sendViaServer({
      channel,
      to,
      text,
      subject: mailSubject(tripTitle),
      base,
    })
    if (out.ok) {
      return { via: 'server', ok: true, provider: out.provider, href: null }
    }
  }
  const href = channel === KIND_SMS
    ? buildSmsHref({ phone: to, text })
    : buildMailtoHref({ to, subject: mailSubject(tripTitle), text })
  return { via: 'device', ok: true, href, fallbackReason: 'server-unavailable' }
}
