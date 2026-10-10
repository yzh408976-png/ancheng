<script setup>
// 家人电话页：单独一页，只放"能打电话的人"。
// 每位家人：称呼（大字，长辈视角）→ 姓名 · 号码 · 微信/QQ → 备注 → [拨打] [微信] 两个大按钮。
// 「微信」不假装能唤起 App：把号复制好，让长辈到微信里搜。
import { ref, onBeforeUnmount } from 'vue'
import { contactTitle, contactSub, copyText } from './elder-shared.js'

const props = defineProps({ contacts: { type: Array, default: () => [] } })
const emit = defineEmits(['back'])

const note = ref('')
let timer = null

async function copyContact(p) {
  const v = String((p && (p.im || p.phone)) || '').trim()
  if (!v) return
  const ok = await copyText(v)
  note.value = ok
    ? '已复制 ' + v + '：打开微信或 QQ 搜这个号，就能加好友、打视频'
    : '复制没成功，请让子女把号再发你一遍'
  clearTimeout(timer)
  timer = setTimeout(() => { note.value = '' }, 8000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <section class="view" aria-label="家人电话">
    <header class="view-head">
      <p class="view-date">点一下就能打</p>
      <h1 class="elder-h1">{{ contacts.length ? '家里人都在这里' : '还没有家人电话' }}</h1>
    </header>

    <button type="button" class="back-btn" @click="emit('back')">返回行程</button>

    <template v-if="contacts.length">
      <div v-for="(p, pi) in contacts" :key="pi" class="contact-row">
        <span class="contact-info">
          <span class="contact-name">{{ contactTitle(p) }}</span>
          <span v-if="contactSub(p)" class="contact-sub">{{ contactSub(p) }}</span>
          <span v-if="p.note" class="contact-note">{{ p.note }}</span>
        </span>
        <span class="contact-actions">
          <a
            v-if="p.phone"
            class="tel-btn"
            :href="'tel:' + p.phone"
            :aria-label="'拨打' + contactTitle(p) + '的电话'"
          >拨打</a>
          <button
            v-if="p.phone || p.im"
            type="button"
            class="tel-btn tel-btn-im"
            :aria-label="'复制' + contactTitle(p) + '的微信号，去微信里加好友'"
            @click="copyContact(p)"
          >微信</button>
        </span>
      </div>
    </template>
    <p v-else class="empty-hint">请子女在「家人」里添上电话，再重新发一次链接</p>

    <p v-if="note" class="copy-note" role="status">{{ note }}</p>
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

/* 长辈端的"返回"必须是显式、可点、够大的一整条，不依赖浏览器返回键；样式在 global.css */

/* 信息在上、大按钮在下：避免横向挤压，触控区更大 */
.contact-row {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 0;
  border-bottom: 2px solid var(--el-line);
}
.contact-info { min-width: 0; }
.contact-name { display: block; font-size: var(--el-fs-36); font-weight: 700; }
.contact-sub { display: block; margin-top: 6px; font-size: var(--el-fs-30); font-weight: 500; color: var(--el-ink-2); }
.contact-note {
  display: block;
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
}
.contact-actions { display: flex; gap: 12px; }
.tel-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--el-hit-sm);
  padding: 10px 18px;
  background: var(--el-btn-bg);
  border: 2px solid var(--el-btn-line);
  border-radius: var(--el-r);
  color: var(--el-btn-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
  text-decoration: none;
}
.tel-btn-im {
  background: var(--el-card);
  border-color: var(--el-line);
  color: var(--el-ink);
}
.copy-note {
  margin: 18px 0 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
}
.empty-hint { margin: 0; font-size: var(--el-fs-30); color: var(--el-ink-2); }
</style>
