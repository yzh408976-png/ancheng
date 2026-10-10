// AI 补漏层：只填空、不覆盖；补完重跑校验；仍需人工确认。
// 有模型配置时走真调用；没配置时走内置演示管线，无需任何 API key。
import { isConfigured, supportsVision, chat, imageContent } from './model.js'
import { guessCity, translateSegment, refreshPlain, sanityCheck, toDateStr, runPipeline } from './agents.js'

export function missingFields(seg) {
  const miss = []
  if (!seg.date && !seg.dateInvalid) miss.push('date')
  if (seg.type === 'hotel') return miss
  if (!seg.from) miss.push('from')
  if (!seg.to) miss.push('to')
  if (!seg.departTime) miss.push('departTime')
  if (!seg.arriveTime) miss.push('arriveTime')
  if (!seg.code && (seg.type === 'train' || seg.type === 'flight')) miss.push('code')
  return miss
}

export function assistTargets(result) {
  return (result.segments || []).filter(seg => missingFields(seg).length > 0)
}

export function hasWork(result) {
  if (!result) return false
  return assistTargets(result).length > 0 || (result.unparsed || []).length > 0
}

export function parseJsonLoose(text) {
  if (!text) return null
  let t = String(text).trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(t.slice(start, end + 1)) } catch { return null }
}

export function summarizePatches(result, patches) {
  const items = (patches && patches.items) || []
  const news = (patches && patches.news) || []
  const FIELD_CN = { date: '日期', from: '出发地', to: '到达地', departTime: '出发时间', arriveTime: '到达时间', code: '车次/航班号' }
  const segTitle = (segId) => {
    const seg = (result.segments || []).find(s => s.id === segId)
    if (!seg) return segId
    return seg.code || seg.from || seg.to || '第 ' + ((result.segments.indexOf(seg) + 1)) + ' 段'
  }
  return {
    count: items.length + news.length,
    items: items.map(p => `${segTitle(p.segId)}：补「${FIELD_CN[p.field] || p.field}」→ ${p.value}`),
    news: news.map(s => `新认出一段：${s.plain ? s.plain.title : s.type}`),
  }
}

function asSegment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = ['train', 'flight', 'hotel', 'taxi'].includes(raw.type) ? raw.type : null
  if (!type) return null
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : ''
  const from = typeof raw.from === 'string' ? raw.from : ''
  const to = typeof raw.to === 'string' ? raw.to : ''
  if (!date && !from && !to) return null
  const seg = {
    id: 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    date, dateLiteral: '', dateInvalid: false,
    departTime: typeof raw.departTime === 'string' && /^\d{1,2}:\d{2}$/.test(raw.departTime) ? raw.departTime : '',
    arriveTime: typeof raw.arriveTime === 'string' && /^\d{1,2}:\d{2}$/.test(raw.arriveTime) ? raw.arriveTime : '',
    arriveNextDay: !!raw.arriveNextDay,
    from, to,
    fromCity: guessCity(from), toCity: guessCity(to),
    code: typeof raw.code === 'string' ? raw.code.toUpperCase().slice(0, 8) : '',
    seatClass: '', hotelNights: type === 'hotel' ? (raw.hotelNights || 1) : null,
    hotelNightsExplicit: false,
    note: '', sourceLine: raw.sourceLine || '', manualConfirm: true, aiAssisted: true,
    plain: null,
  }
  translateSegment(seg)
  return seg
}

export function applyAssist(result, patches, { today } = {}) {
  if (!result || !patches) return result
  const byId = new Map((result.segments || []).map(s => [s.id, s]))
  let touched = false

  for (const p of (patches.items || [])) {
    const seg = byId.get(p.segId)
    if (!seg) continue
    if (seg[p.field] == null || seg[p.field] === '') {
      seg[p.field] = p.value
      seg.aiAssisted = true
      seg.manualConfirm = true
      touched = true
    }
  }
  if (patches.fromCity) {
    for (const seg of byId.values()) {
      if (!seg.fromCity && seg.from) seg.fromCity = guessCity(seg.from)
      if (!seg.toCity && seg.to) seg.toCity = guessCity(seg.to)
    }
  }

  for (const raw of (patches.news || [])) {
    const seg = asSegment(raw)
    if (seg) {
      result.segments.push(seg)
      touched = true
    }
  }

  if (Array.isArray(patches.claimed)) {
    for (const line of patches.claimed) {
      const i = (result.unparsed || []).indexOf(line)
      if (i >= 0) result.unparsed.splice(i, 1)
    }
  }

  if (touched) {
    refreshPlain(result)
    result.issues = sanityCheck(result.segments, { today: today || toDateStr(new Date()) })
  }
  return result
}

