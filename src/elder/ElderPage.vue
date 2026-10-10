<script setup>
// 长辈端外壳：#/e/<token> 或本机 6 位码，免登录看行程。
// 一按钮一页面（用户明确要求：别把三块内容堆在一页里，长辈会看叉）：
//   #/e/<token>         行程页（默认页，播报按钮在本页内）
//   #/e/<token>/calls   家人电话
//   #/e/<token>/show    显示设置
//   #/e                 输码页 / 链接过期 / 链接损坏（都没有底栏）
// 本页不放产品 logo、不出现产品名：长辈只需要看到"今天怎么走"。
//
// 适老化红线：正文 ≥28px、主按钮 ≥72px 高、三主题正文对比度 ≥7:1、全页零动画（不写 animation/transition）。
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, navigate } from '../core/router.js'
import { decodeShare } from '../core/share-codec.js'
import { resolveElderPrefs, saveElderPrefs } from '../core/store.js'
import { loadElderState, saveElderState, toggleDone, toggleCollapsed, markDismissed } from '../core/elderState.js'
import { roomId, push, probeSync, makeEvent } from '../core/sync.js'
import { upcomingList, shouldRemind, countdownText, nextUpcoming, noticeTitle } from '../core/upcoming.js'
import { todayStr, dateLabel } from './elder-shared.js'
import DayView from './DayView.vue'
import CallsView from './CallsView.vue'
import ShowView from './ShowView.vue'
import NoticePopup from './NoticePopup.vue'
import LocationShare from './LocationShare.vue'

const route = useRoute()

const state = ref('code') // 'code' | 'ok' | 'expired' | 'malformed'
const payload = ref(null)
const page = ref('day') // 'day' | 'calls' | 'show'
let token = ''

// ---- 同步（双轨）与长辈端本机任务状态 ----
const room = ref('')            // 由分享 token 派生；没有分享就没有 room
const syncReady = ref(false)    // 是否接上了同步服务（只用于文案）
const tasks = ref({ done: {}, collapsed: {}, dismissed: {} })
let syncedToken = ''

// ---- 提醒 ----
const notice = ref(null)
const nowTick = ref(Date.now())
const highlightSegId = ref('')
let tickTimer = null
let focusTimer = null

const codeInput = ref('')
const codeError = ref('')
const CODE_ERROR = '码不对，或者这个码是别的设备上的'

const speaking = ref(false)
const speechUnsupported = ref(false)

// 显示偏好：长辈自己调过的 > 分享中的预设 > 默认
const boot = resolveElderPrefs(null)
const prefs = ref({ scale: boot.scale, theme: boot.theme })
// 位置共享是「子女授权」，只认分享里带的（本机偏好不能自己给自己开权限）
const shareLocation = ref(false)

const today = todayStr()
const dateText = dateLabel()

// 整趟行程：全部段都列出来，跨天的那几段在卡片上标出日期（长辈只要往下看就不漏）
const cards = computed(() => {
  const list = payload.value && Array.isArray(payload.value.cards) ? payload.value.cards : []
  return list.filter((c) => !!c)
})

const contacts = computed(() => {
  return payload.value && Array.isArray(payload.value.contacts) ? payload.value.contacts : []
})

const voiceText = computed(() => {
  return cards.value.map((c) => (c && c.voice) || '').filter(Boolean).join('。')
})

const PAGE_SUFFIX = { day: '', calls: '/calls', show: '/show' }

function parseRoute(path) {
  if (path !== '/e' && !path.startsWith('/e/')) return null
  const segs = path.slice(3).split('/').filter(Boolean)
  if (!segs.length) return { token: '', page: 'day' }
  const sub = segs[1]
  return { token: segs[0], page: sub === 'calls' ? 'calls' : sub === 'show' ? 'show' : 'day' }
}

function stopSpeak() {
  if (speaking.value && 'speechSynthesis' in window) {
    try { window.speechSynthesis.cancel() } catch {}
  }
  speaking.value = false
}

function applyPayload(p) {
  payload.value = p || null
  speechUnsupported.value = false
  stopSpeak()
  const rp = resolveElderPrefs(p && p.prefs)
  prefs.value = { scale: rp.scale, theme: rp.theme }
  shareLocation.value = !!rp.shareLocation
}

// room 只在 token 真正变化时才重建：它决定了读哪一份本机状态、往哪个房间回传
function syncRoom() {
  const r = token ? roomId(token) : ''
  if (r === syncedToken) return
  syncedToken = r
  room.value = r
  if (!r) {
    tasks.value = { done: {}, collapsed: {}, dismissed: {} }
    return
  }
  tasks.value = loadElderState(r)
  probeSync().then((ok) => { syncReady.value = ok })
  // 告诉子女端「长辈打开了行程」（尽力而为，失败就算了）
  push(r, [makeEvent('trip-open', '')])
}

