<script setup>
// 行程详情：核对 + 手动修正。改完一段重跑 sanityCheck 刷新问题列表。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, upsertTrip, removeTrip, getTrip, listShares } from '../core/store.js'
import { sanityCheck, createBlankSegment, translateSegment, issueLabel, toDateStr } from '../core/agents.js'
import { runAssist, applyAssist, hasWork } from '../core/ai.js'
import { loadModelConfig, isConfigured, reasonText } from '../core/model.js'
import { downloadIcs, downloadTripPoster } from '../core/export.js'
import { buildChecklist, checklistGroups, checklistProgress, toggleChecklistItem } from '../core/checklist.js'
import { roomId, subscribe, probeSync } from '../core/sync.js'

const props = defineProps({ params: { type: Object, default: () => ({}) } })

const trip = computed(() => getTrip(props.params.id))

// ---- 标题（衬线大字，失焦保存）----
const titleText = ref('')
watch(() => trip.value && trip.value.id, () => {
  titleText.value = (trip.value && trip.value.title) || ''
}, { immediate: true })
function saveTitle() {
  const t = trip.value
  if (!t) return
  const v = titleText.value.trim()
  if (!v || v === t.title) { titleText.value = t.title; return }
  upsertTrip({ ...t, title: v, updatedAt: Date.now() })
}

// ---- 删除行程（两步确认）----
const confirmKey = ref('')
let confirmTimer = null
function askConfirm(key) {
  if (confirmKey.value === key) {
    confirmKey.value = ''
    clearTimeout(confirmTimer)
    return true
  }
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}
function deleteTripClick() {
  const t = trip.value
  if (!t) return
  if (!askConfirm('trip')) return
  removeTrip(t.id)
  toast('行程已删除', 'info')
  navigate('/home')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))

// ---- 问题汇总：实时重算，error 优先 ----
const LEVEL_RANK = { error: 0, warn: 1, info: 2 }
const sortedIssues = computed(() => {
  const segs = (trip.value && trip.value.segments) || []
  const today = toDateStr(new Date())
  return [...sanityCheck(segs, { today })].sort((a, b) =>
    (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3)
  )
})

// ---- 段展示辅助 ----
const TYPE_META = {
  train: { icon: '车', label: '高铁' },
  flight: { icon: '飞', label: '航班' },
  hotel: { icon: '住', label: '酒店' },
  taxi: { icon: '车', label: '打车' },
}
function typeMeta(type) {
  return TYPE_META[type] || { icon: '行', label: '行程' }
}
function tipsOf(seg) {
  return (seg.plain && Array.isArray(seg.plain.tips)) ? seg.plain.tips : []
}

// ---- 段编辑 ----
const editingId = ref('')
const editForm = reactive({ date: '', departTime: '', arriveTime: '', from: '', to: '', code: '', note: '' })
function toggleEdit(seg) {
  if (editingId.value === seg.id) { editingId.value = ''; return }
  editingId.value = seg.id
  editForm.date = seg.date || ''
  editForm.departTime = seg.departTime || ''
  editForm.arriveTime = seg.arriveTime || ''
  editForm.from = seg.from || ''
  editForm.to = seg.to || ''
  editForm.code = seg.code || ''
  editForm.note = seg.note || ''
}
function saveSegment(seg) {
  seg.date = editForm.date || seg.date
  if (editForm.date) seg.dateInvalid = false // 表单值是标准日期，原文写法问题即告解决
  seg.departTime = editForm.departTime || ''
  seg.arriveTime = editForm.arriveTime || ''
  seg.from = editForm.from.trim()
  seg.to = editForm.to.trim()
  seg.code = editForm.code.trim()
  seg.note = editForm.note.trim()
  seg.arriveNextDay = !!(seg.arriveTime && seg.departTime && seg.arriveTime < seg.departTime)
  translateSegment(seg) // 改了站点/车次，人话与语音要跟着变，否则长辈端还是旧说法
  const t = trip.value
  if (t) upsertTrip({ ...t, updatedAt: Date.now() })
  editingId.value = ''
  toast('已保存', 'ok')
}

