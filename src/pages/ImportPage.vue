<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, upsertTrip, setDraft, clearDraft } from '../core/store.js'
import { runPipeline, issueLabel } from '../core/agents.js'
import { runAssist, applyAssist, hasWork, extractTextFromImage } from '../core/ai.js'
import { loadModelConfig, isConfigured, reasonText } from '../core/model.js'
import { toDateStr } from '../core/agents.js'

const raw = ref('')
const fallbackDate = ref(toDateStr(new Date()))
const parsing = ref(false)
const result = ref(null)
const restored = ref(false)
const restoring = ref(false)

let modelReady = false
let visionReady = false
function refreshModelFlags() {
  const cfg = loadModelConfig()
  modelReady = isConfigured(cfg)
  visionReady = modelReady && !!cfg.vision
}
refreshModelFlags()

onMounted(() => {
  const d = store.data.draft
  if (d && d.raw) {
    restoring.value = true
    raw.value = d.raw
    if (d.fallbackDate) fallbackDate.value = d.fallbackDate
    restored.value = true
    restoring.value = false
  }
})

let draftTimer = null
watch([raw, fallbackDate], () => {
  if (restoring.value) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    if (raw.value.trim()) {
      setDraft({ raw: raw.value, fallbackDate: fallbackDate.value, savedAt: Date.now() })
    } else if (store.data.draft) {
      clearDraft()
    }
  }, 800)
})

const reviewCount = computed(() =>
  result.value ? (result.value.issues || []).length + (result.value.unparsed || []).length : 0
)
const canAssist = computed(() => result.value && hasWork(result.value))

function parse() {
  if (!raw.value.trim()) {
    toast('先粘贴一点行程文字', 'warn')
    return
  }
  parsing.value = true
  setTimeout(() => {
    result.value = runPipeline(raw.value, { today: toDateStr(new Date()), fallbackDate: fallbackDate.value })
    parsing.value = false
    const n = result.value.segments.length
    if (n === 0) {
      toast('一段都没认出来，看看是不是贴错了', 'warn')
    } else {
      toast(`认出 ${n} 段`, 'ok')
    }
  }, 60)
}

function resetResult() {
  result.value = null
  assistPreview.value = null
}

// ---------- OCR ----------
const imgInput = ref(null)
const ocrBusy = ref(false)
function pickImage() {
  imgInput.value?.click()
}
async function onImage(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const dataUrl = await new Promise(res => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.readAsDataURL(file)
  })
  ocrBusy.value = true
  const out = await extractTextFromImage(dataUrl, { cfg: loadModelConfig() })
  ocrBusy.value = false
  if (!out.ok) {
    toast('识字失败：' + reasonText(out.reason), 'err')
    return
  }
  raw.value = (raw.value ? raw.value + '\n' : '') + out.text
  toast('认出文字了，已填入，请检查', 'ok')
}

// ---------- AI 补全 ----------
const assistBusy = ref(false)
const assistPreview = ref(null)

async function doAssist() {
  if (!result.value || assistBusy.value) return
  assistBusy.value = true
  assistPreview.value = null
  const out = await runAssist(result.value, {
    cfg: loadModelConfig(),
    today: toDateStr(new Date()),
    fallbackDate: fallbackDate.value,
  })
  assistBusy.value = false
  if (!out.ok) {
    toast('AI 补全失败：' + reasonText(out.reason), 'err')
    return
  }
  if (out.summary.count === 0) {
    toast('AI 看了一圈，没有能补的地方', 'info')
    return
  }
  out.viaLabel = out.via === 'model' ? '模型' : '演示'
  assistPreview.value = out
}

function applyPreview() {
  if (!assistPreview.value) return
  applyAssist(result.value, assistPreview.value.patches, { today: toDateStr(new Date()) })
  assistPreview.value = null
  toast('补全完成，请过一眼再确认导入', 'ok')
}