// ---- 长辈端动作：先落本机，再回传 ----
function onToggleDone(ev) {
  const key = ev && ev.key
  if (!key) return
  tasks.value = saveElderState(room.value, toggleDone(tasks.value, key))
  const done = !!tasks.value.done[key]
  push(room.value, [makeEvent(done ? 'card-done' : 'card-undone', key, { index: ev.index })])
  refreshNotice()
}

function onToggleCollapse(ev) {
  const key = ev && ev.key
  if (!key) return
  const willCollapse = !tasks.value.collapsed[key]
  tasks.value = saveElderState(room.value, toggleCollapsed(tasks.value, key))
  push(room.value, [makeEvent(willCollapse ? 'card-collapse' : 'card-open', key, { index: ev.index })])
}

// ---- 出发提醒 ----
function refreshNotice() {
  nowTick.value = Date.now()
  const now = new Date(nowTick.value)
  const list = upcomingList(cards.value, now).filter((it) => shouldRemind(tasks.value, it, now))
  if (!list.length) { notice.value = null; return }
  const first = list[0]
  const c = first.card || {}
  notice.value = {
    segId: first.segId,
    stage: first.stage,
    countdown: countdownText(first.minutesLeft),
    title: noticeTitle(first),
    detail: c.note || '',
    more: list.length - 1,
  }
}

function onNoticeJump() {
  const segId = notice.value && notice.value.segId
  notice.value = null
  if (!segId) return
  page.value = 'day'
  navigate('/e/' + token + PAGE_SUFFIX.day)
  highlightSegId.value = ''
  // 下一帧再设，确保 DayView 已经渲染出这张卡
  setTimeout(() => {
    highlightSegId.value = segId
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = setTimeout(() => { highlightSegId.value = '' }, 6000)
  }, 0)
}

function onNoticeDismiss() {
  const n = notice.value
  if (!n) return
  tasks.value = saveElderState(room.value, markDismissed(tasks.value, n.segId, n.stage))
  notice.value = null
}

const nextText = computed(() => {
  if (page.value !== 'day' || state.value !== 'ok') return ''
  const n = nextUpcoming(cards.value, new Date(nowTick.value))
  return n ? '下一段：' + countdownText(n.minutesLeft) : ''
})

function startTicking() {
  if (tickTimer) return
  refreshNotice()
  tickTimer = setInterval(refreshNotice, 30000)
}

function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  if (focusTimer) { clearTimeout(focusTimer); focusTimer = null }
}

function applyPrefs(next) {
  prefs.value = saveElderPrefs(next)
}

// 路由 → 状态机。子页面切换不重新解码（否则会闪、也没必要）。
function resolveRoute() {
  const r = parseRoute(route.path || '')
  if (!r || !r.token) {
    token = ''
    payload.value = null
    stopSpeak()
    state.value = 'code'
    syncRoom()
    return
  }
  if (r.token !== token) {
    token = r.token
    let res = null
    try { res = decodeShare(r.token) } catch { res = { ok: false, reason: 'malformed' } }
    if (res && res.ok) {
      applyPayload(res.payload)
      state.value = 'ok'
    } else if (res && res.reason === 'expired') {
      payload.value = null
      state.value = 'expired'
    } else {
      payload.value = null
      state.value = 'malformed'
    }
  }
  page.value = r.page
  syncRoom()
  window.scrollTo(0, 0)
}
watch(() => route.path, resolveRoute, { immediate: true })

function goPage(p) {
  if (!token) return
  navigate('/e/' + token + PAGE_SUFFIX[p])
}

// 6 位码：遍历本机 ptb:data:* 桶里的 shares，命中 code6 后解码其 token；任何一步失败都给同一句提示
function submitCode() {
  codeError.value = ''
  const code = String(codeInput.value || '').replace(/\s+/g, '')
  if (!code) { codeError.value = CODE_ERROR; return }
  let found = null
  try {
    const ls = window.localStorage
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (!key || key.indexOf('ptb:data:') !== 0) continue
      let bucket = null
      try { bucket = JSON.parse(ls.getItem(key)) } catch { bucket = null }
      const shares = bucket && Array.isArray(bucket.shares) ? bucket.shares : []
      const hit = shares.find((s) => s && s.code6 != null && String(s.code6) === code)
      if (hit) { found = hit; break }
    }
  } catch { found = null }
  if (!found || !found.token) { codeError.value = CODE_ERROR; return }
  let res = null
  try { res = decodeShare(found.token) } catch { res = { ok: false, reason: 'malformed' } }
  if (res && res.ok) {
    codeInput.value = ''
    token = found.token
    applyPayload(res.payload)
    page.value = 'day'
    state.value = 'ok'
    syncRoom()
    navigate('/e/' + token)
  } else if (res && res.reason === 'expired') {
    state.value = 'expired'
  } else {
    state.value = 'malformed'
  }
}

