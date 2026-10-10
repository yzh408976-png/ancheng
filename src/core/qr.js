// 自研二维码引擎：字节模式 UTF-8 · ECL L/M · 版本 1-25 · GF(256) RS · 8 掩码择优
// 无外部依赖，矩阵不含静区，输出时加 margin

// RS 块结构表 [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
const RS_BLOCKS = {
  L: {
    1: [7, 1, 19, 0, 0], 2: [10, 1, 34, 0, 0], 3: [15, 1, 55, 0, 0], 4: [20, 1, 80, 0, 0],
    5: [26, 1, 108, 0, 0], 6: [18, 2, 68, 0, 0], 7: [20, 2, 78, 0, 0], 8: [24, 2, 97, 0, 0],
    9: [30, 2, 116, 0, 0], 10: [18, 2, 68, 2, 69], 11: [20, 4, 81, 0, 0], 12: [24, 2, 92, 2, 93],
    13: [26, 4, 107, 0, 0], 14: [30, 3, 115, 1, 116], 15: [22, 5, 87, 1, 88], 16: [24, 5, 98, 1, 99],
    17: [28, 1, 107, 5, 108], 18: [30, 5, 120, 1, 121], 19: [28, 3, 113, 4, 114], 20: [28, 3, 107, 5, 108],
    21: [28, 4, 116, 4, 117], 22: [28, 2, 111, 7, 112], 23: [30, 4, 121, 5, 122], 24: [30, 6, 117, 4, 118],
    25: [26, 8, 106, 4, 107],
  },
  M: {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0],
    5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39],
    9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44], 11: [30, 1, 50, 4, 51], 12: [22, 6, 36, 2, 37],
    13: [22, 8, 37, 1, 38], 14: [24, 4, 40, 5, 41], 15: [24, 5, 41, 5, 42], 16: [28, 7, 45, 3, 46],
    17: [28, 10, 46, 1, 47], 18: [26, 9, 43, 4, 44], 19: [26, 3, 44, 11, 45], 20: [26, 3, 41, 13, 42],
    21: [26, 17, 42, 0, 0], 22: [28, 17, 46, 0, 0],
  },
}

const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
  8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58],
  13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110],
}

const ECL_BITS = { L: 1, M: 0 }

// ---------- GF(256) ----------

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(function initGf() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsGenPoly(deg) {
  let poly = [1]
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i])
      next[j + 1] ^= poly[j]
    }
    poly = next
  }
  return poly.reverse()
}

function rsEncode(data, ecLen) {
  if (ecLen === 0) return []
  const gen = rsGenPoly(ecLen)
  const rem = new Array(ecLen).fill(0)
  for (const b of data) {
    const factor = b ^ rem[0]
    rem.shift()
    rem.push(0)
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) {
        rem[i] ^= gfMul(gen[i], factor)
      }
    }
  }
  return rem
}

// ---------- BCH ----------

function bchFormat(data5) {
  let d = data5 << 10
  for (let i = 4; i >= 0; i--) {
    if ((d >> (i + 10)) & 1) d ^= 0x537 << i
  }
  return ((data5 << 10) | (d & 0x3ff)) ^ 0x5412
}

function bchVersion(v6) {
  let d = v6 << 12
  for (let i = 5; i >= 0; i--) {
    if ((d >> (i + 12)) & 1) d ^= 0x1f25 << i
  }
  return (v6 << 12) | (d & 0xfff)
}

// ---------- 矩阵 ----------

function makeMat(size) {
  return Array.from({ length: size }, () => new Uint8Array(size))
}

function placeFinder(m, r, c) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
      const on = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))
      m[rr][cc] = on ? 1 : 0
    }
  }
}

function buildFunctionMat(version, size) {
  const fn = makeMat(size)
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) fn[r][c] = 1 }
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) mark(r + dr, c + dc)
  }
  for (let i = 8; i < size - 8; i++) { mark(6, i); mark(i, 6) }
  const centers = ALIGN[version] || []
  for (const cr of centers) {
    for (const cc of centers) {
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) continue
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(cr + dr, cc + dc)
    }
  }
  // format + dark module + version 信息区
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8) }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8) }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) { mark(size - 11 + j, i); mark(i, size - 11 + j) }
    }
  }
  return fn
}

function placeFunctionPatterns(m, version, size) {
  placeFinder(m, 0, 0)
  placeFinder(m, 0, size - 7)
  placeFinder(m, size - 7, 0)
  for (let i = 8; i < size - 8; i++) {
    const v = (i + 1) % 2
    m[6][i] = v
    m[i][6] = v
  }
  const centers = ALIGN[version] || []
  for (const cr of centers) {
    for (const cc of centers) {
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m[cr + dr][cc + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0
        }
      }
    }
  }
  m[size - 8][8] = 1
  if (version >= 7) {
    const bits = bchVersion(version)
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1
      const r = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      m[r][c] = b
      m[c][r] = b
    }
  }
}

function placeFormat(m, size, ecl, mask) {
  const bits = bchFormat((ECL_BITS[ecl] << 3) | mask)
  const bit = (i) => (bits >> i) & 1
  for (let i = 0; i <= 5; i++) m[8][i] = bit(i)
  m[8][7] = bit(6)
  m[8][8] = bit(7)
  m[7][8] = bit(8)
  for (let i = 9; i < 15; i++) m[14 - i][8] = bit(i)
  for (let i = 0; i < 8; i++) m[size - 1 - i][8] = bit(i)
  for (let i = 8; i < 15; i++) m[8][size - 15 + i] = bit(i)
}

// ---------- 数据码字 ----------

