// 三阶段管线：规则解析 → 人话重写 → 合理性检查
// 纯规则实现，不依赖任何模型

export const SEG_TYPES = ['train', 'flight', 'hotel', 'taxi']
export const TYPE_LABELS = { train: '火车', flight: '航班', hotel: '住宿', taxi: '接送' }

const TRAIN_RE = /\b([GDCKTZYL]\d{1,4})\b/i
const FLIGHT_RE = /\b([A-Z0-9]{2}\d{3,4})\b/

const PERIODS = [
  [/凌晨/, 0], [/早上/, 6], [/上午/, 8], [/中午/, 12], [/午后/, 13], [/下午/, 13],
  [/傍晚/, 17], [/晚上/, 19], [/夜里/, 21], [/今晚/, 20], [/明晚/, 20],
]

// 车次字母 → 长辈能听懂的话（与原版文案一致）
const CODE_TIPS = {
  G: '高铁比较快，车厢里有空调和开水，记得提前到站候车。',
  D: '动车比高铁稍慢一点，也是对号入座，放心坐。',
  C: '城际列车，就在附近城市之间跑，行程短。',
  K: '普速火车，慢一些但便宜，注意保管好行李。',
  T: '普速火车，慢一些但便宜，注意保管好行李。',
  Z: '直达火车，晚上坐可以睡一觉，保管好铺位。',
  Y: '旅游列车，沿途风景不错，看好随身的包。',
  L: '临时加开的列车，留意车站大屏确认检票口。',
}
// 席别 → 提示。key 与解析抽取的 seatClass 字面量一一对应
const SEAT_TIPS = {
  二等座: '普通座位，够坐，靠窗能看到风景。',
  一等座: '更宽的座位，安静一些。',
  商务座: '最宽的座位，能躺平休息。',
  硬座: '普通座位，坐久了会累，多活动活动腿。',
  硬卧: '睡觉的铺位，分上中下铺，值钱东西放身边。',
  软卧: '更宽敞的睡觉铺位，四人间，门能关上。',
  站票: '没有固定座位，可能得站着，找列车员补卧铺试试。',
  无座: '没有固定座位，可能得站着，找列车员补卧铺试试。',
  经济舱: '普通座位，腿能伸直。',
  公务舱: '座位更宽，能半躺。',
  头等舱: '最宽的座位，服务最好。',
}
const TYPE_NAME = { train: '列车', flight: '航班', hotel: '酒店', taxi: '接送' }
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

const STATION_ALIASES = {
  '北京': '北京站', '北京南': '北京南站', '北京西': '北京西站', '北京北': '北京北站',
  '上海': '上海站', '上海南': '上海南站', '上海虹桥': '上海虹桥站', '虹桥': '上海虹桥站',
  '广州': '广州站', '广州南': '广州南站', '深圳': '深圳站', '深圳北': '深圳北站',
  '杭州': '杭州站', '杭州东': '杭州东站', '南京': '南京站', '南京南': '南京南站',
  '苏州': '苏州站', '苏州北': '苏州北站', '福州': '福州站', '福州南': '福州南站',
  '厦门': '厦门站', '厦门北': '厦门北站', '泉州': '泉州站', '漳州': '漳州站',
  '武汉': '武汉站', '汉口': '汉口站', '长沙': '长沙站', '长沙南': '长沙南站',
  '成都': '成都站', '成都东': '成都东站', '重庆': '重庆站', '重庆北': '重庆北站',
  '西安': '西安站', '西安北': '西安北站', '郑州': '郑州站', '郑州东': '郑州东站',
  '天津': '天津站', '天津西': '天津西站', '合肥': '合肥站', '南昌': '南昌站',
  '昆明': '昆明站', '贵阳': '贵阳站', '南宁': '南宁站', '桂林': '桂林站',
  '温州': '温州站', '宁波': '宁波站', '无锡': '无锡站', '常州': '常州站',
  '青岛': '青岛站', '济南': '济南站', '太原': '太原站', '石家庄': '石家庄站',
}

const CITY_KEYS = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '福州', '厦门', '泉州', '漳州',
  '武汉', '长沙', '成都', '重庆', '西安', '郑州', '天津', '合肥', '南昌', '昆明', '贵阳',
  '南宁', '桂林', '温州', '宁波', '无锡', '常州', '青岛', '济南', '太原', '石家庄',
  '莆田', '龙岩', '三明', '南平', '宁德', '香港', '澳门',
]

