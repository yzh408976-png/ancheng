import { createApp } from 'vue'
import App from './App.vue'
import { installRouter } from './core/router.js'
import { initStore } from './core/store.js'
import './styles/global.css'

installRouter()
initStore()

createApp(App).mount('#app')