function goCode() {
  codeInput.value = ''
  codeError.value = ''
  token = ''
  payload.value = null
  state.value = 'code'
  navigate('/e')
}

function onSpeakClick() {
  if (!('speechSynthesis' in window)) { speechUnsupported.value = true; return }
  if (speaking.value) { stopSpeak(); return }
  const text = voiceText.value
  if (!text) return
  try {
    window.speechSynthesis.cancel()
    const parts = String(text).split(/(?<=[。！？；，])/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part)
      u.lang = 'zh-CN'
      u.rate = 0.9
      if (i === parts.length - 1) {
        u.onend = () => { speaking.value = false }
        u.onerror = () => { speaking.value = false }
      }
      window.speechSynthesis.speak(u)
    })
    speaking.value = true
  } catch {
    speaking.value = false
    speechUnsupported.value = true
  }
}

// 只有真的看到行程了才开始盯着出发时间（30 秒一次；JS 定时器不影响「零动画」断言）
watch(state, (s) => {
  if (s === 'ok') startTicking()
  else stopTicking()
}, { immediate: true })

onBeforeUnmount(() => { stopSpeak(); stopTicking() })
</script>

<template>
  <div class="elder-root" :class="'theme-' + prefs.theme" :style="{ '--el-scale': String(prefs.scale) }">
    <!-- 三种"非展示"状态：都没有底栏 -->
    <main v-if="state !== 'ok'" class="elder-main">
      <template v-if="state === 'code'">
        <h1 class="elder-h1">输入子女给的 <span class="nowrap">6 位码</span></h1>
        <form class="code-form" @submit.prevent="submitCode">
          <label class="code-label" for="elder-code">6 位码</label>
          <input
            id="elder-code"
            v-model="codeInput"
            class="code-input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
          />
          <button type="submit" class="big-btn">查看行程</button>
        </form>
        <p v-if="codeError" class="form-error" role="alert">{{ codeError }}</p>
        <p v-if="codeError" class="form-note">6 位码只在家人设置过的这台手机/电脑上有效</p>
      </template>

      <template v-else-if="state === 'expired'">
        <h1 class="elder-h1">链接过期了</h1>
        <p class="recover-text">请让子女重新发一次，旧链接就不能用了</p>
        <button type="button" class="big-btn" @click="goCode">输入 6 位码试试</button>
      </template>

      <template v-else>
        <h1 class="elder-h1">链接好像不对</h1>
        <p class="recover-text">可能复制漏了字符。请让子女重新发一次</p>
        <button type="button" class="big-btn" @click="goCode">输入 6 位码试试</button>
      </template>
    </main>

    <template v-else>
      <main class="elder-main">
        <DayView
          v-if="page === 'day'"
          :cards="cards"
          :today="today"
          :trip-title="payload && payload.title ? payload.title : ''"
          :date-text="dateText"
          :speaking="speaking"
          :speech-unsupported="speechUnsupported"
          :done-map="tasks.done"
          :collapsed-map="tasks.collapsed"
          :highlight-seg-id="highlightSegId"
          :next-text="nextText"
          @speak="onSpeakClick"
          @toggle-done="onToggleDone"
          @toggle-collapse="onToggleCollapse"
        />
        <CallsView v-else-if="page === 'calls'" :contacts="contacts" @back="goPage('day')" />
        <ShowView v-else :scale="prefs.scale" :theme="prefs.theme" @pick="applyPrefs" @back="goPage('day')" />

        <!-- 位置共享：只有子女在分享页开了口子才出现（长辈还得自己再点一次） -->
        <LocationShare
          v-if="page === 'day' && shareLocation"
          :room="room"
          :mode="syncReady ? 'server' : 'device'"
        />
      </main>

      <nav class="action-bar" aria-label="长辈端导航">
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'day' }"
          :aria-current="page === 'day' ? 'page' : undefined"
          aria-label="行程"
          @click="goPage('day')"
        >行程</button>
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'calls' }"
          :aria-current="page === 'calls' ? 'page' : undefined"
          aria-label="家人电话"
          @click="goPage('calls')"
        >家人</button>
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'show' }"
          :aria-current="page === 'show' ? 'page' : undefined"
          aria-label="显示设置"
          @click="goPage('show')"
        >显示</button>
      </nav>
    </template>

    <!-- 出发提醒：页内弹窗，点「去看看」直接跳到那张卡 -->
    <NoticePopup
      v-if="notice"
      :countdown="notice.countdown"
      :title="notice.title"
      :detail="notice.detail"
      :more="notice.more"
      @jump="onNoticeJump"
      @dismiss="onNoticeDismiss"
    />
  </div>
