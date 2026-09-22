import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Pencil, Trash2, Undo2, X } from 'lucide-react'
import { ApiError, get, post, put } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { formatDate, formatDateTime, formatDays, formatRange, todayIso } from '../../lib/format'
import { useLeaveTypes, useRefreshData } from '../../lib/hooks'
import type { LeaveDetail } from '../../lib/types'
import { Button, ConfirmDialog, ErrorState, Field, FormError, Notice, Overlay, SkeletonRows, StatusBadge, Avatar } from '../../components/ui'

export default function LeaveDetailDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { user, isManager, isHr } = useAuth()
  const toast = useToast()
  const refresh = useRefreshData()
  const q = useQuery({ queryKey: ['leaves', 'detail', id], queryFn: () => get<LeaveDetail>(`/leaves/${id}`) })
  const [dialog, setDialog] = useState<null | 'approve' | 'reject' | 'cancel' | 'remove' | 'edit'>(null)

  const d = q.data
  const leave = d?.leave
  const isOwner = !!leave && leave.employeeId === user?.id
  const canDecide = !!leave && isManager && !isOwner && leave.status === 'Pending'
  const canCancel = !!leave && isOwner && (leave.status === 'Pending' || (leave.status === 'Approved' && leave.startDate > todayIso()))
  const canEdit = !!leave && isHr && (leave.status === 'Pending' || leave.status === 'Approved')

  async function done(message: string) {
    toast.success(message)
    refresh()
    await q.refetch()
  }

  return (
    <Overlay
      title="Leave request"
      onClose={onClose}
      wide
      footer={leave && (canDecide || canCancel || canEdit || isHr) ? (
        <>
          {isHr && <Button variant="danger-ghost" onClick={() => setDialog('remove')}><Trash2 size={16} /> Delete</Button>}
          {canEdit && <Button onClick={() => setDialog('edit')}><Pencil size={16} /> Edit</Button>}
          {canCancel && <Button variant="danger-ghost" onClick={() => setDialog('cancel')}><Undo2 size={16} /> Cancel request</Button>}
          {canDecide && <Button variant="danger-ghost" onClick={() => setDialog('reject')}><X size={16} /> Reject</Button>}
          {canDecide && <Button variant="primary" onClick={() => setDialog('approve')}><Check size={16} /> Approve</Button>}
        </>
      ) : undefined}
    >
      {q.isLoading && <SkeletonRows rows={8} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && leave && (
        <div className="stack" style={{ gap: 22 }}>
          <div className="row between row-wrap">
            <div className="cell-person">
              <Avatar name={leave.employeeName} size="lg" />
              <div>
                <div className="strong" style={{ fontSize: 17 }}>{leave.employeeName}</div>
                <div className="small muted">{leave.department ?? 'No department'}</div>
              </div>
            </div>
            <StatusBadge status={leave.status} />
          </div>

          <dl className="kv">
            <dt>Leave type</dt><dd><span className="dot" style={{ background: leave.color, marginRight: 8 }} />{leave.leaveType}</dd>
            <dt>Dates</dt><dd>{formatRange(leave.startDate, leave.endDate)}{leave.isHalfDay ? ' (half day)' : ''}</dd>
            <dt>Working days</dt><dd>{formatDays(leave.days)}</dd>
            <dt>Reason</dt><dd>{leave.reason}</dd>
            <dt>Applied on</dt><dd>{formatDateTime(leave.appliedAt)}</dd>
            {leave.decidedBy && (<><dt>Decided by</dt><dd>{leave.decidedBy} on {formatDateTime(leave.decidedAt)}</dd></>)}
            {leave.decisionComment && (<><dt>Comment</dt><dd>{leave.decisionComment}</dd></>)}
          </dl>

          {d.balance && d.balance.tracksBalance && (
            <Notice tone={d.balance.available < 0 ? 'danger' : 'info'}>
              <div className="small"><strong>{d.balance.name} balance:</strong> {formatDays(d.balance.available)} available of {formatDays(d.balance.total)}
                {' '}({formatDays(d.balance.used)} used, {formatDays(d.balance.pending)} pending{leave.status === 'Pending' ? ', including this request' : ''}).</div>
            </Notice>
          )}

          {d.conflicts.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Team overlap</h3>
              <p className="small muted" style={{ marginBottom: 8 }}>Colleagues in the same department who are also away during these dates.</p>
              <ul className="list">
                {d.conflicts.map((c, i) => (
                  <li key={i} className="list-item small">
                    <Avatar name={c.employeeName} size="sm" /><span className="strong">{c.employeeName}</span>
                    <span className="muted">{formatRange(c.startDate, c.endDate)}</span><span style={{ marginLeft: 'auto' }}><StatusBadge status={c.status} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 style={{ marginBottom: 12 }}>Approval timeline</h3>
            <ol className="timeline">
              {d.events.map((e, i) => (
                <li key={i} className={`t-${e.kind}`}>
                  <div className="strong small">{e.kind}{e.actor ? ` by ${e.actor}` : ''}</div>
                  <div className="tiny muted">{formatDateTime(e.at)}</div>
                  {e.comment && <div className="small" style={{ marginTop: 4 }}>{e.comment}</div>}
                </li>
              ))}
              {leave.status === 'Pending' && <li><div className="small muted">Waiting for a decision{leave.ageDays > 0 ? ` (${leave.ageDays} day${leave.ageDays === 1 ? '' : 's'})` : ''}</div></li>}
            </ol>
          </div>
        </div>
      )}

      {dialog === 'approve' && leave && (
        <ConfirmDialog
          title="Approve leave" confirmLabel="Approve"
          message={<>Approve <strong>{leave.employeeName}</strong>'s {leave.leaveType} for {formatRange(leave.startDate, leave.endDate)} ({formatDays(leave.days)} day(s))?</>}
          reasonLabel="Comment (optional)"
          onConfirm={async (comment) => { await post(`/leaves/${id}/decision`, { approve: true, comment }); await done('Leave approved.') }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reject' && leave && (
        <ConfirmDialog
          title="Reject leave" confirmLabel="Reject" tone="danger"
          message={<>Reject <strong>{leave.employeeName}</strong>'s request for {formatRange(leave.startDate, leave.endDate)}? They will be notified with your reason.</>}
          reasonLabel="Reason for rejection" reasonRequired
          onConfirm={async (comment) => { await post(`/leaves/${id}/decision`, { approve: false, comment }); await done('Leave rejected.') }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && leave && (
        <ConfirmDialog
          title="Cancel this request?" confirmLabel="Cancel request" tone="danger"
          message={<>Your request for {formatRange(leave.startDate, leave.endDate)} will be cancelled{leave.status === 'Approved' ? ' and the days returned to your balance' : ''}.</>}
          reasonLabel="Comment (optional)"
          onConfirm={async (comment) => { await post(`/leaves/${id}/cancel`, { comment }); await done('Request cancelled.') }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'remove' && leave && (
        <ConfirmDialog
          title="Delete leave record" confirmLabel="Delete record" tone="danger"
          message={<>This removes the record from all views and returns any approved days to the employee's balance. The action is kept in the audit log.</>}
          reasonLabel="Reason for deleting" reasonRequired
          onConfirm={async (reason) => { await post(`/leaves/${id}/remove`, { reason }); toast.success('Leave record deleted.'); refresh(); onClose() }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'edit' && d && <EditLeaveDialog detail={d} onClose={() => setDialog(null)} onSaved={() => done('Leave updated.')} />}
    </Overlay>
  )
}

function EditLeaveDialog({ detail, onClose, onSaved }: { detail: LeaveDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const l = detail.leave
  const types = useLeaveTypes(true)
  const [leaveTypeId, setLeaveTypeId] = useState(String(l.leaveTypeId))
  const [startDate, setStartDate] = useState(l.startDate)
  const [endDate, setEndDate] = useState(l.endDate === l.startDate ? '' : l.endDate)
  const [isHalfDay, setIsHalfDay] = useState(l.isHalfDay)
  const [reason, setReason] = useState(l.reason)
  const [changeReason, setChangeReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  async function save() {
    setTouched(true)
    if (!changeReason.trim() || !reason.trim() || !startDate) return
    setBusy(true)
    setError(null)
    try {
      await put(`/leaves/${l.id}`, { leaveTypeId: Number(leaveTypeId), startDate, endDate: endDate || null, isHalfDay, reason: reason.trim(), changeReason: changeReason.trim() })
      await onSaved()
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  const fe = error instanceof ApiError ? error : null
  return (
    <Overlay title="Edit leave" variant="modal" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="stack">
        <p className="small muted">Editing {l.employeeName}'s leave. Original values are kept in the audit log and the employee is notified.</p>
        <Field label="Leave type" required>
          <select className="select" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
            {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="From" required error={fe?.fieldError('dates')}><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="To (optional)"><input className="input" type="date" value={endDate} min={startDate} onChange={(e) => { setEndDate(e.target.value); if (e.target.value && e.target.value !== startDate) setIsHalfDay(false) }} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={isHalfDay} disabled={!!endDate && endDate !== startDate} onChange={(e) => setIsHalfDay(e.target.checked)} /> Half day</label>
        <Field label="Leave reason" required error={touched && !reason.trim() ? 'Required.' : fe?.fieldError('reason')}><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        <Field label="Why are you changing this?" required error={touched && !changeReason.trim() ? 'A reason for the change is required.' : fe?.fieldError('changeReason')} hint="Shown to the employee and stored in the audit trail.">
          <textarea className="textarea" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} maxLength={1000} />
        </Field>
        {!(fe?.fieldError('dates') || fe?.fieldError('reason') || fe?.fieldError('changeReason')) && <FormError error={error} />}
        <p className="tiny muted">Original: {formatDate(l.startDate)} - {formatDate(l.endDate)}, {formatDays(l.days)} day(s)</p>
      </div>
    </Overlay>
  )
}