// ---- 添加 / 删除段（手动补录，与解析产物同一契约）----
const ADD_TYPES = [
  { type: 'train', label: '高铁' },
  { type: 'flight', label: '航班' },
  { type: 'hotel', label: '酒店' },
  { type: 'taxi', label: '打车' },
]
const addingOpen = ref(false)

function addSegment(type) {
  const t = trip.value
  if (!t) return
  const seg = createBlankSegment(type, toDateStr(new Date()))
  t.segments.push(seg)
  upsertTrip({ ...t, updatedAt: Date.now() })
  addingOpen.value = false
  toggleEdit(seg) // 直接展开表单，接着就能填
  toast('已添加一段，请补齐信息', 'ok')
}
function deleteSegment(seg) {
  const t = trip.value
  if (!t) return
  if (!askConfirm('seg-' + seg.id)) return
  const i = t.segments.findIndex((s) => s.id === seg.id)
  if (i < 0) return
  t.segments.splice(i, 1)
  upsertTrip({ ...t, updatedAt: Date.now() })
  editingId.value = ''
  toast('已删除这一段', 'info')
}

// ---- AI 一键补全（与导入页同一套契约：先预览，再落地）----
const modelReady = ref(false)
onMounted(() => { modelReady.value = isConfigured(loadModelConfig()) })

const assisting = ref(false)
const assistPreview = ref(null)
const canAssist = computed(() => !!(trip.value && hasWork(trip.value)))

async function aiAssist() {
  const t = trip.value
  if (!t || assisting.value) return
  assisting.value = true
  assistPreview.value = null
  try {
    const r = await runAssist(t, { cfg: loadModelConfig(), today: toDateStr(new Date()) })
    if (!r.ok) { toast('AI 补全失败：' + reasonText(r.reason), 'err'); return }
    if (r.summary.count === 0) { toast('AI 看了一圈，没有能补的地方', 'info'); return }
    assistPreview.value = { patches: r.patches, summary: r.summary, viaLabel: r.via === 'model' ? '模型' : '演示' }
  } catch (e) {
    toast('AI 补全失败：' + ((e && e.message) || e), 'err')
  } finally {
    assisting.value = false
  }
}
function applyAssistResult() {
  const t = trip.value
  const p = assistPreview.value
  if (!t || !p) return
  applyAssist(t, p.patches, { today: toDateStr(new Date()) })
  assistPreview.value = null
  upsertTrip({ ...t, updatedAt: Date.now() })
  toast('已补全 ' + p.summary.count + ' 项，标了「待人工确认」的段请再核对', 'ok')
}
function cancelAssist() { assistPreview.value = null }

// ---- 导出日历 / 长图 ----
function exportCalendar() {
  const t = trip.value
  if (!t) return
  if (!(t.segments || []).length) { toast('这个行程还没有内容', 'warn'); return }
  try {
    downloadIcs(t)
    toast('日历文件已导出，用手机日历打开就能导入', 'ok')
  } catch (e) {
    toast('导出失败：' + ((e && e.message) || e), 'err')
  }
}
function exportPoster() {
  const t = trip.value
  if (!t) return
  if (!(t.segments || []).length) { toast('这个行程还没有内容', 'warn'); return }
  try {
    downloadTripPoster(t)
    toast('行程长图已导出到下载', 'ok')
  } catch (e) {
    toast('导出失败：' + ((e && e.message) || e), 'err')
  }
}

// ---- 行前提醒清单 ----
const checklistItems = computed(() => buildChecklist(trip.value))
const checklistGrouped = computed(() => checklistGroups(checklistItems.value))
const clProgress = computed(() => checklistProgress(checklistItems.value))
function toggleItem(id) {
  const t = trip.value
  if (!t) return
  toggleChecklistItem(t, id)
  upsertTrip({ ...t, updatedAt: Date.now() })
}

// ---- 长辈动态：长辈的动作 + 实时位置（双轨同步）----
// 房间号由「最新那次分享的 token」派生（不写进链接，二维码容量有上限）。
// 没有分享就没有房间 —— 那就如实提示「先生成一次分享链接」，不摆一个空面板。
const elderShare = computed(() => {
  const t = trip.value
  if (!t) return null
  const now = Date.now()
  return listShares().find((s) => s && s.tripId === t.id && s.token && (!s.exp || s.exp > now)) || null
})
const elderRoom = computed(() => (elderShare.value ? roomId(elderShare.value.token) : ''))

