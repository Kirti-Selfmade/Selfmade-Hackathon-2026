import type { AuthResponse } from './types'

const ACCESS_KEY = 'hrm.access'
const REFRESH_KEY = 'hrm.refresh'

// Storage can throw (private mode, blocked cookies), so every access is guarded.
const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore */ }
  },
  remove(key: string) {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  },
}

export const tokenStore = {
  access: () => store.get(ACCESS_KEY),
  refresh: () => store.get(REFRESH_KEY),
  set(access: string, refresh: string) {
    store.set(ACCESS_KEY, access)
    store.set(REFRESH_KEY, refresh)
  },
  clear() {
    store.remove(ACCESS_KEY)
    store.remove(REFRESH_KEY)
  },
}

export class ApiError extends Error {
  status: number
  errors: Record<string, string[]>
  correlationId?: string

  constructor(status: number, message: string, errors: Record<string, string[]> = {}, correlationId?: string) {
    super(message)
    this.status = status
    this.errors = errors
    this.correlationId = correlationId
  }

  /** First message for a field key, e.g. fieldError('email'). */
  fieldError(key: string): string | undefined {
    const match = Object.keys(this.errors).find((k) => k.toLowerCase() === key.toLowerCase())
    return match ? this.errors[match][0] : undefined
  }
}

/** Turns an RFC 7807 problem-details body into a friendly ApiError. */
export function parseProblem(status: number, body: unknown, correlationId?: string): ApiError {
  const b = (body ?? {}) as { title?: string; detail?: string; errors?: Record<string, string[]>; correlationId?: string }
  const errors = b.errors ?? {}
  const firstFieldMessage = Object.values(errors)[0]?.[0]
  let message = b.detail || firstFieldMessage || b.title || ''
  if (!message) {
    message =
      status === 401 ? 'Please sign in again.' :
      status === 403 ? 'You do not have permission to do that.' :
      status === 404 ? 'We could not find what you were looking for.' :
      status === 429 ? 'Too many attempts. Please wait a moment and try again.' :
      status >= 500 ? 'The server had a problem. Please try again in a moment.' :
      'Something did not work. Please check your input and try again.'
  }
  return new ApiError(status, message, errors, b.correlationId ?? correlationId)
}

let onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn
}

let refreshing: Promise<boolean> | null = null

/** Single-flight refresh so parallel 401s trigger only one refresh call. */
async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing
  const refresh = tokenStore.refresh()
  if (!refresh) return false
  refreshing = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as AuthResponse
      tokenStore.set(data.accessToken, data.refreshToken)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

function newCorrelationId() {
  return (crypto.randomUUID?.() ?? String(Date.now())).replace(/-/g, '')
}

interface RequestOptions {
  method?: string
  body?: unknown
  form?: FormData
  query?: Record<string, string | number | boolean | null | undefined>
  auth?: boolean
  raw?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL('/api/v1' + path, window.location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  return url.pathname + url.search
}

async function send(path: string, opts: RequestOptions, retry: boolean): Promise<Response> {
  const headers: Record<string, string> = { 'X-Correlation-Id': newCorrelationId() }
  const token = tokenStore.access()
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? 'GET', headers, body })

  if (res.status === 401 && opts.auth !== false && retry && (await tryRefresh())) {
    return send(path, opts, false)
  }
  return res
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await send(path, opts, true)
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }

  if (res.status === 401 && opts.auth !== false) {
    tokenStore.clear()
    onSessionExpired?.()
  }

  if (!res.ok) {
    let body: unknown = null
    try { body = await res.json() } catch { /* not json */ }
    throw parseProblem(res.status, body, res.headers.get('X-Correlation-Id') ?? undefined)
  }

  if (res.status === 204) return undefined as T
  if (opts.raw) return (await res.blob()) as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const get = <T,>(path: string, query?: RequestOptions['query']) => api<T>(path, { query })
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} })
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })

/** Downloads an authenticated file (e.g. CSV export) and triggers a browser save. */
export async function download(path: string, query: RequestOptions['query'], fallbackName: string) {
  const blob = await api<Blob>(path, { query, raw: true })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
