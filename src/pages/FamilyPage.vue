<script setup>
// 家人页：给长辈页准备「家人电话」。
// 称呼是「长辈该怎么叫他」，不是「子女该怎么叫他」—— 子女写「爸爸」，长辈看到会以为是自己。
import { ref, reactive, onBeforeUnmount } from 'vue'
import { store, toast, uid, upsertFamily, removeFamily } from '../core/store.js'
import { rules, isLegacyFamilyTitle } from '../core/accounts.js'

// 从长辈视角的常用称呼（可自由输入，这只是建议）
const TITLE_SUGGESTS = ['老伴', '儿子', '女儿', '儿媳', '女婿', '孙子', '孙女', '外孙', '外孙女', '兄弟', '姐妹', '亲戚', '邻居', '社区医生']
const isLegacyTitle = (v) => isLegacyFamilyTitle(v)

const showForm = ref(false)
const editing = ref(null) // null = 新增；否则为正在编辑的家人
const form = reactive({ name: '', relation: '', phone: '', im: '', note: '' })
const phoneErr = ref('')
const formErr = ref('')

function openAdd() {
  editing.value = null
  form.name = ''
  form.relation = ''
  form.phone = ''
  form.im = ''
  form.note = ''
  phoneErr.value = ''
  formErr.value = ''
  showForm.value = true
}
function openEdit(member) {
  editing.value = member
  form.name = member.name || ''
  form.relation = member.relation || ''
  form.phone = member.phone || ''
  form.im = member.im || ''
  form.note = member.note || ''
  phoneErr.value = ''
  formErr.value = ''
  showForm.value = true
}
function closeForm() {
  showForm.value = false
  editing.value = null
}
function blurPhone() {
  phoneErr.value = rules.phone(form.phone.trim())
}
function saveFamily() {
  const name = form.name.trim()
  const phone = form.phone.trim()
  let err = ''
  if (!name) err = '请填写姓名'
  if (!err) err = rules.phone(phone)
  formErr.value = err
  if (err) return
  upsertFamily({
    id: editing.value ? editing.value.id : uid('fam'),
    name,
    relation: form.relation.trim(),
    phone,
    im: form.im.trim(),
    note: form.note.trim(),
  })
  toast(editing.value ? '家人信息已保存' : '家人已添加', 'ok')
  closeForm()
}

