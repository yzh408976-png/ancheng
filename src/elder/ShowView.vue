<script setup>
// 显示设置页：单独一页，字大小与主题各一排大按钮。
// 长辈自己调过就存在本机（优先级高于子女分享时预设的）。
import { ELDER_SCALES, ELDER_THEMES, elderScaleName, elderThemeName } from '../core/store.js'

defineProps({
  scale: { type: Number, default: 1 },
  theme: { type: String, default: 'day' },
})
const emit = defineEmits(['pick', 'back'])
</script>

<template>
  <section class="view" aria-label="显示设置">
    <header class="view-head">
      <p class="view-date">调好了会记住</p>
      <h1 class="elder-h1">字大一点，看得清</h1>
    </header>

    <button type="button" class="back-btn" @click="emit('back')">返回行程</button>

    <div class="opt-row">
      <span class="opt-label">字大小</span>
      <div class="opt-group" role="group" aria-label="字大小">
        <button
          v-for="s in ELDER_SCALES" :key="s"
          type="button"
          class="opt-btn"
          :class="{ active: scale === s }"
          :aria-pressed="scale === s"
          @click="emit('pick', { scale: s, theme })"
        >{{ elderScaleName(s) }}</button>
      </div>
    </div>

    <div class="opt-row">
      <span class="opt-label">主题</span>
      <div class="opt-group" role="group" aria-label="主题">
        <button
          v-for="t in ELDER_THEMES" :key="t"
          type="button"
          class="opt-btn"
          :class="{ active: theme === t }"
          :aria-pressed="theme === t"
          @click="emit('pick', { scale, theme: t })"
        >{{ elderThemeName(t) }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.view { display: block; }

.view-head { margin: 0 0 22px; }
.view-date { margin: 0 0 8px; font-size: var(--el-fs-30); font-weight: 600; color: var(--el-ink-2); }
.elder-h1 {
  margin: 0;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}

/* 返回按钮样式在 global.css（跨视图复用） */

.opt-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 0;
  border-bottom: 2px solid var(--el-line);
}
.opt-label { font-size: var(--el-fs-30); font-weight: 700; color: var(--el-ink); }
.opt-group { display: flex; gap: 12px; }
.opt-btn {
  flex: 1;
  min-height: var(--el-hit-sm);
  padding: 8px 10px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
}
.opt-btn.active {
  background: var(--el-btn-bg);
  border-color: var(--el-btn-line);
  color: var(--el-btn-ink);
}
</style>
