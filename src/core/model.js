import { KEYS, safeGet, safeSet, safeDel } from './store.js'

export const MODEL_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', vision: false },
  { id: 'moonshot', name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', vision: false },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', vision: false },
  { id: 'qwen', name: '阿里通义', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', vision: true },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true },
  { id: 'ollama', name: '本机 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', vision: false },
]

export function emptyModelConfig() {
  return {
    presetId: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    vision: false,
    temperature: 0.2,
    useProxy: false,
    timeoutMs: 20000,
  }
}

export function presetById(id) {
  return MODEL_PRESETS.find(p => p.id === id) || null
}

export function normalizeModelConfig(raw) {
  const cfg = emptyModelConfig()
  if (!raw || typeof raw !== 'object') return cfg
  if (typeof raw.baseUrl === 'string') cfg.baseUrl = raw.baseUrl.trim().replace(/\/+$/, '')
  if (typeof raw.apiKey === 'string') cfg.apiKey = raw.apiKey.trim()
  if (typeof raw.model === 'string') cfg.model = raw.model.trim()
  if (typeof raw.presetId === 'string') cfg.presetId = raw.presetId
  cfg.vision = !!raw.vision
  cfg.useProxy = !!raw.useProxy
  if (typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 1) cfg.temperature = raw.temperature
  if (typeof raw.timeoutMs === 'number' && raw.timeoutMs >= 3000 && raw.timeoutMs <= 60000) cfg.timeoutMs = raw.timeoutMs
  return cfg
}

export function loadModelConfig() {
  return normalizeModelConfig(safeGet(KEYS.model, null))
}

export function saveModelConfig(cfg) {
  safeSet(KEYS.model, normalizeModelConfig(cfg))
}

export function clearModelConfig() {
  safeDel(KEYS.model)
}

export function isConfigured(cfg) {
  return !!(cfg && cfg.baseUrl && cfg.model)
}

export function supportsVision(cfg) {
  return isConfigured(cfg) && !!cfg.vision
}

export function applyPreset(cfg, presetId) {
  const p = presetById(presetId)
  if (!p) return cfg
  cfg.presetId = p.id
  cfg.baseUrl = p.baseUrl
  cfg.model = p.model
  cfg.vision = p.vision
  return cfg
}

export function reasonText(reason) {
  switch (reason) {
    case 'not-configured': return '还没配置模型'
    case 'network': return '网络不通或地址不对'
    case 'cors': return '浏览器直连被拦（CORS）'
    case 'unauthorized': return 'API Key 不对或没权限'
    case 'rate-limit': return '请求太频繁，稍后再试'
    case 'server': return '模型服务那边出错了'
    case 'timeout': return '等太久没回应'
    case 'empty': return '模型没返回内容'
    case 'bad-json': return '返回的内容不是合法 JSON'
    default: return '调用失败'
  }
}

export function imageContent(dataUrl) {
  return { type: 'image_url', image_url: { url: dataUrl } }
}

function statusToReason(status) {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'server'
}

async function readResponse(res) {
  let text = ''
  try { text = await res.text() } catch { /* ignore */ }
  let data = null
  try { data = JSON.parse(text) } catch { /* ignore */ }
  if (!res.ok) {
    return { ok: false, reason: statusToReason(res.status), detail: data && data.error && data.error.message ? data.error.message : text.slice(0, 200) }
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (typeof content !== 'string' || !content) return { ok: false, reason: 'empty', detail: text.slice(0, 200) }
  return { ok: true, content }
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function chat(messages, { cfg, temperature } = {}) {
  const c = cfg || loadModelConfig()
  if (!isConfigured(c)) return { ok: false, reason: 'not-configured' }
  const body = JSON.stringify({
    model: c.model,
    messages,
    temperature: temperature != null ? temperature : c.temperature,
  })
  const headers = { 'content-type': 'application/json' }
  if (c.apiKey) headers.authorization = 'Bearer ' + c.apiKey

  try {
    const res = await fetchWithTimeout(c.baseUrl + '/chat/completions', {
      method: 'POST', headers, body,
    }, c.timeoutMs)
    const out = await readResponse(res)
    if (out.ok) return { ...out, via: 'browser' }
    if (out.reason === 'server' || out.reason === 'empty') {
      // 可能是 CORS 假 500，尝试代理
    } else {
      return out
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' }
  }

  if (c.useProxy) {
    try {
      const res = await fetchWithTimeout('/api/model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, messages, temperature: c.temperature,
        }),
      }, c.timeoutMs)
      const out = await readResponse(res)
      if (out.ok) return { ...out, via: 'proxy' }
      return out
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' }
      return { ok: false, reason: 'network' }
    }
  }
  return { ok: false, reason: 'cors' }
}

export async function testConnection(cfg) {
  const out = await chat([{ role: 'user', content: '回复「连通」两个字，不要别的。' }], { cfg })
  if (!out.ok) return { ok: false, reason: out.reason, detail: out.detail || '' }
  return { ok: true, via: out.via, sample: out.content.slice(0, 40) }
}