const syncOn = ref(false)
const elderEvents = ref([])
const presence = ref(null)
const nowMs = ref(Date.now())
let unsub = null
let nowTimer = null

const syncLabel = computed(() => (syncOn.value ? '已接入同步服务' : '仅同设备可见（未部署同步服务）'))

function minutesSince(at) {
  return Math.max(0, Math.floor((nowMs.value - (at || 0)) / 60000))
}
function agoText(at) {
  if (!at) return ''
  const m = minutesSince(at)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

// 位置超过 10 分钟没更新就不再装成「实时」
const locStale = computed(() => !!presence.value && !!presence.value.at && nowMs.value - presence.value.at > 10 * 60000)
const mapUrl = computed(() => {
  const p = presence.value
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return ''
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`
})
function coordText(v) {
  return Number.isFinite(v) ? v.toFixed(6) : '—'
}

function segNo(e) {
  const i = e && e.data && typeof e.data.index === 'number' ? e.data.index : -1
  return i >= 0 ? `第 ${i + 1} 段` : '某一段'
}
const EVENT_TEXT = {
  'trip-open': () => '长辈打开了这次行程',
  'card-done': (e) => `长辈把${segNo(e)}标成走完了`,
  'card-undone': (e) => `长辈把${segNo(e)}改回没走完`,
  'card-collapse': (e) => `长辈收起了${segNo(e)}的详情`,
  'card-open': (e) => `长辈展开了${segNo(e)}的详情`,
  'loc-on': () => '长辈开始共享位置',
  'loc-off': () => '长辈停止了共享位置',
  'location': () => '长辈更新了位置',
  'seen': () => '长辈看过了',
}
function elderEventText(e) {
  if (!e) return ''
  const f = EVENT_TEXT[e.type]
  return f ? f(e) : '长辈有过一次操作'
}

function stopElderSync() {
  if (unsub) { unsub(); unsub = null }
  syncOn.value = false
}
function startElderSync() {
  stopElderSync()
  const r = elderRoom.value
  if (!r) return
  probeSync().then((ok) => { syncOn.value = ok })
  unsub = subscribe(r, (fresh, p) => {
    if (fresh && fresh.length) {
      const next = elderEvents.value.slice()
      for (const e of fresh) next.push(e)
      next.sort((a, b) => (b.at || 0) - (a.at || 0))
      elderEvents.value = next.slice(0, 20)
    }
    if (p) presence.value = p
  })
}

// 房间变化（刚生成分享 / 换了一条链接）就重订
watch(elderRoom, () => {
  elderEvents.value = []
  presence.value = null
  startElderSync()
}, { immediate: true })

onMounted(() => { nowTimer = setInterval(() => { nowMs.value = Date.now() }, 30000) })
onBeforeUnmount(() => {
  stopElderSync()
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null }
})
</script>

<template>
  <div>
    <section v-if="!trip" class="paper-card empty">
      <p class="kicker">404</p>
      <h1 class="empty__title">行程不存在或已删除</h1>
      <p class="hint">它可能已经被删掉了，回行程列表看看别的。</p>
      <a class="btn btn--brand" href="#/home">回首页</a>
    </section>

    <template v-else>
      <header class="page-head">
        <div class="page-head__main">
          <p class="kicker">行程 · {{ trip.segments.length }} 段</p>
          <input
            v-model="titleText"
            class="title-input"
            type="text"
            aria-label="行程名称"
            @blur="saveTitle"
            @keydown.enter.prevent="$event.target.blur()"
          >
        </div>
        <div class="btn-row">
          <button class="btn btn--brand" @click="navigate('/share/' + trip.id)">分享给爸妈</button>
          <button class="btn btn--ghost" @click="exportCalendar">导出日历</button>
          <button class="btn btn--ghost" @click="exportPoster">导出长图</button>
          <button
            class="btn btn--danger"
            @click="deleteTripClick"
          >{{ confirmKey === 'trip' ? '确认删除？' : '删除行程' }}</button>
        </div>
      </header>

      <section v-if="sortedIssues.length" class="issue-box" aria-label="行程问题汇总">
        <p
          v-for="(iss, ii) in sortedIssues"
          :key="ii"
          class="issue"
          :class="'issue--' + iss.level"
          :role="iss.level === 'error' ? 'alert' : undefined"
        >
          <span class="issue__msg">{{ iss.message }}</span>
          <span v-if="issueLabel(iss.code)" class="tag" :class="iss.level === 'error' ? 'tag--err' : iss.level === 'warn' ? 'tag--warn' : 'tag--info'">{{ issueLabel(iss.code) }}</span>
        </p>
      </section>

      <div v-if="canAssist" class="assist-bar">
        <button class="btn" :disabled="assisting" @click="aiAssist">
          {{ assisting ? 'AI 补全中…' : 'AI 一键补全' }}
        </button>
        <span class="hint">
          {{ modelReady ? '用你自己的模型补齐缺失的日期 / 时间 / 地点，补完仍要核对' : '没配模型也能用：走内置演示管线，先预览再落地' }}
        </span>
      </div>

      <div v-if="assistPreview" class="assist-preview" role="status">
        <p class="assist-preview__title">
          <span class="tag tag--brand">{{ assistPreview.viaLabel }}</span>
          将补全 {{ assistPreview.summary.count }} 项，确认后应用
        </p>
        <ul class="assist-preview__list">
          <li v-for="(it, i) in assistPreview.summary.items" :key="'ai' + i">{{ it }}</li>
          <li v-for="(it, i) in assistPreview.summary.news" :key="'an' + i">{{ it }}</li>
        </ul>
        <div class="btn-row">
          <button class="btn btn--brand" @click="applyAssistResult">应用补全</button>
          <button class="btn btn--ghost" @click="cancelAssist">取消</button>
        </div>
      </div>

      <!-- 长辈动态：长辈的动作 + 实时位置（双轨同步，没有服务端就只标同设备） -->
      <section class="paper-card elder-live" aria-label="长辈动态">
        <div class="elder-live__head">
          <h2 class="card-title" style="margin-bottom:0">长辈动态</h2>
          <span class="elder-live__mode" :class="{ 'is-on': syncOn }">{{ syncLabel }}</span>
        </div>

        <p v-if="!elderShare" class="elder-live__empty">
          先给长辈生成一次分享链接；长辈打开后，这趟行程的每一步都会回到这里。
        </p>

        <template v-else>
          <div class="elder-loc">
            <div class="elder-loc__head">
              <span class="elder-loc__label">长辈现在在哪</span>
              <span v-if="presence" class="elder-loc__time">{{ agoText(presence.at) }}更新</span>
            </div>
            <template v-if="presence">
              <p class="elder-loc__coord mono">{{ coordText(presence.lat) }}, {{ coordText(presence.lng) }}</p>
              <p class="elder-loc__meta">
                <span v-if="presence.acc != null">精度约 ±{{ presence.acc }} 米</span>
                <span v-if="locStale" class="tag tag--warn">位置已 {{ minutesSince(presence.at) }} 分钟没更新</span>
              </p>
              <a v-if="mapUrl" class="btn btn--ghost" :href="mapUrl" target="_blank" rel="noopener">在地图上看</a>
            </template>
            <p v-else class="elder-live__empty">
              长辈还没开始共享位置。位置要长辈自己在手机上点一下才会传过来。
            </p>
          </div>

          <div class="elder-timeline">
            <p v-if="!elderEvents.length" class="elder-live__empty">长辈还没打开过这次分享。</p>
            <ul v-else class="elder-feed">
              <li v-for="e in elderEvents" :key="e.id" class="elder-feed__item">
                <span class="elder-feed__text">{{ elderEventText(e) }}</span>
                <span class="elder-feed__time">{{ agoText(e.at) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </section>

      <div v-if="!trip.segments.length" class="paper-card empty">
        <h2 class="empty__title">这个行程还没有任何一段</h2>
        <p class="hint">可以去「导入」粘贴原文自动解析，也可以直接手动补一段。</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <a class="btn btn--ghost" href="#/import">去导入</a>
          <button class="btn btn--brand" @click="addingOpen = true">手动添加一段</button>
        </div>
      </div>

      <ul class="seg-list">
        <li v-for="s in trip.segments" :key="s.id" class="paper-card seg" :class="{ 'seg--warn': s.manualConfirm }">
          <div v-if="s.manualConfirm" class="seg__alert">这一条待人工确认，建议对照原始短信</div>

          <div class="seg__body">
            <div class="seg__main">
              <span class="seg__icon" aria-hidden="true">{{ typeMeta(s.type).icon }}</span>
              <div class="seg__info">
                <div class="seg__top">
                  <span class="seg__type">{{ typeMeta(s.type).label }}</span>
                  <span v-if="s.code" class="seg__code mono">{{ s.code }}</span>
                  <span v-if="s.manualConfirm" class="tag tag--err">待人工确认</span>
                </div>
                <p class="seg__route">
                  <template v-if="s.type === 'hotel'">{{ s.to || '住宿' }}</template>
                  <template v-else>{{ s.from || '？' }} → {{ s.to || '？' }}</template>
                </p>
                <div class="seg__meta">
                  <span v-if="s.dateInvalid" class="seg__date">
                    {{ s.dateLiteral || '日期不明' }} <span class="tag tag--err">日期写法需确认</span>
                  </span>
                  <span v-else class="seg__date mono">{{ s.date || '日期待定' }}</span>
                  <span v-if="s.departTime" class="seg__time mono">出发 {{ s.departTime }}</span>
                  <span v-if="s.arriveTime" class="seg__time mono">
                    到达 {{ s.arriveTime }} <span v-if="s.arriveNextDay" class="tag tag--info">次日</span>
                  </span>
                  <span v-if="s.type === 'hotel' && s.hotelNights" class="seg__time mono">住 {{ s.hotelNights }} 晚</span>
                </div>
                <p v-if="s.plain && s.plain.voice" class="seg__plain">「{{ s.plain.voice }}」</p>
                <ul v-if="tipsOf(s).length" class="seg__tips">
                  <li v-for="(tip, ti) in tipsOf(s)" :key="ti">{{ tip }}</li>
                </ul>
                <p v-if="s.note" class="seg__note">{{ s.note }}</p>
              </div>
              <button class="btn btn--ghost seg__edit" :aria-expanded="editingId === s.id" @click="toggleEdit(s)">
                {{ editingId === s.id ? '收起' : '编辑' }}
              </button>
            </div>

            <form v-if="editingId === s.id" class="seg-form" @submit.prevent="saveSegment(s)">
              <div class="form-grid">
                <div class="form-field">
                  <label :for="'ed-date-' + s.id">日期</label>
                  <input :id="'ed-date-' + s.id" v-model="editForm.date" class="input" type="date">
                  <small v-if="s.dateLiteral" class="form-hint">原文写法：{{ s.dateLiteral }}</small>
                </div>
                <div class="form-field">
                  <label :for="'ed-depart-' + s.id">出发时间</label>
                  <input :id="'ed-depart-' + s.id" v-model="editForm.departTime" class="input" type="time">
                </div>
                <div class="form-field">
                  <label :for="'ed-arrive-' + s.id">到达时间</label>
                  <input :id="'ed-arrive-' + s.id" v-model="editForm.arriveTime" class="input" type="time">
                </div>
                <div class="form-field">
                  <label :for="'ed-from-' + s.id">出发地</label>
                  <input :id="'ed-from-' + s.id" v-model="editForm.from" class="input" type="text">
                </div>
                <div class="form-field">
                  <label :for="'ed-to-' + s.id">到达地</label>
                  <input :id="'ed-to-' + s.id" v-model="editForm.to" class="input" type="text">
                </div>
                <div class="form-field">
                  <label :for="'ed-code-' + s.id">车次 / 航班号</label>
                  <input :id="'ed-code-' + s.id" v-model="editForm.code" class="input" type="text">
                </div>
                <div class="form-field form-field--wide">
                  <label :for="'ed-note-' + s.id">备注</label>
                  <input :id="'ed-note-' + s.id" v-model="editForm.note" class="input" type="text">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn--brand">保存本段</button>
                <button type="button" class="btn btn--ghost" @click="editingId = ''">取消</button>
                <button
                  type="button"
                  class="btn btn--danger seg__del"
                  @click="deleteSegment(s)"
                >{{ confirmKey === 'seg-' + s.id ? '确认删除？' : '删除本段' }}</button>
              </div>
            </form>
          </div>
        </li>
      </ul>

      <div class="add-seg">
        <button v-if="!addingOpen" class="btn btn--ghost add-seg__btn" @click="addingOpen = true">＋ 添加一段</button>
        <div v-else class="add-seg__picker" role="group" aria-label="选择要添加的段类型">
          <span class="add-seg__label">添加哪种？</span>
          <button
            v-for="t in ADD_TYPES" :key="t.type"
            class="btn btn--ghost"
            @click="addSegment(t.type)"
          >{{ t.label }}</button>
          <button class="btn btn--ghost" @click="addingOpen = false">取消</button>
        </div>
      </div>

      <section v-if="checklistItems.length" class="paper-card checklist" aria-label="行前提醒">
        <div class="checklist__head">
          <h2 class="card-title" style="margin-bottom:0">行前提醒</h2>
          <span class="checklist__progress mono">{{ clProgress.done }}/{{ clProgress.total }}</span>
        </div>
        <div v-for="g in checklistGrouped" :key="g.group" class="checklist__group">
          <p class="checklist__group-title">{{ g.group }}</p>
          <label v-for="it in g.items" :key="it.id" class="check-item">
            <input type="checkbox" :checked="it.done" @change="toggleItem(it.id)">
            <span class="check-item__text" :class="{ 'is-done': it.done }">{{ it.text }}</span>
          </label>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-head__main { min-width: 0; flex: 1; }
.title-input {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font-family: var(--f-serif);
  font-size: var(--fs-display);
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0.02em;
  padding: 4px 10px;
  margin-left: -10px;
  border-radius: var(--r-s);
  color: var(--c-ink-0);
}
.title-input:hover { border-color: var(--c-line); background: var(--c-card); }
.title-input:focus { border-color: var(--c-brand); background: var(--c-card); }

.issue-box { display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.issue {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sm);
  border-left: 3px solid var(--c-line-strong);
  border-radius: 0 var(--r-s) var(--r-s) 0;
  background: var(--c-bg-1);
  color: var(--c-ink-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.issue--error { border-left-color: var(--c-err); color: var(--c-err); background: #FBEFEE; }
.issue--warn { border-left-color: var(--c-warn); color: var(--c-warn); background: #FBF3E4; }
.issue--info { border-left-color: var(--c-ink-2); }

.assist-bar { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-4); }
.assist-bar .hint { flex: 1; min-width: 200px; margin: 0; }
.assist-preview {
  padding: var(--sp-4) var(--sp-4);
  margin-bottom: var(--sp-4);
  border: 1px solid var(--c-brand);
  border-radius: var(--r-m);
  background: var(--c-brand-soft);
}
.assist-preview__title { margin: 0 0 var(--sp-2); font-size: var(--fs-base); font-weight: 700; color: var(--c-brand); display: flex; align-items: center; gap: var(--sp-2); }
.assist-preview__list { margin: 0 0 var(--sp-3); padding-left: 1.2em; font-size: var(--fs-sm); color: var(--c-ink-1); display: flex; flex-direction: column; gap: 4px; }
.assist-preview__list li { list-style: disc; }

.elder-live { margin-bottom: var(--sp-5); }
.elder-live__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-3); }
.elder-live__mode { font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-2); }
.elder-live__mode.is-on { color: var(--c-brand); }
.elder-live__empty { margin: var(--sp-2) 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); }
.elder-loc {
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.elder-loc__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
.elder-loc__label { font-size: var(--fs-base); font-weight: 700; }
.elder-loc__time { font-size: var(--fs-xs); color: var(--c-ink-2); }
.elder-loc__coord { margin: var(--sp-2) 0; font-size: var(--fs-lg); font-weight: 700; color: var(--c-ink-0); overflow-wrap: anywhere; }
.elder-loc__meta { margin: 0 0 var(--sp-2); display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap; font-size: var(--fs-xs); color: var(--c-ink-2); }
.elder-timeline { margin-top: var(--sp-4); }
.elder-feed { display: flex; flex-direction: column; }
.elder-feed__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: 1px dashed var(--c-line);
}
.elder-feed__item:last-child { border-bottom: 0; }
.elder-feed__text { font-size: var(--fs-base); color: var(--c-ink-1); min-width: 0; overflow-wrap: anywhere; }
.elder-feed__time { flex: none; font-size: var(--fs-xs); color: var(--c-ink-2); }

.seg-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.seg { padding: 0; overflow: hidden; }
.seg--warn { border-color: #E4CE9C; }
.seg__alert {
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-sm);
  color: var(--c-warn);
  background: #FBF3E4;
  border-bottom: 1px dashed #E4CE9C;
}
.seg__body { padding: var(--sp-4) var(--sp-4); }
.seg__main { display: flex; gap: var(--sp-3); align-items: flex-start; }
.seg__icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--c-bg-2);
  color: var(--c-ink-0);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seg__info { flex: 1; min-width: 0; }
.seg__top { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.seg__type { font-weight: 600; font-size: var(--fs-sm); }
.seg__code { color: var(--c-brand); font-weight: 700; letter-spacing: 0.06em; }
.seg__route { margin: 4px 0 0; font-size: var(--fs-lg); font-weight: 700; font-family: var(--f-serif); }
.seg__meta {
  margin-top: var(--sp-1);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
  font-size: var(--fs-sm);
  color: var(--c-ink-1);
}
.seg__plain { margin: var(--sp-2) 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); background: var(--c-brand-soft); border-radius: var(--r-s); padding: 6px 10px; }
.seg__tips {
  margin: var(--sp-2) 0 0;
  padding-left: 1.2em;
  font-size: var(--fs-sm);
  color: var(--c-ink-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.seg__tips li { list-style: disc; }
.seg__note { margin: var(--sp-2) 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); }
.seg__edit { flex: none; }
.seg__del { margin-left: auto; }

.seg-form {
  margin-top: var(--sp-4);
  padding-top: var(--sp-4);
  border-top: 1px dashed var(--c-line);
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--sp-3);
}
.form-field label { display: block; font-size: var(--fs-sm); color: var(--c-ink-1); margin-bottom: 4px; }
.form-field--wide { grid-column: 1 / -1; }
.form-hint { display: block; margin-top: 4px; font-size: var(--fs-xs); color: var(--c-ink-2); }
.form-actions { margin-top: var(--sp-3); display: flex; gap: var(--sp-2); flex-wrap: wrap; }

.add-seg { margin-top: var(--sp-2); display: flex; justify-content: center; }
.add-seg__btn { border-style: dashed; }
.add-seg__picker {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  justify-content: center;
  padding: var(--sp-3) var(--sp-4);
  border: 1px dashed var(--c-line-strong);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.add-seg__label { font-size: var(--fs-sm); color: var(--c-ink-1); }

.checklist { margin-top: var(--sp-4); }
.checklist__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-3); }
.checklist__progress { font-size: var(--fs-sm); color: var(--c-ink-2); }
.checklist__group { margin-top: var(--sp-3); }
.checklist__group-title { margin: 0 0 4px; font-size: var(--fs-sm); font-weight: 700; color: var(--c-brand); }
.check-item { display: flex; align-items: flex-start; gap: var(--sp-3); padding: 6px 0; cursor: pointer; }
.check-item input[type="checkbox"] { width: auto; margin-top: 4px; flex: none; accent-color: var(--c-brand); }
.check-item__text { font-size: var(--fs-base); color: var(--c-ink-1); }
.check-item__text.is-done { color: var(--c-ink-2); text-decoration: line-through; }

@media (max-width: 640px) {
  .page-head { flex-direction: column; align-items: stretch; }
  .btn-row { justify-content: flex-end; }
}
</style>