const WEEK_KEYS = ['日', '一', '二', '三', '四', '五', '六']

export function normalizeStation(name) {
  if (!name) return ''
  let n = String(name).trim().replace(/[，,。.\s]/g, '')
  if (!n) return ''
  if (/(机场|航站楼|T[123]\b)/.test(n)) return n
  if (STATION_ALIASES[n]) return STATION_ALIASES[n]
  if (/[东南西北]$/.test(n) && !n.endsWith('站')) return n + '站'
  if (/(站|机场)$/.test(n)) return n
  return n
}

export function guessCity(text) {
  if (!text) return ''
  for (const c of CITY_KEYS) {
    if (text.includes(c)) return c
  }
  return ''
}

// ---------- 日期辅助 ----------

export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateStr(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s, n) {
  const d = parseDateStr(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function diffDays(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000)
}

// ---------- 日期字面量 ----------

function weekIndexOf(str) {
  for (let i = 0; i < WEEK_KEYS.length; i++) {
    if (str.includes('周' + WEEK_KEYS[i]) || str.includes('星期' + WEEK_KEYS[i]) || str.includes('礼拜' + WEEK_KEYS[i])) return i
  }
  return -1
}

// 返回 { date, literal, invalid } 或 null
function extractDate(line, today) {
  let m
  if ((m = line.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})[日号]?/))) {
    const d = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
    return { date: d, literal: m[0], invalid: false }
  }
  if ((m = line.match(/(大后天)/))) {
    return { date: addDays(today, 3), literal: m[1], invalid: false }
  }
  if ((m = line.match(/(后天)/))) {
    return { date: addDays(today, 2), literal: m[1], invalid: false }
  }
  if ((m = line.match(/(明天|明日)/))) {
    return { date: addDays(today, 1), literal: m[1], invalid: false }
  }
  if ((m = line.match(/(今天|今日)/))) {
    return { date: today, literal: m[1], invalid: false }
  }
  if ((m = line.match(/(下下周)/))) {
    const w = weekIndexOf(line)
    if (w >= 0) return { date: addDays(today, ((w - parseDateStr(today).getDay() + 14 + 7) % 7) + 7), literal: m[1], invalid: false }
  }
  if ((m = line.match(/(下周)/))) {
    const w = weekIndexOf(line)
    if (w >= 0) return { date: addDays(today, (w - parseDateStr(today).getDay() + 14) % 7 + 7), literal: m[1], invalid: false }
  }
  const w = weekIndexOf(line)
  if (w >= 0) {
    return { date: addDays(today, (w - parseDateStr(today).getDay() + 7) % 7), literal: '周' + WEEK_KEYS[w], invalid: false }
  }
  if ((m = line.match(/农历|阴历/))) {
    return { date: null, literal: m[0], invalid: true }
  }
  if ((m = line.match(/(\d{1,2})月(\d{1,2})[日号]/))) {
    const now = parseDateStr(today)
    let y = now.getFullYear()
    const d = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
    if (parseDateStr(d) < parseDateStr(today)) y += 1
    return { date: `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`, literal: m[0], invalid: false }
  }
  if ((m = line.match(/\b(\d{1,2})\.(\d{1,2})\b/)) && +m[1] <= 12 && +m[2] <= 31) {
    const now = parseDateStr(today)
    let y = now.getFullYear()
    let d = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
    if (parseDateStr(d) < parseDateStr(today)) y += 1
    return { date: `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`, literal: m[0], invalid: false }
  }
  if ((m = line.match(/(\d{1,2})[日号]/)) && !/[月]|\d{1,2}月/.test(line)) {
    const now = parseDateStr(today)
    let y = now.getFullYear()
    let mo = now.getMonth() + 1
    const d = `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
    if (parseDateStr(d) < parseDateStr(today)) {
      if (mo === 12) { y += 1; mo = 1 } else { mo += 1 }
    }
    return { date: `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`, literal: m[0], invalid: false }
  }
  return null
}

// ---------- 时刻 ----------

function clampTime(h, mi) {
  let H = h, M = mi || 0
  if (H < 0) H = 0
  if (H > 23) H = 23
  if (M < 0) M = 0
  if (M > 59) M = 59
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
}

function extractTimes(line) {
  const times = []
  const re = /(\d{1,2})\s*[点时:：]\s*(半|\d{1,2})?\s*分?/g
  let m
  while ((m = re.exec(line))) {
    let h = +m[1]
    let mi = m[2] === '半' ? 30 : (m[2] ? +m[2] : 0)
    for (const [re2, base] of PERIODS) {
      const idx = line.search(re2)
      if (idx >= 0 && Math.abs(idx - m.index) < 14) {
        if (h < 12 && base >= 12) h += 12
        break
      }
    }
    times.push(clampTime(h, mi))
  }
  return times.slice(0, 2)
}

// ---------- 站名 ----------

// 剥掉粘连在站名首尾的方向词（原版 cleanSpot 同款）：「从福州长乐机场」→「福州长乐机场」
function stripDirection(s) {
  return String(s || '').replace(/^[到从去飞返\s\-—>]+|[到从去飞返\s\-—>]+$/g, '')
}

function extractStations(line) {
  const cleaned = line.replace(TRAIN_RE, ' ').replace(FLIGHT_RE, ' ')
  let m
  if ((m = cleaned.match(/([\u4e00-\u9fa5]{2,8})(?:站)?\s*(?:→|->|—|–|至|开往|到|飞往|前往)\s*([\u4e00-\u9fa5]{2,8})(?:站)?/))) {
    return [normalizeStation(stripDirection(m[1])), normalizeStation(stripDirection(m[2]))]
  }
  if ((m = cleaned.match(/从\s*([\u4e00-\u9fa5]{2,8})(?:站)?\s*(?:坐|乘|出发|走)/))) {
    return [normalizeStation(stripDirection(m[1])), '']
  }
  return ['', '']
}

// 酒店名进 seg.to（原版语义：住宿段的 to 是店名不是站名，from 恒为空）
function extractHotelName(line) {
  let m = line.match(/(?:入住|住)\s*([^\s，,。;；]+)/)
  if (m && !/^[一两二三四五六七八九十\d]+晚$/.test(m[1])) return m[1]
  m = line.match(/([\u4e00-\u9fa5A-Za-z0-9]+(?:酒店|宾馆|民宿|旅馆)[^\s，,。;；]*)/)
  return m ? m[1] : null
}

// 住几晚：支持「住2晚」「两晚」
function extractNights(line) {
  const m = line.match(/([一两二三四五六七八九十\d])\s*晚/)
  if (!m) return null
  return CN_NUM[m[1]] != null ? CN_NUM[m[1]] : (+m[1] || null)
}

// 机场兜底：「厦门高崎机场飞北京首都机场」这类没有「到/从」的句式，靠 机场 后缀捞。
// 前导动词（飞/从/往…）会被一并吞进名字里，捞完要剥掉。
function findAirport(line, first) {
  const list = line.match(/[\u4e00-\u9fa5]{2,10}机场/g) || []
  const s = first ? list[0] : list[1]
  return s ? normalizeStation(s.replace(/^[从飞去到往]/, '')) : null
}

// ---------- 类型 ----------

function guessType(line) {
  // 注意顺序：车次号优先于航班号 —— G7102 这类车次同样满足航班号正则，先排除
  const isFlight = /航班|飞机|机场|航站楼|登机/.test(line) || (FLIGHT_RE.test(line) && !TRAIN_RE.test(line))
  if (isFlight) return 'flight'
  if (/打车|接送|接站|送机|接机|网约车|出租车/.test(line)) return 'taxi'
  if (/酒店|宾馆|民宿|旅馆|入住|住宿|住[一两二三四五六七八九十\d]?\s*晚/.test(line)) return 'hotel'
  if (TRAIN_RE.test(line) || /高铁|动车|火车|列车/.test(line)) return 'train'
  return ''
}

// ---------- 管线 ----------

export function runPipeline(rawText, { today, fallbackDate } = {}) {
  const now = today || toDateStr(new Date())
  const fallback = fallbackDate || now
  const lines = String(rawText || '')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)

  const segments = []
  const unparsed = []
  let prevDate = null

  for (const line of lines) {
    let relDays = null
    let m
    if ((m = line.match(/第\s*(\d+)\s*天/))) relDays = +m[1] - 1
    else if (/次日|隔天|第二天/.test(line)) relDays = 1
    else if (/当天|同天/.test(line)) relDays = 0

    const dateInfo = extractDate(line, now)
    const times = extractTimes(line)
    const codeM = line.match(TRAIN_RE) || line.match(FLIGHT_RE)
    const code = codeM ? codeM[1].toUpperCase() : ''
    let [from, to] = extractStations(line)
    let type = guessType(line)
    if (!type && code) type = /^([A-Z]{2}\d|[A-Z]\d{2})/.test(code) && /[A-Z]{2}/.test(code) ? 'flight' : 'train'

    // 住宿段：店名进 to，from 恒为空（站点抽取对住宿无意义，只会污染标题）
    if (type === 'hotel') {
      to = extractHotelName(line) || ''
      from = ''
    }
    const hotelNights = type === 'hotel' ? extractNights(line) : null

    // 接送段：站/机场是上车点，「打车去X」的 X 是下车点（原版语义，extractStations 对口语打车句式无能为力）
    if (type === 'taxi') {
      const taxiFrom = line.match(/([^\s，,。]{2,12}(?:站|机场))/)
      const taxiTo = line.match(/打车(?:去|到|前往)\s*([^\s，,。]{2,12})/)
      if (taxiFrom) from = normalizeStation(taxiFrom[1].replace(/^[到从去]/, ''))
      if (taxiTo) to = taxiTo[1]
    }

    // 航班段：抽不出航线时用机场名兜底（原版语义）
    if (type === 'flight') {
      if (!from) from = findAirport(line, true) || ''
      if (!to) to = findAirport(line, false) || ''
    }

    let seatClass = ''
    const seatM = line.match(/(商务座|一等座|二等座|软卧|硬卧|硬座|站票|无座|经济舱|公务舱|商务舱|头等舱)/)
    if (seatM) seatClass = seatM[1]

    const hasSignal = type || code || from || to || dateInfo || times.length
    if (!hasSignal) {
      if (/中转|经停/.test(line) && segments.length) {
        segments[segments.length - 1].note = (segments[segments.length - 1].note ? segments[segments.length - 1].note + '；' : '') + line
        continue
      }
      unparsed.push(line)
      continue
    }

    let date = null
    let dateInvalid = false
    let dateLiteral = dateInfo ? dateInfo.literal : ''
    if (dateInfo && dateInfo.invalid) {
      dateInvalid = true
    } else if (dateInfo && dateInfo.date) {
      date = dateInfo.date
    } else if (relDays != null && prevDate) {
      date = addDays(prevDate, relDays)
    } else if (prevDate) {
      date = prevDate // 没写日期就接着上一段（含住宿段，原版语义）
    } else {
      date = fallback
    }

    const seg = {
      id: uidSeg(),
      type: type || 'train',
      date,
      dateLiteral,
      dateInvalid,
      departTime: times[0] || '',
      arriveTime: times[1] || '',
      arriveNextDay: false,
      from, to,
      fromCity: (type === 'train' || type === 'flight') ? guessCity(from) : '',
      toCity: (type === 'train' || type === 'flight') ? guessCity(to) : '',
      code,
      seatClass,
      hotelNights: type === 'hotel' ? (hotelNights || 1) : null,
      hotelNightsExplicit: !!hotelNights,
      note: /中转|经停/.test(line) ? line : '',
      sourceLine: line,
      manualConfirm: false,
      aiAssisted: false,
      plain: null,
    }
    if (seg.arriveTime && seg.departTime && seg.arriveTime < seg.departTime) seg.arriveNextDay = true
    if (date) prevDate = date
    segments.push(seg)
  }

  for (const seg of segments) translateSegment(seg)
  const issues = sanityCheck(segments, { today: now })
  return { segments, issues, unparsed, today: now }
}

let segSeq = 0
function uidSeg() {
  return 'seg' + (++segSeq) + Date.now().toString(36).slice(-4)
}

export function createBlankSegment(type, today) {
  const seg = {
    id: uidSeg(),
    type: SEG_TYPES.includes(type) ? type : 'train',
    date: today || null, dateLiteral: '', dateInvalid: false,
    departTime: '', arriveTime: '', arriveNextDay: false,
    from: '', to: '', fromCity: '', toCity: '',
    code: '', seatClass: '',
    hotelNights: type === 'hotel' ? 1 : null,
    hotelNightsExplicit: false,
    note: '', sourceLine: '手动添加', manualConfirm: false, aiAssisted: false,
    plain: null,
  }
  return translateSegment(seg)
}

// ---------- 人话重写 ----------

export function cnDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${m}月${d}日`
}

