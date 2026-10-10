// 冒烟测试：解析 → 长辈卡 → 分享编码 → 解码还原 → 提醒判断（node 直接跑，无 DOM 依赖）
import { runPipeline, buildElderCards } from './src/core/agents.js'
import { encodeShare, decodeShare, roomId } from './src/core/share-codec.js'
import { upcomingList, countdownText, noticeTitle } from './src/core/upcoming.js'

const today = '2026-10-11'
const raw = `10月11号 G7102 上海虹桥到北京南 09:30发车 13:45到
10月12号 MF8888 厦门高崎机场飞北京首都机场 08:00起飞 10:35到
10月12号 入住北京王府井希尔顿酒店 住2晚`

const result = runPipeline(raw, { today })
console.log('segments:', result.segments.length, '| unparsed:', result.unparsed.length, '| issues:', result.issues.length)
if (result.segments.length !== 3) { console.error('FAIL: 段数不对'); process.exit(1) }

const cards = buildElderCards({ segments: result.segments })
console.log('cards:', cards.map(c => `${c.kind}/${c.code || '-'}/${c.title}/${c.date} ${c.depart}-${c.arrive}`).join(' | '))
const stay = cards.find(c => c.kind === 'stay')
if (!stay || !stay.tips.length || !stay.voice) { console.error('FAIL: 住宿卡缺 tips/voice'); process.exit(1) }
if (!cards[0].voice || !cards[0].tips.length) { console.error('FAIL: 车次卡缺 voice/tips'); process.exit(1) }

const payload = {
  title: '爸妈去北京',
  cards,
  contacts: [{ name: '王小明', phone: '13800000000', relation: '儿子', im: 'wx123', note: '有事随时打' }],
  prefs: { scale: 1.12, theme: 'night', shareLocation: true },
}
const enc = encodeShare(payload)
console.log('token len:', enc.token.length)

const dec = decodeShare(enc.token)
if (!dec.ok) { console.error('FAIL: 解码失败', dec.reason); process.exit(1) }
const p = dec.payload
console.log('decoded cards:', p.cards.length, '| title:', p.title, '| contacts:', p.contacts.length)
const c0 = p.cards[0]
if (c0.code !== cards[0].code || c0.from !== cards[0].from || c0.date !== cards[0].date) {
  console.error('FAIL: 还原卡字段不一致', c0, cards[0]); process.exit(1)
}
if (!c0.voice || !c0.tips.length) { console.error('FAIL: 还原卡缺 voice/tips'); process.exit(1) }
if (p.prefs.scale !== 1.12 || p.prefs.theme !== 'night' || !p.prefs.shareLocation) { console.error('FAIL: prefs 丢失'); process.exit(1) }

// 模拟"30 分钟后出发"的提醒场景
const soon = new Date(today + 'T09:05:00')
const list = upcomingList(p.cards, soon)
console.log('upcoming:', list.map(i => `${i.segId}/${i.stage}/${countdownText(i.minutesLeft)}/${noticeTitle(i)}`))
if (!list.length || !list[0].segId || typeof list[0].minutesLeft !== 'number') { console.error('FAIL: 提醒条目缺字段'); process.exit(1) }

// 过期链路
const expired = encodeShare({ ...payload, exp: Date.now() - 1000 })
const dexp = decodeShare(expired.token)
if (dexp.ok || dexp.reason !== 'expired') { console.error('FAIL: 过期判断失效'); process.exit(1) }

// 篡改链路
const bad = decodeShare('x'.repeat(8) + '.' + enc.token.split('.')[1])
if (bad.ok || bad.reason !== 'malformed') { console.error('FAIL: 校验和没拦住篡改'); process.exit(1) }

const room = roomId(enc.token)
if (!/^[a-z0-9]{14}$/.test(room)) { console.error('FAIL: roomId 格式', room); process.exit(1) }
console.log('roomId:', room)
console.log('ALL PASS')
