/** Date helpers work on plain 'YYYY-MM-DD' strings to avoid time-zone drift. */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayIso(): string {
  return toIso(new Date())
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

export function formatDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return '-'
  const d = parseIso(iso.slice(0, 10))
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start)
  const s = parseIso(start)
  const e = parseIso(end)
  if (s.getFullYear() === e.getFullYear()) return `${formatDate(start, false)} - ${formatDate(end)}`
  return `${formatDate(start)} - ${formatDate(end)}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  // Server timestamps are UTC without a trailing Z; treat them as UTC.
  const d = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z')
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso: string): string {
  const d = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z').getTime()
  const secs = Math.max(0, Math.round((Date.now() - d) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days} d ago`
  return formatDate(iso.slice(0, 10))
}

export function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function tenure(joinIso: string, now: Date = new Date()): string {
  const j = parseIso(joinIso)
  let months = (now.getFullYear() - j.getFullYear()) * 12 + (now.getMonth() - j.getMonth())
  if (now.getDate() < j.getDate()) months -= 1
  months = Math.max(0, months)
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} month${m === 1 ? '' : 's'}`
  return m === 0 ? `${y} year${y === 1 ? '' : 's'}` : `${y} yr ${m} mo`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function isWeekend(iso: string): boolean {
  const day = parseIso(iso).getDay()
  return day === 0 || day === 6
}

export function roleLabel(role: string): string {
  return role === 'HrAdmin' ? 'HR Admin' : role === 'SuperAdmin' ? 'Super Admin' : role
}