// 时刻 → 「9点30分 / 13点整」（原版口径，给长辈听的）
function timeCN(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return m ? `${h}点${m}分` : `${h}点整`
}

// 写入既有 plain 对象（引用不变，Vue 的响应式才能跟踪到）；不存在则先补一个空壳
export function translateSegment(seg) {
  if (!seg.plain || typeof seg.plain !== 'object') {
    seg.plain = { title: '', depart: '', arrive: '', voice: '', tips: [] }
  }
  const p = seg.plain
  const tips = []
  const code0 = seg.code ? seg.code[0] : null

  if (seg.type === 'train') {
    const kind = { G: '高铁', D: '动车', C: '城际', K: '快车', T: '特快', Z: '直达车', Y: '旅游列车', L: '临客' }[code0] || '列车'
    p.title = seg.code ? `${seg.code} ${kind}` : kind
    if (code0 && CODE_TIPS[code0]) tips.push(CODE_TIPS[code0])
  } else if (seg.type === 'flight') {
    p.title = seg.code ? `${seg.code} 航班` : '航班'
    tips.push('提前 2 小时到机场，带好身份证，到了先取登机牌。')
  } else if (seg.type === 'hotel') {
    p.title = `入住 ${seg.to || '酒店'}`
    tips.push('到了先办入住，报预订人姓名就能拿房卡。')
    if (seg.hotelNights && seg.hotelNights > 1) tips.push(`连住 ${seg.hotelNights} 晚，不用每天搬家。`)
  } else {
    p.title = '打车 / 接送'
    tips.push('上车前核对车牌号，到地方再付钱。')
  }
  if (seg.seatClass && SEAT_TIPS[seg.seatClass]) tips.push(SEAT_TIPS[seg.seatClass])
  if (seg.note && /中转/.test(seg.note)) {
    const m = seg.note.match(/中转(?:(\d+)小时)?(\d+)?分钟?/)
    const mins = m && (m[1] || m[2]) ? (+(m[1] || 0) * 60 + +(m[2] || 0)) : null
    tips.push(mins ? `要下车换乘，等 ${mins} 分钟，可能得站着。` : '要中转换乘，跟着站内「换乘」指示牌走。')
  }
  if (seg.note && /经停/.test(seg.note)) tips.push('中途停一站，不用下车，看好自己的行李。')

  p.title = p.title.trim()
  p.depart = seg.type === 'hotel'
    ? (seg.date ? `${seg.date} 办理入住` : '入住日期待确认')
    : (seg.departTime ? `${timeCN(seg.departTime)} 从 ${seg.from || '出发地'} 出发` : '出发时间待确认')
  p.arrive = seg.type === 'hotel'
    ? (seg.hotelNights ? `住 ${seg.hotelNights} 晚` : '')
    : (seg.arriveTime ? `${seg.arriveNextDay ? '次日 ' : ''}${timeCN(seg.arriveTime)} 到 ${seg.to || '目的地'}` : '到达时间待确认')

  p.voice = seg.type === 'hotel'
    ? `今天入住${seg.to || '酒店'}。到了先办入住，报预订人姓名就能拿房卡。`
    : seg.type === 'taxi'
      ? `${seg.date || ''} 打车从${seg.from || '出发地'}到${seg.to || '目的地'}。上车前核对车牌号。`
      : `你${seg.code ? '坐 ' + seg.code : '出发'}，${seg.departTime ? timeCN(seg.departTime) : '时间待定'}从${seg.from || '出发地'}出发，${seg.arriveTime ? timeCN(seg.arriveTime) : '时间待定'}到${seg.to || '目的地'}。${tips[0] || ''}`

  if (seg.manualConfirm) tips.push('这一条还需要人工确认一下，再对照原短信看看。')
  p.tips = tips
  return seg
}

