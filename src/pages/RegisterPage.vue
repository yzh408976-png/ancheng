<script setup>
import { ref, reactive } from 'vue'
import { navigate } from '../core/router.js'
import { toast } from '../core/store.js'
import { rules, validateRegister, register, ACCOUNT_HINT } from '../core/accounts.js'

const ORDER = ['name', 'email', 'phone', 'password', 'confirm']
const FIELDS = {
  name: '账号名', email: '邮箱', phone: '手机号', password: '密码', confirm: '再输一遍密码',
}

const form = reactive({ name: '', email: '', phone: '', password: '', confirm: '' })
const errors = reactive({ name: '', email: '', phone: '', password: '', confirm: '' })

function onBlur(field) {
  if (field === 'confirm') {
    errors.confirm = form.password !== form.confirm ? '两次输入的密码不一样' : ''
    return
  }
  errors[field] = rules[field](form[field])
}

async function submit() {
  const v = validateRegister(form)
  Object.assign(errors, v.errors)
  if (!v.ok) {
    for (const key of ORDER) {
      if (errors[key]) {
        document.getElementById('reg-' + key)?.focus()
        break
      }
    }
    return
  }
  const out = await register(form)
  if (!out.ok) {
    Object.assign(errors, out.errors)
    toast('有几处没填对', 'err')
    return
  }
  toast('注册成功', 'ok')
  navigate('/home', { replace: true })
}
</script>

<template>
  <div class="reg">
    <p class="kicker">安程 · 注册</p>
    <h1 class="page-title">注册账号</h1>
    <p class="hint" style="margin-bottom:20px">不发短信、不发邮件、不上传任何东西——账号只存在这台设备上。</p>

    <form class="paper-card" @submit.prevent="submit">
      <div v-for="f in ORDER" :key="f" class="field" :class="{ 'field--err': errors[f] }">
        <label class="field__label" :for="'reg-' + f">{{ FIELDS[f] }}</label>
        <input
          :id="'reg-' + f" v-model="form[f]" class="input"
          :type="f === 'password' || f === 'confirm' ? 'password' : 'text'"
          :autocomplete="f === 'password' ? 'new-password' : 'off'"
          :placeholder="f === 'name' ? '比如：小明_backend' : ''"
          @blur="onBlur(f)"
        >
        <p v-if="errors[f]" class="field__err">{{ errors[f] }}</p>
      </div>
      <button class="btn btn--brand btn--lg" type="submit" style="width:100%">注册并进入</button>
    </form>

    <p class="reg__links"><a href="#/login">已有账号，去登录</a></p>
    <p class="hint">{{ ACCOUNT_HINT }}</p>
  </div>
</template>

<style scoped>
.reg { max-width: 420px; margin: 0 auto; }
.reg__links { text-align: center; font-size: var(--fs-sm); margin-top: var(--sp-4); }
</style>