// 删除家人（两步确认）
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
function removeFamilyClick(member) {
  if (!askConfirm('fam:' + member.id)) return
  removeFamily(member.id)
  toast('家人已删除', 'info')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div>
    <header class="page-head">
      <div>
        <p class="kicker">家人 · {{ store.data.family.length }} 位</p>
        <h1 class="page-title">长辈该找谁，你来定</h1>
        <p class="hint" style="margin-top:8px">这些电话会出现在长辈页的「家人电话」页上，长辈点一下就能打。</p>
      </div>
      <div>
        <button class="btn btn--brand btn--lg" @click="openAdd">+ 添加家人</button>
      </div>
    </header>

    <form v-if="showForm" class="paper-card fam-form" @submit.prevent="saveFamily">
      <h2 class="card-title">{{ editing ? '编辑家人' : '添加家人' }}</h2>
      <div class="form-grid">
        <div class="form-field">
          <label class="field__label" for="fam-name">姓名</label>
          <input id="fam-name" v-model="form.name" class="input" type="text" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="field__label" for="fam-relation">称呼（长辈看到的就是这个）</label>
          <input
            id="fam-relation"
            v-model="form.relation"
            class="input"
            type="text"
            list="fam-relation-options"
            autocomplete="off"
            placeholder="如：儿子、老伴、社区医生"
          >
          <datalist id="fam-relation-options">
            <option v-for="r in TITLE_SUGGESTS" :key="r" :value="r"></option>
          </datalist>
          <small class="form-hint">写长辈叫得顺口的，别写「爸爸」—— 长辈看到会以为是自己</small>
        </div>
        <div class="form-field">
          <label class="field__label" for="fam-phone">手机号</label>
          <input id="fam-phone" v-model="form.phone" class="input" type="tel" autocomplete="off" @blur="blurPhone">
          <p v-if="phoneErr" class="field__err" role="alert">{{ phoneErr }}</p>
        </div>
        <div class="form-field">
          <label class="field__label" for="fam-im">微信号 / QQ 号（选填）</label>
          <input id="fam-im" v-model="form.im" class="input" type="text" autocomplete="off" placeholder="留空就用手机号搜微信">
        </div>
        <div class="form-field form-field--wide">
          <label class="field__label" for="fam-note">备注（选填）</label>
          <textarea
            id="fam-note"
            v-model="form.note"
            class="textarea"
            rows="3"
            placeholder="过敏、用药、住址等；这段字会原样显示在长辈页上"
          ></textarea>
        </div>
      </div>
      <p v-if="formErr" class="form-err" role="alert">{{ formErr }}</p>
      <div class="btn-row" style="margin-top:16px">
        <button type="submit" class="btn btn--brand">保存</button>
        <button type="button" class="btn btn--ghost" @click="closeForm">取消</button>
      </div>
    </form>

    <ul v-if="store.data.family.length" class="fam-list list-enter">
      <li v-for="m in store.data.family" :key="m.id" class="paper-card fam-card">
        <div class="fam__main">
          <div class="fam__top">
            <h2 class="fam__name">{{ m.name }}</h2>
            <span v-if="m.relation && !isLegacyTitle(m.relation)" class="tag tag--brand">{{ m.relation }}</span>
            <span v-else-if="isLegacyTitle(m.relation)" class="tag tag--warn">旧称呼：{{ m.relation }}</span>
          </div>
          <p class="fam__phone mono">{{ m.phone }}<span v-if="m.im" class="fam__im">· 微信/QQ {{ m.im }}</span></p>
          <p v-if="m.note" class="fam__note">{{ m.note }}</p>
          <p v-if="isLegacyTitle(m.relation)" class="fam__fix">
            这是按你自己叫的（长辈页不会显示）。建议点「编辑」改成长辈叫得顺口的，比如「儿子」「老伴」。
          </p>
        </div>
        <div class="fam__actions">
          <button class="btn btn--ghost" @click="openEdit(m)">编辑</button>
          <button
            class="btn btn--danger"
            @click="removeFamilyClick(m)"
          >{{ confirmKey === 'fam:' + m.id ? '确认删除？' : '删除' }}</button>
        </div>
      </li>
    </ul>

    <section v-else class="paper-card empty">
      <p class="kicker">空</p>
      <h2 class="empty__title">还没添加家人</h2>
      <p class="hint">加上家人的电话，分享出去的行程会带上「家人电话」卡，长辈点一下就能打。</p>
      <button class="btn btn--brand" style="margin-top:16px" @click="openAdd">添加家人</button>
    </section>
  </div>
</template>

<style scoped>
.fam-form { border-color: var(--c-brand); }
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--sp-3);
}
.form-field--wide { grid-column: 1 / -1; }
.form-hint { display: block; margin-top: 4px; font-size: var(--fs-xs); color: var(--c-ink-2); }
.form-err {
  margin: var(--sp-3) 0 0;
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--c-err);
  background: #FBEFEE;
  border-left: 3px solid var(--c-err);
  border-radius: 0 var(--r-s) var(--r-s) 0;
}

.fam-list { display: flex; flex-direction: column; gap: var(--sp-3); }
.fam-card { padding: var(--sp-4) var(--sp-5); }
.fam__main { display: flex; flex-direction: column; gap: 2px; }
.fam__top { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.fam__name { margin: 0; font-size: var(--fs-lg); font-weight: 700; font-family: var(--f-serif); letter-spacing: 0.05em; }
.fam__phone { margin: 2px 0 0; font-size: var(--fs-base); color: var(--c-ink-1); }
.fam__im { margin-left: var(--sp-2); font-size: var(--fs-sm); color: var(--c-ink-2); }
.fam__fix {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--c-warn);
  background: #FBF3E4;
  border-left: 3px solid var(--c-warn);
  border-radius: 0 var(--r-s) var(--r-s) 0;
}
.fam__note { margin: 6px 0 0; font-size: var(--fs-sm); color: var(--c-ink-2); white-space: pre-line; }
.fam__actions {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px dashed var(--c-line);
  display: flex;
  gap: var(--sp-2);
}
</style>