function buildCodewords(bytes, version, ecl) {
  const [ecLen, g1n, g1d, g2n, g2d] = RS_BLOCKS[ecl][version]
  const dataTotal = g1n * g1d + g2n * g2d
  const bits = []
  const pushBits = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1)
  }
  pushBits(4, 4)
  pushBits(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) pushBits(b, 8)
  const cap = dataTotal * 8
  pushBits(0, Math.min(4, cap - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    data.push(v)
  }
  const pads = [0xec, 0x11]
  let pi = 0
  while (data.length < dataTotal) data.push(pads[pi++ % 2])

  const blocks = []
  let off = 0
  for (let i = 0; i < g1n; i++) {
    const d = data.slice(off, off + g1d); off += g1d
    blocks.push({ data: d, ec: rsEncode(d, ecLen) })
  }
  for (let i = 0; i < g2n; i++) {
    const d = data.slice(off, off + g2d); off += g2d
    blocks.push({ data: d, ec: rsEncode(d, ecLen) })
  }
  const out = []
  const maxD = Math.max(g1d, g2d)
  for (let i = 0; i < maxD; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i])
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of blocks) out.push(b.ec[i])
  }
  return out
}

// ---------- 掩码与罚分 ----------

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return (r * c) % 2 + (r * c) % 3 === 0
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0
    case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0
    default: return false
  }
}

function penalty(m, size) {
  let score = 0
  // N1: 连续同色
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < size; i++) {
      let run = 1
      let prev = axis ? m[i][0] : m[0][i]
      for (let j = 1; j < size; j++) {
        const v = axis ? m[i][j] : m[j][i]
        if (v === prev) run++
        else {
          if (run >= 5) score += 3 + (run - 5)
          run = 1
          prev = v
        }
      }
      if (run >= 5) score += 3 + (run - 5)
    }
  }
  // N2: 2×2 同色
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3
    }
  }
  // N3: finder 同款图案 1011101 + 000
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1]
  const pat2 = [...pat].reverse()
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let h1 = true, h2 = true, v1 = true, v2 = true
      for (let k = 0; k < 11; k++) {
        if (m[r][c + k] !== pat[k]) h1 = false
        if (m[r][c + k] !== pat2[k]) h2 = false
        if (m[c + k][r] !== pat[k]) v1 = false
        if (m[c + k][r] !== pat2[k]) v2 = false
      }
      if (h1) score += 40
      if (h2) score += 40
      if (v1) score += 40
      if (v2) score += 40
    }
  }
  // N4: 暗模块比例
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c]
  const pct = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(pct - 50) / 5) * 10
  return score
}

// ---------- 编码入口 ----------

const te = new TextEncoder()

function dataCapacity(version, ecl) {
  const [ecLen, g1n, g1d, g2n, g2d] = RS_BLOCKS[ecl][version]
  const cw = g1n * g1d + g2n * g2d
  const countBits = version <= 9 ? 8 : 16
  return Math.floor((cw * 8 - 4 - countBits) / 8)
}

function encodeVersion(text, ecl, version) {
  const bytes = te.encode(text)
  if (bytes.length > dataCapacity(version, ecl)) return null
  const size = version * 4 + 17
  const codewords = buildCodewords(bytes, version, ecl)
  const fn = buildFunctionMat(version, size)

  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = makeMat(size)
    placeFunctionPatterns(m, version, size)
    placeFormat(m, size, ecl, mask)
    let i = 0
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j
          const upward = ((right + 1) & 2) === 0
          const r = upward ? size - 1 - vert : vert
          if (fn[r][c]) continue
          let bit = 0
          if (i < codewords.length * 8) {
            bit = (codewords[i >> 3] >> (7 - (i & 7))) & 1
            i++
          }
          if (maskBit(mask, r, c)) bit ^= 1
          m[r][c] = bit
        }
      }
    }
    const score = penalty(m, size)
    if (score < bestScore) {
      bestScore = score
      best = m
    }
  }
  return { version, size, modules: best }
}

export function encodeQR(text, { ecl = 'M' } = {}) {
  const level = RS_BLOCKS[ecl] ? ecl : 'M'
  const maxV = level === 'M' ? 22 : 25
  const bytes = te.encode(String(text || ''))
  for (let v = 1; v <= maxV; v++) {
    if (bytes.length <= dataCapacity(v, level)) {
      return encodeVersion(text, level, v)
    }
  }
  return null
}

// ---------- 输出 ----------

export function qrToSvg(matrix, { margin = 4, dark = '#101210', light = '#FFFFFF' } = {}) {
  const size = matrix.length
  const total = size + margin * 2
  let cells = ''
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) cells += `M${c + margin},${r + margin}h1v1h-1z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${light}"/><path d="${cells}" fill="${dark}"/></svg>`
}

export function qrDataUrl(text, opts = {}) {
  const m = encodeQR(text, opts)
  if (!m) return null
  const svg = qrToSvg(m.modules, opts)
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export function drawToCanvas(canvas, matrix, { margin = 4, dark = '#101210', light = '#FFFFFF' } = {}) {
  const size = matrix.length
  const total = size + margin * 2
  const scale = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / total)) || 1
  canvas.width = total * scale
  canvas.height = total * scale
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = dark
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale)
    }
  }
}

// M 优先，装不下退 L，两级都超则 null
export function qrInfo(text, { box = 248, margin = 4 } = {}) {
  for (const ecl of ['M', 'L']) {
    const m = encodeQR(text, { ecl })
    if (m) {
      const pxPerModule = Math.floor(box / (m.size + margin * 2))
      if (pxPerModule < 2) continue
      return {
        dataUrl: qrDataUrl(text, { ecl, margin }),
        version: m.version,
        size: m.size,
        ecl,
        pxPerModule,
      }
    }
  }
  return null
}
