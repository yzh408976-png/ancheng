<script setup>
// 行程页：一页只讲一件事 —— 这趟怎么走。
// 整趟行程从头到尾都列出来，跨天的那几段在卡片上标日期，长辈只要往下看就不会漏。
// 页头是一句大字陈述（"一共 3 段行程"），不放产品名、不放 logo、不放装饰图标。
//
// 卡片不再是「一整块按钮」：按钮里不能再套按钮（HTML 无效，点击事件还会串）。
// 现在卡片是 section，里面放两个独立按钮 —— 左边「展开/收起」，右边「走完了」。
// 走完的那一段压成一行，但仍然保留卡片的底、描边与顶线（还是原来的卡片）。
import { ref, computed, watch } from 'vue'
import { cardKey, cardAria, cardNo, timeRange, dayText } from './elder-shared.js'

const props = defineProps({
  cards: { type: Array, default: () => [] },
  today: { type: String, default: '' },
  tripTitle: { type: String, default: '' },
  dateText: { type: String, default: '' },
  speaking: { type: Boolean, default: false },
  speechUnsupported: { type: Boolean, default: false },
  // 完成 / 折叠状态由外层持有（它要负责持久化与回传给子女端）
  doneMap: { type: Object, default: () => ({}) },
  collapsedMap: { type: Object, default: () => ({}) },
  // 从提醒弹窗跳过来时要高亮的那一段
  highlightSegId: { type: String, default: '' },
  // 「下一段还有多久」——由外层定时器算好传进来
  nextText: { type: String, default: '' },
})
const emit = defineEmits(['speak', 'toggle-done', 'toggle-collapse'])

// 页头报总数；只有全部段都在今天时才说"今天"
const headline = computed(() => {
  if (!props.cards.length) return '暂时没有安排'
  const allToday = props.cards.every((c) => c && c.date === props.today)
  return allToday ? `今天 ${props.cards.length} 段行程` : `一共 ${props.cards.length} 段行程`
})
const canSpeak = computed(() => props.cards.some((c) => c && c.voice))

function key(c, i) { return cardKey(c, i) }
function isDone(c, i) { return !!props.doneMap[key(c, i)] }
function isCollapsed(c, i) { return !!props.collapsedMap[key(c, i)] }
function bodyId(c, i) { return 'cardbody-' + key(c, i) }

// 跳转高亮：滚到那张卡（behavior 必须是 auto —— 长辈端不允许任何动效）
const cardRefs = ref({})
function setCardRef(k) {
  return (el) => {
    if (el) cardRefs.value[k] = el
    else delete cardRefs.value[k]
  }
}
watch(() => props.highlightSegId, (k) => {
  if (!k) return
  const el = cardRefs.value[k]
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'auto' })
})
</script>

<template>
  <section class="view" aria-label="行程">
    <header class="view-head">
      <p class="view-date">{{ dateText }}</p>
      <h1 class="elder-h1">{{ headline }}</h1>
      <p v-if="tripTitle" class="view-sub">{{ tripTitle }}</p>
    </header>

    <p v-if="nextText" class="card-countdown">{{ nextText }}</p>

    <button
      v-if="canSpeak"
      type="button"
      class="big-btn listen-btn"
      :aria-label="speaking ? '停止语音播报' : '听一遍今天的行程'"
      @click="emit('speak')"
    >{{ speaking ? '停止播报' : '听一遍' }}</button>

    <section
      v-for="(c, i) in cards"
      :key="key(c, i)"
      :ref="setCardRef(key(c, i))"
      class="card"
      :class="{
        'card-stay': c.kind === 'stay',
        'card-done': isDone(c, i),
        'card-collapsed': isCollapsed(c, i),
        'card-focus': highlightSegId === key(c, i),
      }"
    >
      <div class="card-head">
        <!-- 走完了：压成一行，不再是可展开的卡片正文 -->
        <div v-if="isDone(c, i)" class="card-done-line">
          <span class="card-no" aria-hidden="true">{{ cardNo(i) }}</span>
          <span v-if="c.code" class="card-code">{{ c.code }}</span>
          <span class="card-title card-title-done">{{ c.title || '' }}</span>
          <span v-if="timeRange(c)" class="card-line3">{{ timeRange(c) }}</span>
          <span class="card-done-tag">已走完</span>
        </div>

        <button
          v-else
          type="button"
          class="card-toggle"
          :aria-expanded="!isCollapsed(c, i)"
          :aria-controls="bodyId(c, i)"
          :aria-label="cardAria(c, i, !isCollapsed(c, i), false)"
          @click="emit('toggle-collapse', { key: key(c, i), index: i })"
        >
          <span class="card-title-row">
            <span class="card-no" aria-hidden="true">{{ cardNo(i) }}</span>
            <span v-if="c.code" class="card-code">{{ c.code }}</span>
            <span class="card-title">{{ c.title || '' }}</span>
          </span>
          <span v-if="c.date && c.date !== today" class="card-day">{{ dayText(c.date) }}</span>
          <span v-if="timeRange(c)" class="card-line3">{{ timeRange(c) }}</span>
        </button>

        <button
          type="button"
          class="card-done-btn"
          :aria-pressed="isDone(c, i)"
          :aria-label="isDone(c, i) ? '把这一段改回没走完' : '把这一段标成走完了'"
          @click="emit('toggle-done', { key: key(c, i), index: i })"
        >{{ isDone(c, i) ? '改回没走完' : '走完了' }}</button>
      </div>

      <div v-if="!isDone(c, i)" v-show="!isCollapsed(c, i)" :id="bodyId(c, i)" class="card-body">
        <span v-if="c.kind !== 'stay'" class="card-line2">
          <span class="route-part">{{ c.from || '' }}</span>
          <span class="route-arrow" aria-hidden="true">→</span>
          <span class="route-part">{{ c.to || '' }}</span>
        </span>
        <span v-if="c.tips && c.tips.length" class="card-hint">可以点上面的字，收起来只看一行</span>
        <span v-if="c.tips && c.tips.length" class="tips">
          <span v-for="(t, ti) in c.tips" :key="ti" class="tip">· {{ t }}</span>
        </span>
      </div>
    </section>

    <p v-if="!cards.length" class="rest">暂时没有安排，好好休息</p>
    <p v-if="speechUnsupported" class="voice-unsupported">这台设备不支持语音播报</p>
  </section>
