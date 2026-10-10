<script setup>
import { ref, reactive, onMounted } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast } from '../core/store.js'
import { login, ACCOUNT_HINT } from '../core/accounts.js'

const form = reactive({ identifier: '', password: '' })
const error = ref('')
const busy = ref(false)

onMounted(() => {
  const prefill = new URLSearchParams(location.search).get('u')
  if (prefill) {
    form.identifier = prefill
    history.replaceState(null, '', location.pathname + location.hash)
  }
})

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const out = await login(form.identifier, form.password)
    if (!out.ok) {
      error.value = out.error
      toast(out.error, 'err')
      return
    }
    toast('欢迎回来，' + out.account.name, 'ok')
    navigate('/home', { replace: true })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <p class="kicker">安程 · 登录</p>
    <h1 class="page-title">欢迎回来</h1>

    <form class="paper-card" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="identifier">账号名 / 邮箱 / 手机号</label>
        <input id="identifier" v-model="form.identifier" class="input" type="text" autocomplete="username" placeholder="随便哪个都行">
      </div>
      <div class="field">
        <label class="field__label" for="password">密码</label>
        <input id="password" v-model="form.password" class="input" type="password" autocomplete="current-password" placeholder="密码">
      </div>
      <p v-if="error" class="field__err">{{ error }}</p>
      <button class="btn btn--brand btn--lg" type="submit" style="width:100%" :disabled="busy">
        {{ busy ? '正在登录…' : '登录' }}
      </button>
      <p class="hint" style="margin-top:16px">{{ ACCOUNT_HINT }}</p>
    </form>

    <p class="login__links">
      <a href="#/register">注册新账号</a> · <a href="#/accounts">最近账号</a> · <a href="#/">返回</a>
    </p>
  </div>
</template>

<style scoped>
.login { max-width: 420px; margin: 0 auto; }
.login__links { text-align: center; font-size: var(--fs-sm); margin-top: var(--sp-4); }
</style>
