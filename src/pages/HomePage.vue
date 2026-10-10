<script setup>
import { ref, computed } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, removeTrip, clearDraft } from '../core/store.js'
import { TYPE_LABELS, issueCount } from '../core/agents.js'
import { toDateStr } from '../core/agents.js'

const q = ref('')

const filteredTrips = computed(() => {
  const list = [...store.data.trips]
  const kw = q.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(t => {
    const hay = [t.title, ...(t.segments || []).flatMap(s => [s.code, s.from, s.to])]
      .join(' ').toLowerCase()
    return hay.includes(kw)
  })
})

function tripSummary(trip) {
  const segs = trip.segments || []
  const byType = {}
  for (const s of segs) byType[s.type] = (byType[s.type] || 0) + 1
  const parts = Object.entries(byType).map(([t, n]) => `${TYPE_LABELS[t]} ${n}`)
  return `共 ${segs.length} 段：${parts.join(' · ')}`
}

function startDate(trip) {
  const seg = (trip.segments || []).find(s => s.date)
  return seg ? seg.date : ''
}

const confirmKey = ref('')
let confirmTimer = null
function askConfirm(key) {
  if (confirmKey.value === key) return true
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}

function doRemove(trip) {
  if (!askConfirm('trip:' + trip.id)) return
  removeTrip(trip.id)
  toast('已删除「' + trip.title + '」', 'info')
  confirmKey.value = ''
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <p class="kicker">安程 · 行程</p>
        <h1 class="page-title">行程 · {{ store.data.trips.length }} 条</h1>
      </div>
      <a class="btn btn--brand btn--lg" href="#/import">+ 导入行程</a>
    </div>

    <div v-if="store.data.draft" class="paper-card paper-card--flat draft-tip">
      <span>有一份没发完的草稿（{{ store.data.draft.savedAt ? '存于 ' + new Date(store.data.draft.savedAt).toLocaleString('zh-CN') : '未保存' }}）</span>
      <span class="btn-row">
        <a class="btn" href="#/import">继续编辑</a>
        <button class="btn btn--ghost" @click="clearDraft(); toast('草稿已丢弃', 'info')">丢弃</button>
      </span>
    </div>

    <div class="field" style="max-width:420px">
      <input v-model="q" class="input" type="search" placeholder="搜标题 / 车次 / 站名">
    </div>

    <div v-if="filteredTrips.length" class="trip-list list-enter">
      <div v-for="(trip, i) in filteredTrips" :key="trip.id" class="paper-card trip-card">
        <a class="trip-card__main" :href="'#/trip/' + trip.id">
          <span class="trip-card__no mono">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="trip-card__body">
            <span class="trip-card__title">{{ trip.title || '未命名行程' }}</span>
            <span class="trip-card__meta">
              <span v-if="startDate(trip)" class="mono">{{ startDate(trip) }}</span>
              {{ tripSummary(trip) }}
            </span>
            <span class="trip-card__tags">
              <span v-if="issueCount(trip, 'error')" class="tag tag--err">{{ issueCount(trip, 'error') }} 处待确认</span>
              <span v-if="issueCount(trip, 'warn')" class="tag tag--warn">{{ issueCount(trip, 'warn') }} 处提醒</span>
            </span>
          </span>
        </a>
        <span class="trip-card__acts">
          <a class="btn" :href="'#/trip/' + trip.id">查看</a>
          <a class="btn" :href="'#/share/' + trip.id">分享</a>
          <button class="btn btn--danger" @click="doRemove(trip)">
            {{ confirmKey === 'trip:' + trip.id ? '确认删除？' : '删除' }}
          </button>
        </span>
      </div>
    </div>

    <div v-else class="paper-card empty">
      <div class="empty__icon">tickets</div>
      <p>{{ q ? '没搜到相关行程' : '还没有行程' }}</p>
      <p v-if="!q" style="margin-top:12px"><a class="btn btn--brand" href="#/import">去导入第一份行程</a></p>
    </div>
  </div>
</template>

<style scoped>
.draft-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  font-size: var(--fs-sm);
  color: var(--c-ink-1);
}
.trip-list { display: flex; flex-direction: column; gap: var(--sp-3); }
.trip-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: 0;
  padding: var(--sp-4) var(--sp-5);
}
.trip-card__main {
  flex: 1;
  display: flex;
  gap: var(--sp-4);
  align-items: flex-start;
  color: inherit;
  min-width: 0;
}
.trip-card__main:hover { text-decoration: none; }
.trip-card__no { color: var(--c-brand); font-weight: 700; font-size: var(--fs-sm); padding-top: 4px; }
.trip-card__body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.trip-card__title { font-weight: 700; font-size: var(--fs-lg); font-family: var(--f-serif); }
.trip-card__meta { font-size: var(--fs-sm); color: var(--c-ink-2); display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.trip-card__tags { display: flex; gap: var(--sp-2); margin-top: 2px; }
.trip-card__acts { display: flex; gap: var(--sp-2); flex-shrink: 0; }
@media (max-width: 640px) {
  .trip-card { flex-direction: column; align-items: stretch; }
  .trip-card__acts { justify-content: flex-end; }
}
</style>
