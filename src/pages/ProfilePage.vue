<script setup>
// 我的：账号信息、诚实声明、数据备份/清空、退出登录、关于。
import { ref, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, persistData, mergeBackup } from '../core/store.js'
import { ACCOUNT_HINT, logout } from '../core/accounts.js'

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const account = store.account || { name: '?', email: '', phone: '' }
const initial = String(account.name || '?').slice(0, 1)

// ---- 导出数据备份 ----
function exportBackup() {
  const json = JSON.stringify(store.data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `安程-备份-${fmt(new Date())}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('备份文件已导出', 'ok')
}

// ---- 从备份文件恢复（合并导入：按 id 去重，不覆盖现有数据）----
const backupInput = ref(null)
function pickBackup() { backupInput.value?.click() }
async function onBackupPicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 清空 value，允许连续选同一个文件
  if (!file) return
  let json = null
  try { json = JSON.parse(await file.text()) } catch { json = null }
  const res = mergeBackup(store.data, json)
  if (!res.ok) { toast('这不是有效的备份文件', 'err'); return }
  const parts = []
  if (res.added.trips) parts.push(`${res.added.trips} 条行程`)
  if (res.added.family) parts.push(`${res.added.family} 位家人`)
  if (res.added.shares) parts.push(`${res.added.shares} 条分享记录`)
  if (!parts.length) { toast('没有可恢复的新内容', 'warn'); return }
  store.data = res.data
  persistData()
  toast(`已恢复 ${parts.join('、')}${res.skipped ? `，跳过 ${res.skipped} 条重复或无效` : ''}`, 'ok')
}

// ---- 清空数据（两步确认）----
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
function clearDataClick() {
  if (!askConfirm('clear-data')) return
  store.data.trips = []
  store.data.family = []
  store.data.shares = []
  store.data.draft = null
  persistData()
  toast('已清空', 'warn')
}

// ---- 退出登录 ----
function doLogout() {
  logout()
  toast('已退出', 'info')
  navigate('/')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div>
    <header class="page-head">
      <div>
        <p class="kicker">我的 · 本机账号</p>
        <h1 class="page-title">账号与数据</h1>
      </div>
    </header>

    <section class="paper-card account-card">
      <span class="avatar" aria-hidden="true">{{ initial }}</span>
      <div class="account-card__info">
        <h2 class="account-card__name">{{ account.name }}</h2>
        <p v-if="account.email" class="account-card__line">{{ account.email }}</p>
        <p v-if="account.phone" class="account-card__line">{{ account.phone }}</p>
      </div>
    </section>

    <section class="paper-card hint-card" role="note">
      <p class="hint-card__title">先说清楚</p>
      <p class="hint-card__text">{{ ACCOUNT_HINT }}</p>
    </section>

    <section class="paper-card" aria-label="数据">
      <h2 class="card-title">数据</h2>
      <div class="row">
        <div class="row__text">
          <p class="row__title">导出数据备份</p>
          <p class="row__desc">把行程、家人、分享记录打包成一个 JSON 文件存到本地。</p>
        </div>
        <button class="btn btn--ghost" @click="exportBackup">导出数据备份</button>
      </div>
      <div class="row">
        <div class="row__text">
          <p class="row__title">从备份文件恢复</p>
          <p class="row__desc">选一个之前导出的 JSON，按 id 去重合并进来，不覆盖现有数据。</p>
        </div>
        <button class="btn btn--ghost" @click="pickBackup">选择备份文件</button>
        <input
          ref="backupInput"
          class="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="选择备份文件"
          @change="onBackupPicked"
        >
      </div>
      <div class="row">
        <div class="row__text">
          <p class="row__title">清空本账号数据</p>
          <p class="row__desc">删掉这台设备上本账号的全部行程、家人和分享记录，不可恢复。</p>
        </div>
        <button
          class="btn btn--danger"
          @click="clearDataClick"
        >{{ confirmKey === 'clear-data' ? '确认清空？' : '清空本账号数据' }}</button>
      </div>
    </section>

    <section class="paper-card" aria-label="模型配置">
      <h2 class="card-title">模型配置</h2>
      <div class="row">
        <div class="row__text">
          <p class="row__title">自定义模型</p>
          <p class="row__desc">接一个 OpenAI 兼容的模型，用来做「AI 补全」和「截图识字」。填 Base URL、模型名称、API Key，只存在这台设备上。不配也能用：AI 补全会走内置演示管线。</p>
        </div>
        <a class="btn btn--ghost" href="#/model">去设置</a>
      </div>
    </section>

    <section class="paper-card" aria-label="账号">
      <h2 class="card-title">账号</h2>
      <div class="row">
        <div class="row__text">
          <p class="row__title">退出登录</p>
          <p class="row__desc">退出后可在最近账号里选人，需输密码</p>
        </div>
        <button class="btn btn--ghost" @click="doLogout">退出登录</button>
      </div>
      <div class="row">
        <div class="row__text">
          <p class="row__title">切换账号</p>
          <p class="row__desc">数据按账号隔离，换账号看到的是另一个人的行程。</p>
        </div>
        <a class="btn btn--ghost" href="#/accounts">去切换</a>
      </div>
    </section>

    <section class="paper-card" aria-label="关于">
      <h2 class="card-title">关于</h2>
      <ul class="about-list">
        <li>版本 v1.0.0（web 复刻版）</li>
        <li>纯本地存储：数据只在这台设备的浏览器里（localStorage 键 ptb:*）</li>
        <li>默认无后端也能完整使用；可选部署同步服务端</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.account-card {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
}
.avatar {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--c-bg-2);
  color: var(--c-brand);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px var(--c-line);
}
.account-card__name { margin: 0; font-size: var(--fs-lg); font-weight: 700; font-family: var(--f-serif); letter-spacing: 0.05em; }
.account-card__line { margin: 3px 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); }

.hint-card {
  border-color: #BFDCCB;
  background: var(--c-brand-soft);
}
.hint-card__title { margin: 0 0 4px; font-size: var(--fs-sm); font-weight: 600; color: var(--c-brand); }
.hint-card__text { margin: 0; font-size: var(--fs-sm); color: var(--c-ink-1); line-height: 1.7; }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
  padding: var(--sp-3) 0;
  border-bottom: 1px dashed var(--c-line);
}
.row:last-child { border-bottom: none; padding-bottom: 0; }
.row:first-of-type { padding-top: 6px; }
.row__text { flex: 1; min-width: 220px; }
.row__title { margin: 0; font-size: var(--fs-base); }
.row__desc { margin: 2px 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); }

.about-list {
  padding-left: 1.2em;
  font-size: var(--fs-sm);
  color: var(--c-ink-2);
}
.about-list li { margin: 3px 0; }

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