</template>

<style scoped>
.view { display: block; }

.view-head { margin: 0 0 22px; }
.view-date {
  margin: 0 0 8px;
  font-size: var(--el-fs-30);
  font-weight: 600;
  color: var(--el-ink-2);
}
.elder-h1 {
  margin: 0;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}
.view-sub { margin: 10px 0 0; font-size: var(--el-fs-28); font-weight: 500; color: var(--el-ink-2); }

/* 下一段还有多久：纯静态文本，不可点（避免和卡片抢点击） */
.card-countdown {
  display: inline-block;
  max-width: 100%;
  margin: 0 0 20px;
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}

/* 听一遍：本页唯一的主操作，和卡片拉开距离，避免误触 */
.listen-btn { margin: 0 0 24px; }

/* 行程卡：白底是触控需要，但不再有圆图标和左强调条 ——
   改用粗顶线 + 编号 + 大号车次来立结构。 */
.card {
  display: block;
  width: 100%;
  min-height: 120px;
  margin: 0 0 20px;
  padding: 20px 22px 22px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-top: 6px solid var(--el-accent);
  border-radius: var(--el-r);
  color: var(--el-ink);
  text-align: left;
  font-size: var(--el-fs-30);
  line-height: 1.5;
}
.card-stay { border-top-color: var(--el-stay); }

/* 从提醒弹窗跳过来时的高亮：静态描边，不做任何动画 */
.card-focus { border-color: var(--el-accent); border-width: 4px; border-top-width: 6px; }

/* 卡片头：左边展开/收起，右边「走完了」。窄屏时右边的按钮落到下一行。 */
.card-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; min-width: 0; }
.card-toggle {
  flex: 1 1 240px;
  min-width: 0;
  display: block;
  padding: 4px 0;
  background: transparent;
  border: 0;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
  text-align: left;
}
.card-done-btn {
  flex: none;
  min-height: 68px;
  min-width: 168px;
  padding: 10px 16px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-28);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.card-title-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; min-width: 0; }
.card-title-row > * { min-width: 0; }
.card-no {
  font-family: var(--f-mono);
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink-2);
  letter-spacing: 1px;
}
/* 车次/航班号是长辈最需要核对的信息：最大最粗 */
.card-code { font-size: var(--el-fs-36); font-weight: 700; letter-spacing: 1.5px; overflow-wrap: anywhere; word-break: break-word; }
.card-title { font-size: var(--el-fs-30); font-weight: 600; overflow-wrap: anywhere; word-break: break-word; }

/* 跨天段落的日期标（同一天的段不标，避免一整列重复） */
.card-day {
  display: inline-block;
  max-width: 100%;
  margin-top: 12px;
  padding: 4px 16px;
  border: 2px solid var(--el-line);
  border-radius: 999px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--el-ink);
  overflow-wrap: anywhere;
}

/* ---- 完成态：压成一行，但保留卡片的底 / 描边 / 顶线 ---- */
.card-done { min-height: 0; padding: 14px 18px; border-top-color: var(--el-ink-2); }
.card-done-line {
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
}
.card-title-done { text-decoration: line-through; }
.card-done-tag {
  flex: none;
  padding: 2px 14px;
  border: 2px solid var(--el-line);
  border-radius: 999px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink-2);
  overflow-wrap: anywhere;
}

.card-body { margin-top: 12px; }
.card-line2 { display: flex; flex-wrap: wrap; align-items: baseline; font-size: var(--el-fs-32); font-weight: 600; min-width: 0; }
/* 站名不再禁止断行：长站名允许折行，但不允许把卡片撑破 */
.route-part { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.route-arrow { margin: 0 10px; }
/* 时间胶囊 */
.card-line3 {
  display: inline-block;
  max-width: 100%;
  margin-top: 10px;
  padding: 6px 18px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}
.card-hint {
  display: block;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 2px dashed var(--el-line);
  font-size: var(--el-fs-28);
  font-weight: 600;
  color: var(--el-ink-2);
}
.tips { display: block; margin-top: 10px; }
.tip { display: block; font-size: var(--el-fs-28); font-weight: 500; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; }

.rest {
  margin: 0 0 20px;
  padding: 40px 0;
  border-top: 2px solid var(--el-line);
  border-bottom: 2px solid var(--el-line);
  font-family: var(--f-sans);
  font-size: var(--el-fs-36);
  font-weight: 800;
  color: var(--el-ink);
  text-align: center;
}
.voice-unsupported {
  margin: 0 0 18px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
}
</style>
