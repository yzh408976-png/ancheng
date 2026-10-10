// .ics 日历导出 + canvas 长图海报
import { cnDate, TYPE_LABELS } from './agents.js'

function pad(n) { return String(n).padStart(2, '0') }

function icsDate(dateStr) {
  return dateStr.replace(/-/g, '')
}

function fold(line) {
  if (line.length <= 74) return line
  const parts = [line.slice(0, 74)]
  let rest = line.slice(74)
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 73))
    rest = rest.slice(73)
  }
  return parts.join('\r\n')
}

function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildIcs(trip, { now = new Date() } = {}) {
  const segs = (trip && trip.segments) || []
  if (!segs.length) return null
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ancheng//trip//CN',
    'CALSCALE:GREGORIAN',
  ]
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  for (const seg of segs) {
    if (!seg.date || seg.dateInvalid) continue
    const title = seg.plain && seg.plain.title ? seg.plain.title : `${seg.code || TYPE_LABELS[seg.type]} ${seg.from} → ${seg.to}`
    const desc = seg.plain && seg.plain.voice ? seg.plain.voice : ''
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${trip.id}-${seg.id}@ancheng`)
    lines.push(`DTSTAMP:${stamp}`)
    if (seg.type === 'hotel') {
      const start = icsDate(seg.date)
      const end = icsDate(addDays(seg.date, seg.hotelNights || 1))
      lines.push(`DTSTART;VALUE=DATE:${start}`)
      lines.push(`DTEND;VALUE=DATE:${end}`)
    } else if (seg.departTime) {
      lines.push(`DTSTART:${icsDate(seg.date)}T${seg.departTime.replace(':', '')}00`)
      if (seg.arriveTime) {
        const endDate = seg.arriveNextDay ? addDays(seg.date, 1) : seg.date
        lines.push(`DTEND:${icsDate(endDate)}T${seg.arriveTime.replace(':', '')}00`)
      } else {
        const end = addDays(seg.date, 1)
        lines.push(`DTEND:${icsDate(end)}T000000`)
      }
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(seg.date)}`)
      lines.push(`DTEND;VALUE=DATE:${icsDate(addDays(seg.date, 1))}`)
    }
    if (seg.type === 'train' || seg.type === 'flight') {
      lines.push('BEGIN:VALARM')
      lines.push('TRIGGER:-PT2H')
      lines.push('ACTION:DISPLAY')
      lines.push(fold(`DESCRIPTION:${esc(title)} 两小时后出发`))
      lines.push('END:VALARM')
    }
    lines.push(fold(`SUMMARY:${esc(title)}`))
    if (desc) lines.push(fold(`DESCRIPTION:${esc(desc)}`))
    if (seg.from || seg.to) lines.push(fold(`LOCATION:${esc([seg.from, seg.to].filter(Boolean).join(' → '))}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_')
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export function downloadIcs(trip, opts = {}) {
  const ics = buildIcs(trip, opts)
  if (!ics) return false
  const first = (trip.segments || []).find(s => s.date) || trip.segments[0]
  const name = `安程-${safeName(trip.title)}${first && first.date ? first.date : ''}.ics`
  download(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), name)
  return true
}

export function renderTripPoster(trip) {
  const segs = (trip && trip.segments) || []
  const W = 1080
  const headH = 220
  const cardH = 190
  const footH = 100
  const H = headH + segs.length * cardH + 80 + footH
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#F6F7F5'
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#0B6B45'
  ctx.fillRect(0, 0, W, 12)

  ctx.fillStyle = '#101210'
  ctx.font = '900 64px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText(trip.title || '行程', 64, 120)
  ctx.fillStyle = '#5E635A'
  ctx.font = '26px "PingFang SC","Microsoft YaHei",sans-serif'
  const first = segs.find(s => s.date)
  ctx.fillText(first ? cnDate(first.date) + ' 出发 · 共 ' + segs.length + ' 段' : '共 ' + segs.length + ' 段', 64, 170)

  segs.forEach((seg, i) => {
    const y = headH + 40 + i * cardH
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#DBDED8'
    roundRect(ctx, 56, y, W - 112, cardH - 24, 16)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#0B6B45'
    ctx.font = '700 26px "SF Mono",Menlo,monospace'
    ctx.fillText(String(i + 1).padStart(2, '0'), 88, y + 52)
    ctx.fillStyle = '#101210'
    ctx.font = '700 36px "PingFang SC","Microsoft YaHei",sans-serif'
    const title = seg.plain && seg.plain.title ? seg.plain.title : TYPE_LABELS[seg.type]
    ctx.fillText(title, 150, y + 54)
    ctx.fillStyle = '#3E423C'
    ctx.font = '30px "PingFang SC","Microsoft YaHei",sans-serif'
    if (seg.plain) ctx.fillText(seg.plain.depart, 150, y + 108)
    if (seg.plain && seg.plain.arrive) {
      ctx.fillStyle = '#5E635A'
      ctx.font = '28px "PingFang SC","Microsoft YaHei",sans-serif'
      ctx.fillText(seg.plain.arrive, 150, y + 148)
    }
  })

  ctx.fillStyle = '#5E635A'
  ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText('安程 · 子女把行程排好，长辈打开就能看懂', 64, H - 44)
  return canvas
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function downloadTripPoster(trip) {
  const canvas = renderTripPoster(trip)
  if (!canvas) return false
  const first = (trip.segments || []).find(s => s.date) || trip.segments[0]
  const name = `安程-${safeName(trip.title)}${first && first.date ? first.date : ''}.png`
  canvas.toBlob(blob => {
    if (blob) download(blob, name)
  }, 'image/png')
  return true
}