function confirmImport() {
  if (!result.value || !result.value.segments.length) {
    toast('没有可导入的段', 'warn')
    return
  }
  const trip = {
    id: uid('trip'),
    title: (result.value.segments[0].plain && result.value.segments[0].plain.title || '新行程').slice(0, 40),
    segments: result.value.segments,
    checklist: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  upsertTrip(trip)
  clearDraft()
  toast('已导入 ' + trip.segments.length + ' 段', 'ok')
  navigate('/trip/' + trip.id)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <p class="kicker">安程 · 导入</p>
        <h1 class="page-title">导入行程</h1>
      </div>
    </div>

    <div class="paper-card">
      <div class="imp-ocr">
        <button class="btn" :disabled="!visionReady || ocrBusy" @click="pickImage">
          {{ ocrBusy ? '正在认字…' : '传一张车票截图识字' }}
        </button>
        <p class="hint">
          {{ visionReady ? '认出的文字会填进下面的框，不会自动解析' : '要在「我的 → 模型配置」里配一个支持图片的模型才能用' }}
        </p>
        <input ref="imgInput" type="file" accept="image/*" hidden @change="onImage">
      </div>

      <div class="field">
        <label class="field__label" for="raw">行程原文（12306 短信、购票记录、随手记的都行）</label>
        <textarea
          id="raw" v-model="raw" class="textarea" rows="9" spellcheck="false"
          placeholder="10月12日 G7601 上海虹桥站 08:00 开，12:24 到北京南站&#10;次日 住北京王府井希尔顿酒店 2 晚&#10;10月15日 CA1831 北京首都机场 T3 → 厦门高崎机场"
        ></textarea>
      </div>

      <div class="field">
        <label class="field__label" for="fallback">没写日期的行，先当哪天（兜底日期）</label>
        <input id="fallback" v-model="fallbackDate" class="input" type="date">
      </div>

      <p v-if="restored" class="tag tag--info" style="margin-bottom:12px">已恢复上次没发完的草稿</p>

      <div class="btn-row">
        <button class="btn btn--brand btn--lg" :disabled="parsing" @click="parse">
          {{ parsing ? '正在解析…' : '解析行程' }}
        </button>
        <button v-if="result" class="btn btn--ghost" @click="resetResult">重新解析</button>
      </div>
    </div>

    <template v-if="result">
      <div v-if="reviewCount" class="paper-card imp-review">
        <h3 class="card-title">先看这里 · {{ reviewCount }} 处需要确认</h3>
        <ul class="issue-list">
          <li v-for="(iss, i) in result.issues" :key="'iss' + i" class="issue">
            <span class="tag" :class="iss.level === 'error' ? 'tag--err' : iss.level === 'warn' ? 'tag--warn' : 'tag--info'">
              {{ issueLabel(iss.code) }}
            </span>
            <span class="issue__msg">{{ iss.message }}</span>
          </li>
        </ul>
        <div v-if="result.unparsed.length" class="unparsed">
          <p class="hint">这几行没看懂，可以手动补充或忽略：</p>
          <p v-for="(line, i) in result.unparsed" :key="'up' + i" class="unparsed__line mono">{{ line }}</p>
        </div>
      </div>

      <div v-if="canAssist" class="paper-card imp-ai">
        <h3 class="card-title">AI 一键补全</h3>
        <p class="hint" style="margin-bottom:12px">
          {{ modelReady ? '调用你配置的模型' : '没配模型也能用：走内置演示管线，按规则推算缺的日期和时间，先预览再落地' }}。只填空，不覆盖已有的值。
        </p>
        <button class="btn btn--brand" :disabled="assistBusy" @click="doAssist">
          {{ assistBusy ? '正在想…' : 'AI 一键补全' }}
        </button>

        <div v-if="assistPreview" class="ai-preview">
          <p class="ai-preview__count">
            <span class="tag tag--brand">{{ assistPreview.viaLabel }}</span>
            将补全 {{ assistPreview.summary.count }} 项，先预览：
          </p>
          <ul class="ai-preview__list">
            <li v-for="(s, i) in assistPreview.summary.items" :key="'pi' + i">{{ s }}</li>
            <li v-for="(s, i) in assistPreview.summary.news" :key="'pn' + i">{{ s }}</li>
          </ul>
          <div class="btn-row">
            <button class="btn btn--brand" @click="applyPreview">应用补全</button>
            <button class="btn btn--ghost" @click="assistPreview = null">取消</button>
          </div>
        </div>
      </div>

      <div class="paper-card">
        <h3 class="card-title">解析结果 · {{ result.segments.length }} 段</h3>
        <div class="seg-list">
          <div v-for="(seg, i) in result.segments" :key="seg.id" class="seg">
            <div class="seg__head">
              <span class="seg__no mono">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="tag tag--info">{{ seg.type === 'train' ? '火车' : seg.type === 'flight' ? '航班' : seg.type === 'hotel' ? '住宿' : '接送' }}</span>
              <span v-if="seg.code" class="seg__code mono">{{ seg.code }}</span>
              <span v-if="seg.manualConfirm" class="tag tag--warn">待人工确认</span>
            </div>
            <p class="seg__route">
              <template v-if="seg.type === 'hotel'">{{ seg.to || '住宿' }}</template>
              <template v-else>{{ seg.from || '？' }} → {{ seg.to || '？' }}</template>
            </p>
            <p class="seg__when">
              <span v-if="seg.dateInvalid" class="tag tag--err">{{ seg.dateLiteral || '日期写法' }} 需确认</span>
              <span v-else-if="seg.date" class="mono">{{ seg.date }}</span>
              <span v-if="seg.departTime" class="mono">{{ seg.departTime }}</span>
              <span v-if="seg.arriveTime" class="mono">→ {{ seg.arriveTime }}<span v-if="seg.arriveNextDay" class="tag tag--info">次日</span></span>
              <span v-if="seg.type === 'hotel' && seg.hotelNights" class="mono">住 {{ seg.hotelNights }} 晚</span>
            </p>
            <p v-if="seg.plain && seg.plain.voice" class="seg__plain">「{{ seg.plain.voice }}」</p>
            <p v-if="seg.plain && seg.plain.tips.length" class="seg__tips">
              <span v-for="(t, j) in seg.plain.tips" :key="j" class="tag tag--info">{{ t }}</span>
            </p>
          </div>
        </div>

        <div class="btn-row" style="margin-top:16px">
          <button class="btn btn--brand btn--lg" @click="confirmImport">确认导入</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.imp-ocr { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-4); }
.imp-ocr .hint { flex: 1; min-width: 220px; margin: 0; }
.issue-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.issue { display: flex; gap: var(--sp-2); align-items: baseline; font-size: var(--fs-sm); }
.issue__msg { color: var(--c-ink-1); }
.unparsed { margin-top: var(--sp-3); border-top: 1px dashed var(--c-line); padding-top: var(--sp-3); }
.unparsed__line { font-size: var(--fs-xs); color: var(--c-ink-2); background: var(--c-bg-1); border-radius: var(--r-s); padding: 4px 8px; margin-bottom: 4px; }
.ai-preview { margin-top: var(--sp-4); border-top: 1px dashed var(--c-line); padding-top: var(--sp-4); }
.ai-preview__count { font-weight: 600; margin-bottom: var(--sp-2); }
.ai-preview__list { font-size: var(--fs-sm); color: var(--c-ink-1); padding-left: 1.2em; display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--sp-3); }
.ai-preview__list li { list-style: disc; }
.seg-list { display: flex; flex-direction: column; gap: var(--sp-3); }
.seg { border: 1px solid var(--c-line); border-radius: var(--r-m); padding: var(--sp-3) var(--sp-4); }
.seg__head { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 6px; flex-wrap: wrap; }
.seg__no { color: var(--c-brand); font-weight: 700; font-size: var(--fs-xs); }
.seg__code { font-weight: 700; }
.seg__route { font-weight: 700; font-size: var(--fs-lg); font-family: var(--f-serif); }
.seg__when { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; font-size: var(--fs-sm); color: var(--c-ink-1); }
.seg__plain { font-size: var(--fs-sm); color: var(--c-ink-2); background: var(--c-brand-soft); border-radius: var(--r-s); padding: 6px 10px; margin-top: 6px; }
.seg__tips { display: flex; gap: var(--sp-1); flex-wrap: wrap; margin-top: 6px; }
</style>
