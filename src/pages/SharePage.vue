<script setup>
// 分享页：选有效期 + 长辈端显示 → 生成自包含链接 + 6 位码 + 二维码 → 发短信/邮件给长辈。
import { ref, computed, onMounted } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, getTrip, saveShare, listShares, ELDER_SCALES, ELDER_THEMES, elderScaleName, elderThemeName } from '../core/store.js'
import { encodeShare, buildShareUrl, makeShareCode, DEFAULT_TTL_DAYS } from '../core/share-codec.js'
import { buildElderCards } from '../core/agents.js'
import { qrInfo } from '../core/qr.js'
import { deliver, probeChannel, KIND_SMS, KIND_EMAIL } from '../core/notify.js'
import { rules } from '../core/accounts.js'

const props = defineProps({ params: { type: Object, default: () => ({}) } })

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtDateTime(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmt(d)} ${hh}:${mm}`
}

const trip = computed(() => getTrip(props.params.tripId))
const tripParts = computed(() => (trip.value && trip.value.segments) || [])

// ---- 区1：有效期 ----
const TTL_OPTIONS = [7, 30, 90]
const days = ref(DEFAULT_TTL_DAYS())

// ---- 区1.5：长辈端显示（随分享一起打包，长辈打开就是子女选的这个样子）----
const elderScale = ref(1)
const elderTheme = ref('day')
// 位置共享：默认关。开了只是「允许」—— 长辈端还要自己点一次才会真的传位置。
const shareLocation = ref(false)

// ---- 区2：生成分享 ----
// 二维码承载边长：248px 是"每格 ≥2.4px"与"手机屏放得下"之间的实测折中点
const QR_BOX = 248
const result = ref(null) // { url, code6, token, exp, dataUrl, qr }
const linkInput = ref(null)
// 逐位拆开，配合全局 .code-digit 样式一位一位「翻」进来
const codeDigits = computed(() => String((result.value && result.value.code6) || '').split(''))

function generate() {
  const t = trip.value
  if (!t) return
  const now = Date.now()
  const payload = {
    eid: uid('eld'),
    title: t.title,
    gen: now,
    exp: now + days.value * 86400000,
    cards: buildElderCards(t, store.data.family),
    // 称呼按长辈视角存（FamilyPage 里已说明），这里连微信/QQ 和备注一起带过去
    contacts: store.data.family.map((f) => ({
      name: f.name,
      phone: f.phone,
      relation: f.relation || '',
      im: f.im || '',
      note: f.note || '',
    })),
    prefs: { scale: elderScale.value, theme: elderTheme.value, shareLocation: shareLocation.value },
  }
  const enc = encodeShare(payload)
  const token = enc.token
  const url = buildShareUrl(token)
  const code6 = makeShareCode({ eid: payload.eid, gen: enc.gen, title: t.title })
  saveShare({
    id: uid('sh'),
    tripId: t.id,
    token,
    code6,
    createdAt: now,
    exp: payload.exp,
    title: t.title,
  })
  // 二维码：M 级优先，装不下退 L 级（容量更大）；两级都超上限才算装不下，
  // 那就让「复制链接 / 6 位码 / 发短信邮件」三条路兜底，不让分享卡在二维码上。
  const info = qrInfo(url, { box: QR_BOX })
  result.value = { url, code6, token, exp: payload.exp, dataUrl: info ? info.dataUrl : null, qr: info }
  refreshChannels()
  toast('分享链接已生成', 'ok')
}

// ---- 区3：发给长辈（短信 / 邮件双通道）----
// 服务端配了服务商就直接送达；没配就调起本机短信/邮件 App，正文已经写好。
// 页面把"实际走哪条路"如实写出来，不假装浏览器能自己发短信。
const sendTo = ref('')
const sendErr = ref('')
const sending = ref('')
const sendNote = ref('')
const channels = ref({ sms: null, email: null })

async function refreshChannels() {
  const [sms, email] = await Promise.all([probeChannel(KIND_SMS), probeChannel(KIND_EMAIL)])
  channels.value = { sms, email }
}
onMounted(refreshChannels)

const channelHint = computed(() => {
  const c = channels.value
  return [
    c.sms ? `短信已接通服务端（${c.sms}）` : '短信将用你手机上的短信 App',
    c.email ? `邮件已接通服务端（${c.email}）` : '邮件将用你手机上的邮件 App',
  ].join('；')
})

function openHref(href) {
  const a = document.createElement('a')
  a.href = href
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function sendBy(kind) {
  sendErr.value = ''
  sendNote.value = ''
  if (!result.value) { sendErr.value = '先生成分享链接，再发出去'; return }
  const to = sendTo.value.trim()
  const bad = kind === KIND_SMS ? rules.phone(to) : rules.email(to)
  if (bad) { sendErr.value = kind === KIND_SMS ? '手机号填 11 位，如 13800000000' : bad; return }
  sending.value = kind
  try {
    const out = await deliver({
      channel: kind,
      to,
      link: result.value.url,
      code6: result.value.code6,
      name: store.account ? store.account.name : '',
      tripTitle: trip.value ? trip.value.title : '',
    })
    if (out.via === 'server') {
      sendNote.value = `已通过服务端发到 ${to}（${out.provider}）`
      toast('已发送', 'ok')
    } else {
      sendNote.value = `已打开你手机上的${kind === KIND_SMS ? '短信' : '邮件'}，正文与 6 位码都写好了，按发送就行`
      openHref(out.href)
    }
  } catch (e) {
    sendErr.value = '发送失败：' + ((e && e.message) || e)
  } finally {
    sending.value = ''
  }
}

async function copyLink(url) {
  let ok = false
  try {
    await navigator.clipboard.writeText(url)
    ok = true
  } catch {
    // 降级：select + execCommand
    ok = fallbackCopy(url)
  }
  toast(ok ? '链接已复制' : '复制失败，请手动复制', ok ? 'ok' : 'warn')
}
function fallbackCopy(url) {
  const input = linkInput.value
  let el = null
  if (input && input.value === url) {
    el = input
  } else {
    el = document.createElement('textarea')
    el.value = url
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
  }
  if (el.focus) el.focus()
  el.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  if (el.tagName === 'TEXTAREA') el.remove()
  return ok
}
function previewElder() {
  if (!result.value) return
  window.open(result.value.url, '_blank')
}

// ---- 区3：分享记录 ----
const tripShares = computed(() => {
  const t = trip.value
  if (!t) return []
  return listShares().filter((s) => s.tripId === t.id)
})
function shareActive(s) {
  return Date.now() < s.exp
}
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
        <div>
          <p class="kicker">分享 · {{ tripParts.length }} 段</p>
          <h1 class="page-title">把行程发给长辈</h1>
          <p class="hint" style="margin-top:8px">{{ trip.title || '未命名行程' }}</p>
        </div>
        <div>
          <button class="btn btn--ghost" @click="navigate('/trip/' + trip.id)">返回行程</button>
        </div>
      </header>

      <section class="paper-card" aria-label="分享有效期">
        <h2 class="card-title">有效期</h2>
        <div class="ttl-row">
          <label
            v-for="d in TTL_OPTIONS"
            :key="d"
            class="ttl-card"
            :class="{ 'is-active': days === d }"
          >
            <input v-model.number="days" class="ttl-card__radio" type="radio" name="ttl" :value="d">
            <span class="ttl-card__num mono">{{ d }}</span>
            <span class="ttl-card__unit">天</span>
          </label>
        </div>
        <p class="hint" style="margin-top:12px">过期后链接自动失效，长辈打开会看到「已过期」。</p>
      </section>

      <section class="paper-card" aria-label="长辈端显示">
        <h2 class="card-title">长辈端显示</h2>
        <p class="hint">选好会跟着链接一起发过去，长辈打开就是你选的这个样子；长辈自己也能再调。</p>
        <div class="pref-row">
          <span class="pref-row__label">字大小</span>
          <div class="pref-row__opts" role="group" aria-label="长辈端字大小">
            <button
              v-for="s in ELDER_SCALES" :key="s"
              type="button"
              class="pref-btn"
              :class="{ 'is-active': elderScale === s }"
              :aria-pressed="elderScale === s"
              @click="elderScale = s"
            >{{ elderScaleName(s) }}</button>
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-row__label">主题</span>
          <div class="pref-row__opts" role="group" aria-label="长辈端主题">
            <button
              v-for="t in ELDER_THEMES" :key="t"
              type="button"
              class="pref-btn"
              :class="{ 'is-active': elderTheme === t }"
              :aria-pressed="elderTheme === t"
              @click="elderTheme = t"
            >{{ elderThemeName(t) }}</button>
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-row__label">位置共享</span>
          <label class="loc-switch">
            <input v-model="shareLocation" type="checkbox">
            <span>{{ shareLocation ? '允许长辈共享位置' : '不允许' }}</span>
          </label>
        </div>
        <p class="hint" style="margin-top:12px">打开后，长辈端会出现「让子女看到我在哪」按钮。长辈得自己点一下才会传位置，随时能停；位置只保留最新一次。</p>
      </section>

      <section class="paper-card" aria-label="生成分享链接">
        <h2 class="card-title">生成分享链接</h2>
        <button class="btn btn--brand btn--lg" @click="generate">生成分享链接</button>

        <div v-if="result" class="share-result">
          <div class="qr-card">
            <img v-if="result.dataUrl" :src="result.dataUrl" :width="QR_BOX" :height="QR_BOX" alt="长辈端二维码">
            <div v-else class="qr-fallback">
              <p class="qr-fallback__title">这次行程太长，二维码装不下</p>
              <p class="hint">不用扫码也能送过去：复制下面的链接，或者用「发给长辈」发短信 / 邮件，任选一条。</p>
            </div>
          </div>
          <p v-if="result.qr && result.qr.pxPerModule < 2.4" class="qr-dense">
            行程较长，码比较密（每格 {{ result.qr.pxPerModule.toFixed(2) }}px）；扫不动就直接复制链接。
          </p>

          <div class="link-row">
            <label class="sr-only" for="share-url">分享链接</label>
            <input
              id="share-url"
              ref="linkInput"
              class="input link-row__input"
              type="text"
              readonly
              :value="result.url"
              @focus="$event.target.select()"
            >
            <button class="btn" @click="copyLink(result.url)">复制链接</button>
          </div>

          <div class="code-row">
            <span class="code-digits" aria-label="六位数字码">
              <span v-for="(d, i) in codeDigits" :key="i" class="code-digit">{{ d }}</span>
            </span>
            <p class="hint" style="margin-top:10px">长辈在本机打开长辈端可输码；扫码或点链接任何设备都行，不用登录</p>
          </div>

          <div>
            <button class="btn btn--ghost" @click="previewElder">预览长辈页</button>
          </div>
        </div>
      </section>

      <section class="paper-card" aria-label="发给长辈">
        <h2 class="card-title">发给长辈</h2>
        <p class="hint">填手机号或邮箱，把链接直接送过去。{{ channelHint }}</p>
        <div class="send-row">
          <label class="sr-only" for="send-to">手机号或邮箱</label>
          <input id="send-to" v-model="sendTo" class="input send-row__input" type="text" autocomplete="off" placeholder="13800000000 或 name@example.com">
          <button class="btn btn--brand" :disabled="sending !== ''" @click="sendBy(KIND_SMS)">
            {{ sending === KIND_SMS ? '发送中…' : '发短信' }}
          </button>
          <button class="btn" :disabled="sending !== ''" @click="sendBy(KIND_EMAIL)">
            {{ sending === KIND_EMAIL ? '发送中…' : '发邮件' }}
          </button>
        </div>
        <p v-if="sendErr" class="send-row__err" role="alert">{{ sendErr }}</p>
        <p v-if="sendNote" class="send-row__note" role="status">{{ sendNote }}</p>
      </section>

      <section class="paper-card" aria-label="分享记录">
        <h2 class="card-title">本行程的分享记录</h2>
        <ul v-if="tripShares.length" class="share-list">
          <li v-for="s in tripShares" :key="s.id" class="share-list__item">
            <div class="share-list__info">
              <p class="share-list__line">生成于 {{ fmtDateTime(s.createdAt) }}</p>
              <p class="share-list__line">有效期至 {{ fmt(new Date(s.exp)) }}</p>
            </div>
            <div class="share-list__actions">
              <span class="tag" :class="shareActive(s) ? 'tag--brand' : 'tag--err'">
                {{ shareActive(s) ? '有效' : '已过期' }}
              </span>
              <button class="btn btn--ghost" @click="copyLink(buildShareUrl(s.token))">复制链接</button>
            </div>
          </li>
        </ul>
        <p v-else class="hint">还没有生成过分享。选好有效期，点上面的按钮。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ttl-row { display: flex; gap: var(--sp-3); flex-wrap: wrap; }
.ttl-card {
  flex: 1;
  min-width: 96px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: var(--sp-4) var(--sp-3);
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-card);
  cursor: pointer;
  transition: border-color var(--dur-1), background var(--dur-1);
}
.ttl-card:hover { background: var(--c-bg-1); }
.ttl-card.is-active {
  border-color: var(--c-brand);
  background: var(--c-brand-soft);
  box-shadow: inset 0 0 0 1px var(--c-brand);
}
.ttl-card__radio { accent-color: var(--c-brand); align-self: center; }
.ttl-card__num { font-size: 26px; font-weight: 700; color: var(--c-ink-0); }
.ttl-card.is-active .ttl-card__num { color: var(--c-brand); }
.ttl-card__unit { font-size: var(--fs-sm); color: var(--c-ink-2); }

.pref-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
  margin-top: var(--sp-3);
}
.pref-row__label { flex: none; font-size: var(--fs-base); color: var(--c-ink-1); }
.pref-row__opts { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.pref-btn {
  min-width: 76px;
  min-height: 38px;
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-sm);
  font-weight: 600;
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  color: var(--c-ink-1);
  cursor: pointer;
}
.pref-btn:hover { border-color: var(--c-brand); color: var(--c-ink-0); }
.pref-btn.is-active {
  border-color: var(--c-brand);
  background: var(--c-brand-soft);
  color: var(--c-brand);
}
.loc-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  min-height: 38px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  font-size: var(--fs-sm);
  color: var(--c-ink-1);
  cursor: pointer;
}
.loc-switch input { accent-color: var(--c-brand); }

.share-result {
  margin-top: var(--sp-5);
  padding-top: var(--sp-5);
  border-top: 1px dashed var(--c-line);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.qr-card {
  align-self: center;
  background: #FFFFFF;
  padding: var(--sp-3);
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
}
.qr-card img { display: block; }
.qr-fallback { max-width: 248px; padding: var(--sp-2); }
.qr-fallback__title { margin: 0 0 6px; font-size: var(--fs-base); font-weight: 600; color: var(--c-ink-0); }
.qr-dense { margin: 0; text-align: center; font-size: var(--fs-sm); color: var(--c-warn); }

.link-row { display: flex; gap: var(--sp-2); align-items: stretch; flex-wrap: wrap; }
.link-row__input { flex: 1; min-width: 200px; font-size: var(--fs-xs); color: var(--c-ink-1); }

.code-row { text-align: center; }

.send-row { display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: stretch; margin-top: var(--sp-3); }
.send-row__input { flex: 1; min-width: 200px; }
.send-row__err { margin: var(--sp-3) 0 0; font-size: var(--fs-sm); color: var(--c-err); }
.send-row__note {
  margin: var(--sp-3) 0 0;
  padding: var(--sp-2) var(--sp-3);
  border-left: 3px solid var(--c-ok);
  background: var(--c-brand-soft);
  font-size: var(--fs-sm);
  color: var(--c-ink-0);
}

.share-list { display: flex; flex-direction: column; }
.share-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  padding: var(--sp-3) 0;
  border-bottom: 1px dashed var(--c-line);
}
.share-list__item:last-child { border-bottom: none; }
.share-list__info { min-width: 0; }
.share-list__line { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--c-ink-1); }
.share-list__actions { display: flex; align-items: center; gap: var(--sp-2); }

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