export function refreshPlain(result) {
  for (const seg of result.segments || []) translateSegment(seg)
}

// ---------- 合理性检查 ----------

const ISSUE_LABELS = {
  'date-invalid': '日期', 'date-past': '日期在过去', 'long-ride': '耗时很长',
  'arrive-before': '到达比出发早', 'arrive-early-am': '凌晨到达', 'same-city': '出发地与目的地一样',
  'no-time': '缺时间', 'hotel-nights': '住宿晚数', 'hotel-before-checkout': '入住日期冲突',
}

export function issueLabel(code) {
  return ISSUE_LABELS[code] || '提醒'
}

export function sanityCheck(segments, { today } = {}) {
  const issues = []
  const push = (level, code, message, segId) => issues.push({ level, code, message, segId })

  let prevHotel = null
  for (const seg of segments) {
    if (seg.dateInvalid) {
      push('warn', 'date-invalid', '「' + (seg.dateLiteral || seg.sourceLine) + '」这种写法认不出是哪天，请手动改一下', seg.id)
    } else if (seg.date && today && seg.date < today) {
      push('warn', 'date-past', `${cnDate(seg.date)}已经过去了，日期对吗？`, seg.id)
    }
    if (seg.departTime && seg.arriveTime) {
      if (seg.arriveTime < seg.departTime && !seg.arriveNextDay) {
        push('error', 'arrive-before', '到达时间比出发时间早，请核对', seg.id)
      }
      const [dh, dm] = seg.departTime.split(':').map(Number)
      const [ah, am] = seg.arriveTime.split(':').map(Number)
      let dur = (ah * 60 + am) - (dh * 60 + dm)
      if (seg.arriveNextDay) dur += 1440
      if (dur > 14 * 60) push('warn', 'long-ride', '路上要 ' + Math.round(dur / 60) + ' 个小时，时间对吗？', seg.id)
      if (seg.arriveNextDay) push('info', 'arrive-nextday', '第二天才到，已经在卡片上标出来了', seg.id)
      const ah2 = seg.arriveNextDay ? ah : ah
      if (ah2 >= 0 && ah2 < 5) push('warn', 'arrive-early-am', `凌晨 ${seg.arriveTime} 才到，接送安排好了吗？`, seg.id)
    } else if (seg.type === 'train' || seg.type === 'flight' || seg.type === 'taxi') {
      push('info', 'no-time', (seg.code || TYPE_LABELS[seg.type]) + ' 没写出发或到达时间', seg.id)
    }
    if ((seg.type === 'train' || seg.type === 'flight') && seg.fromCity && seg.toCity && seg.fromCity === seg.toCity) {
      push('warn', 'same-city', '出发和到达是同一个城市，站名对吗？', seg.id)
    }
    if (seg.type === 'hotel' && !seg.hotelNightsExplicit) {
      push('info', 'hotel-nights', '没写住几晚，先按 1 晚算', seg.id)
    }
    if (seg.type === 'hotel' && prevHotel && seg.date && prevHotel.checkout && seg.date < prevHotel.checkout) {
      push('error', 'hotel-before-checkout', '这晚入住比上一家退房还早，日期冲突了', seg.id)
    }
    if (seg.type === 'hotel' && seg.date) {
      prevHotel = { checkout: addDays(seg.date, seg.hotelNights || 1) }
    } else if (seg.date) {
      prevHotel = null
    }
  }
  return issues
}

