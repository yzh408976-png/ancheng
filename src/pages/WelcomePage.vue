<script setup>
import { navigate } from '../core/router.js'
import { store } from '../core/store.js'
import { ACCOUNT_HINT } from '../core/accounts.js'

function goElder() { navigate('/e') }
function goKid() { navigate(store.account ? '/home' : '/login') }
</script>

<template>
  <div class="welcome">
    <div class="welcome__mark">
      <svg viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="6" stroke="currentColor" stroke-width="2"/>
        <circle cx="9" cy="9" r="2.2" fill="currentColor"/>
        <path d="M9 12.5 V 19 M6.5 17 L9 19.5 L11.5 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 7 H 21 M14 11 H 19 M14 15 H 21 M14 19 H 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="welcome__name">安程</span>
      <span class="welcome__sub">ANCHENG</span>
    </div>

    <h1 class="welcome__title">子女把行程排好，<br>长辈打开就能看懂。</h1>
    <p class="welcome__sub2">把车票信息发给爸妈，他们那边看到的不是一堆数字，而是「10月12日 早上8点，坐高铁 G7601，从上海虹桥站去北京南站」这样的白话。</p>

    <div class="welcome__routes">
      <button class="route" @click="goElder">
        <span class="route__no mono">01</span>
        <span class="route__body">
          <span class="route__title">我是爸妈</span>
          <span class="route__desc">打开就能看行程，字大、按钮大，不用登录</span>
        </span>
        <span class="route__arrow" aria-hidden="true">→</span>
      </button>
      <button class="route route--kid" @click="goKid">
        <span class="route__no mono">02</span>
        <span class="route__body">
          <span class="route__title">我是子女</span>
          <span class="route__desc">帮爸妈排行程、发给他们、随时看动态</span>
        </span>
        <span class="route__arrow" aria-hidden="true">→</span>
      </button>
    </div>

    <p class="welcome__links">
      <a href="#/register">注册新账号</a> · <a href="#/accounts">最近账号</a>
    </p>
    <p class="hint">{{ ACCOUNT_HINT }}</p>
  </div>
</template>

<style scoped>
.welcome {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--sp-6) 0 var(--sp-5);
}
.welcome__mark {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--c-brand);
  margin-bottom: var(--sp-6);
}
.welcome__mark svg { width: 40px; height: 40px; }
.welcome__name {
  font-family: var(--f-serif);
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: var(--c-ink-0);
}
.welcome__sub {
  font-family: var(--f-mono);
  font-size: 11px;
  letter-spacing: 0.36em;
  color: var(--c-ink-2);
}
.welcome__title {
  font-family: var(--f-serif);
  font-size: 40px;
  font-weight: 900;
  line-height: 1.35;
  letter-spacing: 0.02em;
  margin-bottom: var(--sp-4);
}
.welcome__sub2 {
  font-size: var(--fs-base);
  color: var(--c-ink-1);
  line-height: 1.9;
  margin-bottom: var(--sp-6);
}
.welcome__routes { display: flex; flex-direction: column; gap: var(--sp-3); margin-bottom: var(--sp-5); }
.route {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  text-align: left;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-l);
  padding: var(--sp-4) var(--sp-5);
  cursor: pointer;
  transition: border-color var(--dur-1), transform var(--dur-1);
}
.route:hover { border-color: var(--c-brand); transform: translateY(-1px); }
.route--kid { background: var(--c-brand); border-color: var(--c-brand); }
.route--kid .route__title, .route--kid .route__desc, .route--kid .route__no, .route--kid .route__arrow { color: #fff; }
.route__no { font-size: var(--fs-sm); color: var(--c-brand); font-weight: 700; }
.route__body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.route__title { font-weight: 700; font-size: var(--fs-lg); }
.route__desc { font-size: var(--fs-sm); color: var(--c-ink-2); }
.route__arrow { color: var(--c-ink-2); }
.welcome__links { text-align: center; font-size: var(--fs-sm); margin-bottom: var(--sp-4); }
</style>
