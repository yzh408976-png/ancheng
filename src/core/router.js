import { reactive } from 'vue'

const routeState = reactive({ path: '/' })
const listeners = new Set()

export function normalize(h) {
  if (!h) return '/'
  let p = String(h)
  p = p.replace(/^#/, '')
  if (!p.startsWith('/')) p = '/' + p
  p = p.split('?')[0]
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p || '/'
}

export function currentPath() {
  return normalize(location.hash)
}

export function navigate(path, { replace = false } = {}) {
  const h = '#' + normalize(path)
  if (replace) {
    history.replaceState(null, '', h)
    sync()
  } else {
    location.hash = h
  }
}

function sync() {
  routeState.path = currentPath()
  for (const fn of listeners) fn(routeState.path)
}

export function installRouter() {
  window.addEventListener('hashchange', sync)
  sync()
}

export function useRoute() {
  return routeState
}

export function onRouteChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function matchPath(pattern, path) {
  const ps = normalize(pattern).split('/')
  const xs = normalize(path).split('/')
  if (ps.length !== xs.length) return null
  const params = {}
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(':')) {
      params[ps[i].slice(1)] = decodeURIComponent(xs[i])
    } else if (ps[i] !== xs[i]) {
      return null
    }
  }
  return params
}
