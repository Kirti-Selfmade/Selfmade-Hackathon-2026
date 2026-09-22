import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { ApiError, get, post } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { formatDays } from '../../lib/format'
import { useDebounced, useLeaveTypes, useRefreshData } from '../../lib/hooks'
import type { Balance, SlotCheck } from '../../lib/types'
import { Button, Field, FormError, Notice, Overlay } from '../../components/ui'

interface Row { key: number; leaveTypeId: string; startDate: string; endDate: string; isHalfDay: boolean }

let keySeq = 1
const newRow = (): Row => ({ key: keySeq++, leaveTypeId: '', startDate: '', endDate: '', isHalfDay: false })

export default function ApplyLeaveDrawer({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshData()
  const types = useLeaveTypes()
  const balances = useQuery({ queryKey: ['leaves', 'balances'], queryFn: () => get<Balance[]>('/leaves/balances') })

  const [rows, setRows] = useState<Row[]>([newRow()])
  const [reason, setReason] = useState('')
  const [checks, setChecks] = useState<Record<number, SlotCheck>>({})
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [submitted, setSubmitted] = useState(false)

  const typeById = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t])), [types.data])

  // Live validation: ask the server (same rules as submit) as the user types.
  const previewInput = useMemo(
    () => rows.filter((r) => r.leaveTypeId && r.startDate).map((r) => ({
      key: r.key, leaveTypeId: Number(r.leaveTypeId), startDate: r.startDate, endDate: r.endDate || null, isHalfDay: r.isHalfDay, reason: null,
    })),
    [rows],
  )
  const debounced = useDebounced(previewInput, 400)

  useEffect(() => {
    if (debounced.length === 0) { setChecks({}); return }
    let cancelled = false
    setPreviewing(true)
    post<SlotCheck[]>('/leaves/preview', { slots: debounced.map(({ key: _k, ...s }) => s) })
      .then((res) => {
        if (cancelled) return
        const map: Record<number, SlotCheck> = {}
        res.forEach((c, i) => { map[debounced[i].key] = c })
        setChecks(map)
      })
      .catch(() => { if (!cancelled) setChecks({}) })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [debounced])

  function update(key: number, patch: Partial<Row>) {
    setRows((cur) => cur.map((r) => {
      if (r.key !== key) return r
      const next = { ...r, ...patch }
      // A half day only makes sense for a single date.
      if (next.endDate && next.endDate !== next.startDate) next.isHalfDay = false
      return next
    }))
  }

  const serverFieldErrors = error instanceof ApiError ? error.errors : {}
  const totalDays = Object.values(checks).reduce((s, c) => s + (c.errors.length === 0 ? c.days : 0), 0)
  const hasBlockingErrors = Object.values(checks).some((c) => c.errors.length > 0)
  const reasonMissing = submitted && !reason.trim()
  const rowIncomplete = rows.some((r) => !r.leaveTypeId || !r.startDate)

  async function submit() {
    setSubmitted(true)
    setError(null)
    if (!reason.trim() || rowIncomplete || hasBlockingErrors) return
    setBusy(true)
    try {
      await post('/leaves', {
        reason: reason.trim(),
        slots: rows.map((r) => ({ leaveTypeId: Number(r.leaveTypeId), startDate: r.startDate, endDate: r.endDate || null, isHalfDay: r.isHalfDay, reason: null })),
      })
      toast.success(rows.length > 1 ? 'Leave requests submitted.' : 'Leave request submitted.')
      refresh()
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Overlay
      title="Apply for leave"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }} aria-live="polite">
            {previewing ? 'Checking...' : totalDays > 0 ? `${formatDays(totalDays)} day(s) will be requested` : ''}
          </span>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={hasBlockingErrors}>Submit request</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <Notice tone="info">
          <div className="small">Weekends and company holidays are not counted. You can add several dates or ranges in one request.</div>
        </Notice>

        {balances.data && (
          <div className="pill-row" aria-label="Your current balances">
            {balances.data.filter((b) => b.tracksBalance).map((b) => (
              <span key={b.leaveTypeId} className="badge" style={{ background: 'var(--surface-2)' }}>
                <span className="dot" style={{ background: b.color }} /> {b.code}: {formatDays(b.available)} left
              </span>
            ))}
          </div>
        )}

        {rows.map((r, idx) => {
          const check = checks[r.key]
          const type = typeById.get(Number(r.leaveTypeId))
          const serverMsgs = serverFieldErrors[`slots[${idx}]`] ?? []
          const halfDisabled = !!r.endDate && r.endDate !== r.startDate
          return (
            <div key={r.key} className="slot-row" role="group" aria-label={`Leave date ${idx + 1}`}>
              <div className="slot-grid">
                <Field label="Leave type" required error={submitted && !r.leaveTypeId ? 'Choose a leave type.' : undefined}>
                  <select className="select" value={r.leaveTypeId} onChange={(e) => update(r.key, { leaveTypeId: e.target.value })}>
                    <option value="">Select...</option>
                    {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="From" required error={submitted && !r.startDate ? 'Pick a date.' : undefined}>
                  <input className="input" type="date" value={r.startDate} onChange={(e) => update(r.key, { startDate: e.target.value, endDate: r.endDate && r.endDate < e.target.value ? '' : r.endDate })} />
                </Field>
                <Field label="To (optional)" hint="Leave empty for a single day">
                  <input className="input" type="date" min={r.startDate || undefined} value={r.endDate} onChange={(e) => update(r.key, { endDate: e.target.value })} />
                </Field>
              </div>
              <div className="row between row-wrap">
                <label className="check" style={{ opacity: halfDisabled || (type && !type.allowHalfDay) ? 0.5 : 1 }}>
                  <input type="checkbox" checked={r.isHalfDay} disabled={halfDisabled || (!!type && !type.allowHalfDay)} onChange={(e) => update(r.key, { isHalfDay: e.target.checked })} />
                  Half day
                </label>
                {rows.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} aria-label={`Remove date ${idx + 1}`}><Trash2 size={15} /> Remove</Button>
                )}
              </div>

              {check && check.errors.length === 0 && (
                <div className="row gap-sm small" style={{ color: 'var(--success)' }}>
                  <CheckCircle2 size={16} />
                  <span>{formatDays(check.days)} day(s)</span>
                  {check.availableAfter !== null && <span className="muted">- {formatDays(check.availableAfter)} left after this</span>}
                </div>
              )}
              {[...(check?.errors ?? []), ...serverMsgs.filter((m) => !(check?.errors ?? []).includes(m))].map((m) => (
                <div key={m} className="row gap-sm small" style={{ color: 'var(--danger)' }} role="alert"><AlertCircle size={16} /> {m}</div>
              ))}
              {(check?.warnings ?? []).map((m) => <div key={m} className="small muted">{m}</div>)}
            </div>
          )
        })}

        <div><Button onClick={() => setRows((cur) => [...cur, newRow()])} disabled={rows.length >= 10}><Plus size={16} /> Add another date</Button></div>

        <Field label="Reason" required error={reasonMissing ? 'Please give a short reason.' : undefined} hint="Visible to your manager and HR.">
          <textarea className="textarea" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function, medical appointment" />
        </Field>

        {!Object.keys(serverFieldErrors).some((k) => k.startsWith('slots[')) && <FormError error={error} />}
        <p className="tiny muted">You can apply for dates up to 30 days in the past.</p>
      </div>
    </Overlay>
  )
}