export function issueCount(trip, level) {
  const issues = sanityCheck(trip.segments || [], { today: toDateStr(new Date()) })
  return issues.filter(i => i.level === level).length
}

// ---------- 文本净化 ----------
// 粘贴来的短信/群消息原文常带零宽字符（U+200B~200D）、替换字符（U+FFFD）、全角空格与控制字符，
// 不净化就进卡片，长辈端看到的就是「乱码」。只净化展示与打包，不改用户原始输入。
export function sanitizeText(v) {
  if (v == null) return ''
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// ---------- 长辈端卡片（分享/长辈页共用） ----------
// 卡片同时保留结构化来源字段（type/note/hotelNights/…）：分享时它们要进链接，
// 解码后由这些字段重新推导标题、图标、播报词与提示（见下方 packCards/expandCards）。
export function buildElderCards(trip, family) {
  return ((trip && trip.segments) || []).map((seg) => {
    const rawTitle = (seg.plain && seg.plain.title) || TYPE_NAME[seg.type] || ''
    // code 有独立展示位（card-code），标题里的重复车次号去掉，避免「车 G7102 G7102 高铁」
    const title = seg.code && rawTitle.startsWith(seg.code) ? rawTitle.slice(seg.code.length).trim() : rawTitle
    return {
      kind: seg.type === 'hotel' ? 'stay' : 'ride',
      type: seg.type,
      icon: seg.type === 'flight' ? '飞' : seg.type === 'hotel' ? '住' : '车',
      code: sanitizeText(seg.code),
      title: sanitizeText(title),
      from: sanitizeText(seg.from),
      to: sanitizeText(seg.to),
      date: seg.date,
      depart: seg.departTime || '',
      arrive: seg.arriveTime || '',
      arriveNextDay: !!seg.arriveNextDay,
      manualConfirm: !!seg.manualConfirm,
      note: sanitizeText(seg.note),
      hotelNights: seg.hotelNights || null,
      seatClass: seg.seatClass || null,
      voice: (seg.plain && seg.plain.voice) || '',
      tips: (seg.plain && seg.plain.tips) || [],
      segId: seg.id,
    }
  })
}

// ---------- 分享链接用的紧凑卡（v2） ----------
// 为什么要有这一层：链接要变成二维码，码里每个字符都占模块；而播报词、提示、标题、图标
// 全都能由结构化字段重新推导 —— 它们进链接纯粹是浪费容量。
//
// 字段顺序（打包/解包共用，改这里就够）：
//   [type, code, from, to, date, depart, arrive, flags, note, hotelNights, seatClass]
//   flags 位：1 = 次日到达，2 = 待人工确认
const CARD_TYPES = ['train', 'flight', 'hotel', 'taxi']

export function packCards(cards) {
  return (cards || []).map((c) => {
    const row = [
      Math.max(0, CARD_TYPES.indexOf(c.type || (c.kind === 'stay' ? 'hotel' : 'train'))),
      sanitizeText(c.code),
      sanitizeText(c.from),
      sanitizeText(c.to),
      c.date || '',
      c.depart || '',
      c.arrive || '',
      (c.arriveNextDay ? 1 : 0) | (c.manualConfirm ? 2 : 0),
      sanitizeText(c.note),
      c.hotelNights || '',
      sanitizeText(c.seatClass),
    ]
    // 尾部空位不写进链接（数组末尾的空值在 JSON 里是纯浪费）
    while (row.length > 7 && (row[row.length - 1] === '' || row[row.length - 1] === 0)) row.pop()
    return row
  })
}

// 与解析产物同一契约的空段（expandCards 还原、手动补录共用）
function baseSeg(type, seq, sourceLine) {
  return {
    id: `seg${seq}_${Date.now().toString(36)}${seq}`,
    type, date: null, dateLiteral: '', dateInvalid: false,
    departTime: '', arriveTime: '', arriveNextDay: false,
    from: '', to: '', fromCity: '', toCity: '',
    code: '', seatClass: '', hotelNights: null, hotelNightsExplicit: false, note: '',
    sourceLine, manualConfirm: false, aiAssisted: false,
    plain: { title: '', depart: '', arrive: '', voice: '', tips: [] },
  }
}

// 紧凑卡 → 完整卡：把字段还原成"段"的结构，再走一遍既有的 translateSegment + buildElderCards。
// 刻意不另写一套推导逻辑 —— 复用同一条管线，才不会出现"编码前和解码后不一样"。
export function expandCards(rows) {
  const segs = (rows || []).map((c, i) => {
    const seg = baseSeg(CARD_TYPES[c[0]] || 'train', i, '')
    seg.id = 'seg' + i
    seg.code = c[1] || ''
    seg.from = c[2] || ''
    seg.to = c[3] || ''
    seg.date = c[4] || null
    seg.departTime = c[5] || ''
    seg.arriveTime = c[6] || ''
    seg.arriveNextDay = !!(c[7] & 1)
    seg.manualConfirm = !!(c[7] & 2)
    seg.note = c[8] || ''
    seg.hotelNights = c[9] || null
    seg.seatClass = c[10] || ''
    return seg
  })
  segs.forEach(translateSegment)
  return buildElderCards({ segments: segs })
}
