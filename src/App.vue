<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, navigate, matchPath } from './core/router.js'
import { store, toast } from './core/store.js'

import WelcomePage from './pages/WelcomePage.vue'
import LoginPage from './pages/LoginPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import RecentAccountsPage from './pages/RecentAccountsPage.vue'
import HomePage from './pages/HomePage.vue'
import ImportPage from './pages/ImportPage.vue'
import TripPage from './pages/TripPage.vue'
import FamilyPage from './pages/FamilyPage.vue'
import SharePage from './pages/SharePage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import ModelPage from './pages/ModelPage.vue'
import ElderPage from './elder/ElderPage.vue'

const route = useRoute()

const ROUTES = [
  { path: '/', comp: WelcomePage, public: true, title: '安程' },
  { path: '/login', comp: LoginPage, public: true, title: '登录' },
  { path: '/register', comp: RegisterPage, public: true, title: '注册账号' },
  { path: '/accounts', comp: RecentAccountsPage, public: true, title: '最近账号' },
  { path: '/home', comp: HomePage, public: false, title: '行程' },
  { path: '/import', comp: ImportPage, public: false, title: '导入行程' },
  { path: '/trip/:id', comp: TripPage, public: false, title: '行程详情' },
  { path: '/family', comp: FamilyPage, public: false, title: '家人' },
  { path: '/share/:tripId', comp: SharePage, public: false, title: '分享' },
  { path: '/profile', comp: ProfilePage, public: false, title: '我的' },
  { path: '/model', comp: ModelPage, public: false, title: '模型配置' },
]

const isElder = computed(() => route.path === '/e' || route.path.startsWith('/e/'))

const matched = computed(() => {
  if (isElder.value) return { comp: ElderPage, params: {} }
  for (const r of ROUTES) {
    const params = matchPath(r.path, route.path)
    if (params) return { comp: r.comp, params, route: r }
  }
  return null
})

watch(() => [route.path, store.ready], () => {
  if (!store.ready || isElder.value) return
  const m = matched.value
  if (m && m.route && !m.route.public && !store.account) {
    navigate('/login', { replace: true })
    return
  }
  if (route.path === '/login' && store.account) {
    navigate('/home', { replace: true })
  }
}, { immediate: true })

const NAV = [
  { to: '/home', label: '行程', match: p => p === '/home' || p.startsWith('/trip') },
  { to: '/import', label: '导入', match: p => p === '/import' },
  { to: '/family', label: '家人', match: p => p === '/family' },
  { to: '/profile', label: '我的', match: p => p === '/profile' || p.startsWith('/model') || p.startsWith('/share') },
]

function onKey(e) {
  if (!store.account || !e.altKey) return
  const map = { 1: '/home', 2: '/import', 3: '/family', 4: '/profile' }
  if (map[e.key]) {
    e.preventDefault()
    navigate(map[e.key])
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const mainRef = ref(null)
watch(() => route.path, async () => {
  if (isElder.value) return
  await nextTick()
  if (mainRef.value) {
    mainRef.value.classList.remove('page-enter')
    void mainRef.value.offsetWidth
    mainRef.value.classList.add('page-enter')
  }
})
</script>

<template>
  <ElderPage v-if="isElder" />
  <div v-else-if="matched" class="shell">
    <header class="topbar">
      <div class="topbar__in">
        <div class="brand" @click="navigate(store.account ? '/home' : '/')">
          <svg class="brand__mark" viewBox="0 0 26 26" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="24" height="24" rx="6" stroke="currentColor" stroke-width="2"/>
            <circle cx="9" cy="9" r="2.2" fill="currentColor"/>
            <path d="M9 12.5 V 19 M6.5 17 L9 19.5 L11.5 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 7 H 21 M14 11 H 19 M14 15 H 21 M14 19 H 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="brand__name">安程</span>
          <span class="brand__sub">ANCHENG</span>
        </div>
        <nav v-if="store.account" class="nav" aria-label="主导航">
          <a v-for="n in NAV" :key="n.to" :href="'#' + n.to" :class="{ 'is-active': n.match(route.path) }">{{ n.label }}</a>
        </nav>
      </div>
    </header>

    <main ref="mainRef" class="main">
      <component :is="matched.comp" v-bind="matched.params || {}" />
    </main>

    <div class="toasts" aria-live="polite">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="'toast--' + t.kind">{{ t.msg }}</div>
    </div>
  </div>
  <div v-else class="main">
    <div class="empty">
      <div class="empty__icon">◯</div>
      <p>页面不存在</p>
      <a href="#/home">回到首页</a>
    </div>
  </div>
</template>