</template>

<style scoped>
/* 长辈端只消费 global.css 的 --el-* token；全页零动画（不写 animation / transition）。 */
.elder-root {
  /* 字号刻度：改 --el-scale 就整体放大/缩小（子女端预设或长辈自己调） */
  --el-scale: 1;
  --el-fs-28: calc(28px * var(--el-scale));
  --el-fs-30: calc(30px * var(--el-scale));
  --el-fs-32: calc(32px * var(--el-scale));
  --el-fs-34: calc(34px * var(--el-scale));
  --el-fs-36: calc(36px * var(--el-scale));
  --el-fs-40: calc(40px * var(--el-scale));
  --el-fs-44: calc(44px * var(--el-scale));
  --el-hit-sm: calc(84px * var(--el-scale));
  --el-hit-lg: calc(88px * var(--el-scale));

  min-height: 100vh;
  background: var(--el-bg);
  color: var(--el-ink);
  /* CJK 兜底放在最后：某些安卓 WebView 缺中文字形时会掉到默认字体，出现方块/乱码 */
  font-family: -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif;
  font-size: var(--el-fs-30);
  line-height: 1.6;
  /* 全局 body 用的是 antialiased，中文会显细；长辈端改回默认渲染，笔画更实 */
  -webkit-font-smoothing: subpixel-antialiased;
}
/* 主题变体：只换 token，不动结构。三种主题的正文对比度都 ≥7:1（机器断言守着）。 */
.elder-root.theme-contrast {
  /* 高对比：纯黑 + 纯白 + 琥珀；按钮翻成琥珀底黑字，而不是亮黄配白字 */
  --el-bg: #000000;
  --el-card: #0A0A09;
  --el-ink: #FFFFFF;
  --el-ink-2: #E4E4DE;
  --el-line: #6E6E68;
  --el-tint: #FFD400;
  --el-tint-ink: #000000;
  --el-accent: #FFD400;
  --el-btn-bg: #FFD400;
  --el-btn-ink: #000000;
  --el-btn-line: #FFD400;
  --el-danger: #FF9A8F;
  --el-stay: #FFD400;
  --el-error-bg: #3A0F0A;
}
.elder-root.theme-night {
  --el-bg: #0D0F0E;
  --el-card: #171A18;
  --el-ink: #F4F6F3;
  --el-ink-2: #B7BCB4;
  --el-line: #323730;
  --el-tint: #F4F6F3;
  --el-tint-ink: #0D0F0E;
  --el-accent: #3FA06E;
  --el-btn-bg: #0B6B45;
  --el-btn-ink: #FFFFFF;
  --el-btn-line: #0B6B45;
  --el-danger: #FF9A8F;
  --el-stay: #D8A657;
  --el-error-bg: #3A1F1C;
}
.elder-main {
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 20px 200px;
}

/* ---- 输码 / 恢复页 ---- */
.elder-h1 {
  margin: 0 0 26px;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}
.nowrap { white-space: nowrap; }
.code-form { margin: 0; }
.code-label {
  display: block;
  margin: 0 0 12px;
  font-size: var(--el-fs-30);
  font-weight: 700;
  color: var(--el-ink);
}
.code-input {
  display: block;
  width: 100%;
  max-width: 440px;
  height: var(--el-hit-sm);
  margin: 0 0 22px;
  padding: 0 16px;
  background: var(--el-card);
  border: 3px solid var(--el-accent);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 12px;
  text-align: center;
}
/* .big-btn / .back-btn 在 global.css：跨视图复用，scoped 写在这里子组件拿不到 */
.form-error {
  margin: 22px 0 8px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--el-error-bg);
  border: 2px solid rgba(143, 29, 16, 0.35);
  color: var(--el-danger);
  font-size: var(--el-fs-30);
  font-weight: 600;
}
.form-note { margin: 0; font-size: var(--el-fs-30); font-weight: 500; color: var(--el-ink-2); }
.recover-text { margin: 0 0 28px; font-size: var(--el-fs-30); font-weight: 500; color: var(--el-ink-2); }

/* ---- 底部导航：一个按钮一个页面 ---- */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px 14px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--el-card);
  border-top: 2px solid var(--el-line);
}
.bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--el-hit-lg);
  padding: 8px 6px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
}
/* 当前页：实底按钮（日间/夜间为绿底白字，高对比为黄底黑字），文字色同样取自按钮 token */
.bar-btn.active {
  border-color: var(--el-btn-line);
  background: var(--el-btn-bg);
  color: var(--el-btn-ink);
  box-shadow: none;
}
</style>