export function buildAssistMessages(result, { today, fallbackDate } = {}) {
  const targets = assistTargets(result)
  const task = {
    today,
    fallbackDate,
    missing: targets.map(seg => ({
      id: seg.id,
      type: seg.type,
      sourceLine: seg.sourceLine,
      missing: missingFields(seg),
    })),
    unparsed: result.unparsed || [],
  }
  return [
    {
      role: 'system',
      content: '你是行程信息补全助手。规则：1) 只填空字段，绝不覆盖已有值；2) 日期用 YYYY-MM-DD；3) 时间用 HH:MM；4) 新段 type 只能是 train/flight/hotel/taxi；5) 新段必须有日期或出发/到达地；6) 从 unparsed 里认出的行放进 claimed 数组。只输出 JSON：{"items":[{"segId":"...","field":"...","value":"..."}],"news":[{...完整段...}],"claimed":["原文行"]}。没有可补的就输出 {"items":[],"news":[],"claimed":[]}。',
    },
    { role: 'user', content: JSON.stringify(task, null, 1) },
  ]
}

// ---------- 演示管线：无模型配置时的启发式补漏 ----------

function demoAssist(result, { today, fallbackDate } = {}) {
  const items = []
  const news = []
  const claimed = []
  const segs = result.segments || []

  let prevDate = fallbackDate || today
  for (const seg of segs) {
    const miss = missingFields(seg)
    for (const field of miss) {
      if (field === 'date') {
        items.push({ segId: seg.id, field, value: prevDate })
      } else if (field === 'departTime' && seg.arriveTime) {
        const [ah, am] = seg.arriveTime.split(':').map(Number)
        const dep = new Date(2000, 0, 1, ah, am - 180)
        items.push({ segId: seg.id, field, value: `${String(dep.getHours()).padStart(2, '0')}:${String(dep.getMinutes()).padStart(2, '0')}` })
      } else if (field === 'arriveTime' && seg.departTime) {
        const [dh, dm] = seg.departTime.split(':').map(Number)
        const arr = new Date(2000, 0, 1, dh, dm + 180)
        items.push({ segId: seg.id, field, value: `${String(arr.getHours()).padStart(2, '0')}:${String(arr.getMinutes()).padStart(2, '0')}` })
      }
      // from/to/code 缺失不瞎猜 —— 演示管线同样遵守「不确定就不填」
    }
    if (seg.date) prevDate = seg.date
  }

  // 用更宽松的规则重试未解析行
  for (const line of (result.unparsed || [])) {
    const retry = runPipeline(line, { today, fallbackDate })
    if (retry.segments.length && retry.unparsed.length === 0) {
      for (const seg of retry.segments) {
        seg.aiAssisted = true
        seg.manualConfirm = true
        seg.sourceLine = line
        news.push(seg)
      }
      claimed.push(line)
    }
  }

  return { items, news, claimed }
}

export async function runAssist(result, { cfg, today, fallbackDate } = {}) {
  const c = cfg || null
  const ctx = { today: today || toDateStr(new Date()), fallbackDate: fallbackDate || today || toDateStr(new Date()) }

  if (isConfigured(c)) {
    const messages = buildAssistMessages(result, ctx)
    const out = await chat(messages, { cfg: c, temperature: 0.1 })
    if (out.ok) {
      const data = parseJsonLoose(out.content)
      if (data) {
        const patches = {
          items: Array.isArray(data.items) ? data.items.filter(p => p && p.segId && p.field) : [],
          news: Array.isArray(data.news) ? data.news : [],
          claimed: Array.isArray(data.claimed) ? data.claimed.filter(x => typeof x === 'string') : [],
        }
        return { ok: true, via: 'model', patches, summary: summarizePatches(result, patches) }
      }
      return { ok: false, via: 'model', reason: 'bad-json' }
    }
    return { ok: false, via: 'model', reason: out.reason }
  }

  // 演示管线：模拟 1.2 秒「思考」，让预览 → 应用流程完整可体验
  await new Promise(r => setTimeout(r, 1200))
  const patches = demoAssist(result, ctx)
  return { ok: true, via: 'demo', patches, summary: summarizePatches(result, patches) }
}

export async function extractTextFromImage(dataUrl, { cfg } = {}) {
  const c = cfg || null
  if (!supportsVision(c)) return { ok: false, reason: 'not-configured' }
  const out = await chat([
    { role: 'user', content: [
      { type: 'text', text: '把图片里的行程 / 车票文字原样转成文字，保留换行，不要解释。' },
      imageContent(dataUrl),
    ] },
  ], { cfg: c, temperature: 0 })
  if (!out.ok) return { ok: false, reason: out.reason }
  return { ok: true, text: out.content.trim() }
}
