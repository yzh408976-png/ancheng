<script setup>
import { ref } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast } from '../core/store.js'
import { listAccounts, removeAccount } from '../core/accounts.js'

const confirmKey = ref('')
let confirmTimer = null

function relTime(ts) {
  if (!ts) return '没登录过'
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 30 * 86400000) return Math.floor(diff / 86400000) + ' 天前'
  return new Date(ts).toLocaleDateString('zh-CN')
}

function pick(acc) {
  navigate('/login?u=' + encodeURIComponent(acc.name))
}

function askConfirm(key) {
  if (confirmKey.value === key) return true
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}

function doRemove(acc) {
  if (!askConfirm('acc:' + acc.id)) return
  const out = removeAccount(acc.id)
  if (out.ok && out.loggedOut) {
    toast('已删除当前登录的账号', 'info')
    navigate('/', { replace: true })
  } else if (out.ok) {
    toast('已删除账号「' + out.name + '」', 'info')
  }
  confirmKey.value = ''
}

const accounts = ref(listAccounts())
</script>

<template>
  <div class="accs">
    <p class="kicker">安程 · 账号</p>
    <h1 class="page-title">最近账号</h1>

    <div v-if="accounts.length" class="accs__list list-enter">
      <div v-for="acc in accounts" :key="acc.id" class="paper-card acc-card">
        <button class="acc-pick" @click="pick(acc)">
          <span class="acc-avatar">{{ acc.name[0] }}</span>
          <span class="acc-body">
            <span class="acc-name">
              {{ acc.name }}
              <span v-if="store.account && store.account.id === acc.id" class="tag tag--brand">当前</span>
            </span>
            <span class="acc-meta">{{ acc.email }} · {{ acc.phone }}</span>
            <span class="acc-time">上次登录：{{ relTime(acc.lastLogin) }}</span>
          </span>
        </button>
        <button class="btn btn--danger" @click="doRemove(acc)">
          {{ confirmKey === 'acc:' + acc.id ? '确认删除？' : '删除' }}
        </button>
      </div>
    </div>
    <div v-else class="paper-card empty">
      <div class="empty__icon">◯</div>
      <p>这台设备上还没有账号</p>
    </div>

    <p class="accs__links"><a href="#/register">注册新账号</a> · <a href="#/login">账号名登录</a> · <a href="#/">返回</a></p>
  </div>
</template>

<style scoped>
.accs { max-width: 520px; margin: 0 auto; }
.accs__list { display: flex; flex-direction: column; gap: var(--sp-3); }
.acc-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4);
  margin-bottom: 0;
}
.acc-pick {
  flex: 1;
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: 0;
  min-width: 0;
}
.acc-avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--c-brand-soft);
  color: var(--c-brand);
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: var(--fs-lg);
  flex-shrink: 0;
}
.acc-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.acc-name { font-weight: 700; display: flex; align-items: center; gap: var(--sp-2); }
.acc-meta { font-size: var(--fs-xs); color: var(--c-ink-2); overflow: hidden; text-overflow: ellipsis; }
.acc-time { font-size: var(--fs-xs); color: var(--c-ink-2); }
.accs__links { text-align: center; font-size: var(--fs-sm); margin-top: var(--sp-4); }
</style>
