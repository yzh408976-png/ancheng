// 长辈端本地状态：走完了 / 收起来了 / 提醒已读
import { KEYS, safeGet, safeSet } from './store.js'

function clean(state) {
  const out = { done: {}, collapsed: {}, dismissed: {} }
  if (!state || typeof state !== 'object') return out
  for (const key of ['done', 'collapsed', 'dismissed']) {
    const src = state[key]
    if (!src || typeof src !== 'object') continue
    for (const [k, v] of Object.entries(src)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) {
        out[key][k] = v
      }
    }
  }
  return out
}

export function loadElderState(room) {
  return clean(safeGet(KEYS.elderStatePrefix + room, null))
}

export function saveElderState(room, state) {
  safeSet(KEYS.elderStatePrefix + room, clean(state))
}

export function toggleDone(state, segId, now = Date.now()) {
  if (state.done[segId]) delete state.done[segId]
  else state.done[segId] = now
}

export function toggleCollapsed(state, segId) {
  if (state.collapsed[segId]) delete state.collapsed[segId]
  else state.collapsed[segId] = 1
}

export function markDismissed(state, segId, stage, now = Date.now()) {
  state.dismissed[`${segId}:${stage}`] = now
}
