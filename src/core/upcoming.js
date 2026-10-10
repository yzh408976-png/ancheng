// 出发提醒：纯函数，方便复用，也方便长辈端（弹窗 + 倒计时条）复用同一份判断。
//
// 规则（写死，不留选择）：
//   - 只对「不是住宿」且日期是今天、且有出发时刻的卡片生效
//   - 出发前 60 分钟内首次提醒（stage = 'lead'）
//   - 出发前 20 分钟内再提醒一次（stage = 'second'）
//   - 已经过了出发时间 5 分钟以上就不再提醒（别让长辈打开页面被一堆过期弹窗淹没）
//   - 同一个 stage 点过「知道了」就不再弹（记账键 segId:stage，交给 elderState.js 存）

export const LEAD_MIN = 60
export const SECOND_MIN = 20
export const GRACE_MIN = 5

function pad2(n) { return String(n).padStart(2, '0') }

// 本地时区 'YYYY-MM-DD'
export function localDate(now = new Date()) {
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
}

// 卡片的出发时刻 → Date（本地时区）。缺日期/缺时刻/格式不对一律返回 null。
export function parseDepartAt(card) {
  if (!card) return null
  const dm = String(card.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const tm = String(card.depart || '').match(/^(\d{1,2}):(\d{2})/)
  if (!dm || !tm) return null
  const y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3])
  const hh = Number(tm[1]), mi = Number(tm[2])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null
  const dt = new Date(y, mo - 1, d, hh, mi, 0, 0)
  // 反查一遍：挡掉 2 月 30 日这种会被 Date 静默滚到下个月的写法
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

export function minutesUntil(departAt, now) {
  return Math.round((departAt.getTime() - now.getTime()) / 60000)
}

// 今天还没出发的那些段，按「离出发还有多久」升序
export function futureList(cards, now = new Date()) {
  const today = localDate(now)
  const out = []
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay') return
    if (c.date !== today) return
    const at = parseDepartAt(c)
    if (!at) return
    const left = minutesUntil(at, now)
    if (left < 0) return
    out.push({ segId: keyOf(c, i), card: c, departAt: at, minutesLeft: left })
  })
  out.sort((a, b) => a.minutesLeft - b.minutesLeft)
  return out
}

// 倒计时条用：今天还没出发的最近一段
export function nextUpcoming(cards, now = new Date()) {
  return futureList(cards, now)[0] || null
}

export function countdownText(minutesLeft) {
  const m = Math.round(minutesLeft)
  if (m <= 0) return '该出发了'
  if (m < 1) return '还有不到 1 分钟'
  if (m < 60) return `还有 ${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `还有 ${h} 小时 ${rest} 分钟` : `还有 ${h} 小时`
}

// 该弹窗的那些段：落在 [出发前 60 分钟, 出发后 5 分钟] 区间内，按紧急度升序
export function upcomingList(cards, now = new Date(), { leadMin = LEAD_MIN, secondMin = SECOND_MIN, graceMin = GRACE_MIN } = {}) {
  const today = localDate(now)
  const out = []
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay') return
    if (c.date !== today) return
    const at = parseDepartAt(c)
    if (!at) return
    const left = minutesUntil(at, now)
    if (left > leadMin || left < -graceMin) return
    const stage = left <= secondMin ? 'second' : 'lead'
    out.push({ segId: keyOf(c, i), card: c, departAt: at, minutesLeft: left, stage })
  })
  out.sort((a, b) => a.minutesLeft - b.minutesLeft)
  return out
}

// 这个 stage 是否还没被点掉
export function shouldRemind(state, item, now = new Date()) {
  if (!item || !item.segId) return false
  const d = (state && state.dismissed) || {}
  return !d[item.segId + ':' + item.stage]
}

// 弹窗要展示的标题：`G7102 北京南 → 上海虹桥`
export function noticeTitle(item) {
  const c = (item && item.card) || {}
  const head = c.code ? c.code + ' ' : ''
  if (c.kind === 'stay') return head + (c.to || '住宿')
  return head + (c.from || '') + ' → ' + (c.to || '')
}

// 与 elder-shared.cardKey 保持同一套规则：有 segId 用 segId，没有就退回下标
function keyOf(c, i) {
  return c && c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
}
