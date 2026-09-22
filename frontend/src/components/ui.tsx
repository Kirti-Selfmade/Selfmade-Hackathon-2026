import {
  Children, cloneElement, isValidElement, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from 'react'
import { AlertTriangle, Inbox, X } from 'lucide-react'
import { initials } from '../lib/format'
import type { LeaveStatus } from '../lib/types'
import { ApiError } from '../lib/api'

/* ---------- Button ---------- */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
  size?: 'md' | 'sm'
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, block, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

/* ---------- Layout bits ---------- */
export function Card({ children, className = '', pad = false }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`card ${pad ? 'card-pad' : ''} ${className}`}>{children}</section>
}

export function CardHead({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

/* ---------- Badges ---------- */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : 'badge-' + tone}`}>{children}</span>
}

export function StatusBadge({ status }: { status: LeaveStatus | string }) {
  const tone = status === 'Approved' ? 'success' : status === 'Pending' ? 'warning' : status === 'Rejected' ? 'danger' : 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}

/* ---------- Avatar ---------- */
export function Avatar({ name, url, size = 'md' }: { name: string; url?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const cls = `avatar ${size === 'md' ? '' : 'avatar-' + size}`
  if (url) return <img className={cls} src={url} alt="" loading="lazy" />
  return <span className={cls} aria-hidden="true">{initials(name) || '?'}</span>
}

/* ---------- Form field ---------- */
interface FieldProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: ReactElement<Record<string, unknown>>
}

export function Field({ label, error, hint, required, className = '', children }: FieldProps) {
  const id = useId()
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  const child = Children.only(children)
  const control = isValidElement(child)
    ? cloneElement(child, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined })
    : child
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {control}
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="error" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  )
}

/** Renders a server-side error as a banner if it is not tied to a visible field. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
  return <div className="form-error-banner" role="alert">{message}</div>
}

/* ---------- Feedback ---------- */
export function Skeleton({ h = 16, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 20 }} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={18} w={`${90 - (i % 3) * 12}%`} />)}
    </div>
  )
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon ?? <Inbox size={24} />}</div>
      <h3>{title}</h3>
      {text && <p className="small">{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'We could not load this. Please try again.'
  return (
    <div className="empty" role="alert">
      <div className="icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><AlertTriangle size={24} /></div>
      <h3>Could not load</h3>
      <p className="small">{message}</p>
      {error instanceof ApiError && error.correlationId && <p className="tiny">Reference: <span className="code">{error.correlationId}</span></p>}
      {onRetry && <div style={{ marginTop: 14 }}><Button onClick={onRetry}>Try again</Button></div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>{children}</div>
}

/* ---------- Pagination ---------- */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="small muted">Showing {from}-{to} of {total}</span>
      <div className="row gap-sm">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="small" aria-current="page">Page {page} of {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  )
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  )
}

/* ---------- Overlay (drawer / modal) with focus trap ---------- */
interface OverlayProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  variant?: 'drawer' | 'modal'
  wide?: boolean
}

/** Only the top-most overlay reacts to Escape / Tab (a confirm dialog can sit on top of a drawer). */
const overlayStack: symbol[] = []

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Overlay({ title, onClose, children, footer, variant = 'drawer', wide }: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const me = Symbol('overlay')
    overlayStack.push(me)
    const previous = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = ref.current
    const focusables = node?.querySelectorAll<HTMLElement>(FOCUSABLE)
    // Prefer the first form control over the close button.
    const firstField = node?.querySelector<HTMLElement>('.ov-body input:not([disabled]), .ov-body select, .ov-body textarea')
    ;(firstField ?? focusables?.[0])?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== me) return
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = overlayStack.indexOf(me)
      if (at >= 0) overlayStack.splice(at, 1)
      document.body.style.overflow = prevOverflow
      previous?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`overlay ${variant === 'modal' ? 'center' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={variant === 'modal' ? 'modal' : `drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ov-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="ov-body">{children}</div>
        {footer && <div className="ov-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------- Confirm dialog (optionally with a mandatory reason) ---------- */
interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  reasonLabel?: string
  reasonRequired?: boolean
  onConfirm: (reason: string) => Promise<unknown> | unknown
  onClose: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, tone = 'primary', reasonLabel, reasonRequired, onConfirm, onClose }: ConfirmProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)
  const missing = !!reasonLabel && reasonRequired && reason.trim().length === 0

  async function submit() {
    setTouched(true)
    if (missing) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Overlay
      title={title}
      variant="modal"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={submit}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack">
        <div>{message}</div>
        {reasonLabel && (
          <Field label={reasonLabel} required={reasonRequired} error={touched && missing ? 'This is required.' : undefined}>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </Field>
        )}
        <FormError error={error} />
      </div>
    </Overlay>
  )
}

/* ---------- Progress bar for balances ---------- */
export function BalanceBar({ used, pending, total, color }: { used: number; pending: number; total: number; color: string }) {
  const safeTotal = total > 0 ? total : 1
  const usedPct = Math.min(100, (used / safeTotal) * 100)
  const pendingPct = Math.min(100 - usedPct, (pending / safeTotal) * 100)
  return (
    <div className="progress" role="img" aria-label={`${used} used, ${pending} pending, of ${total}`}>
      <span style={{ width: `${usedPct}%`, background: color }} />
      <span style={{ width: `${pendingPct}%`, background: color, opacity: 0.4 }} />
    </div>
  )
}
