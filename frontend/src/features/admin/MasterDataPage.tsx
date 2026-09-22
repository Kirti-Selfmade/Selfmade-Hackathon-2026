import { useState, type ChangeEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { ApiError, del, get, post, put } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { useDepartments, useLeaveTypes } from '../../lib/hooks'
import { formatDate } from '../../lib/format'
import type { Department, Holiday, LeaveType } from '../../lib/types'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormError, Overlay, PageHead, SkeletonRows, Tabs } from '../../components/ui'

type Tab = 'departments' | 'leave-types' | 'holidays'

export default function MasterDataPage() {
  const [tab, setTab] = useState<Tab>('departments')
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Master data" subtitle="Departments, leave types and the holiday calendar." />
      <Tabs<Tab> label="Master data" value={tab} onChange={setTab} items={[{ value: 'departments', label: 'Departments' }, { value: 'leave-types', label: 'Leave types' }, { value: 'holidays', label: 'Holidays & office-off' }]} />
      {tab === 'departments' && <Departments />}
      {tab === 'leave-types' && <LeaveTypes />}
      {tab === 'holidays' && <Holidays />}
    </div>
  )
}

/** Shared modal wrapper for a small create/edit form. */
function FormDialog({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit: () => Promise<void>; children: (fe: ApiError | null) => ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError ? error : null
  async function submit() {
    setBusy(true); setError(null)
    try { await onSubmit(); onClose() } catch (e) { setError(e); setBusy(false) }
  }
  return (
    <Overlay title={title} variant="modal" onClose={onClose} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="stack">
        {children(fe)}
        <FormError error={fe && Object.keys(fe.errors).length === 0 ? error : null} />
      </div>
    </Overlay>
  )
}

function Departments() {
  const q = useDepartments(true)
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<Department | 'new' | null>(null)
  const [archive, setArchive] = useState<Department | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const reload = () => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['employees'] }) }
  const open = (d: Department | 'new') => { setEdit(d); setName(d === 'new' ? '' : d.name); setDesc(d === 'new' ? '' : d.description ?? '') }

  return (
    <Card>
      <div className="card-body row between"><span className="small muted">Archived departments stay on history but cannot be assigned to new employees.</span><Button variant="primary" onClick={() => open('new')}><Plus size={16} /> Add department</Button></div>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? <EmptyState title="No departments yet" /> : (
        <div className="table-wrap"><table className="table responsive">
          <thead><tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Employees</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.map((d) => (
            <tr key={d.id}>
              <td data-label="Name" className="strong">{d.name}</td><td data-label="Description">{d.description ?? '-'}</td><td data-label="Employees">{d.employeeCount}</td>
              <td data-label="Status">{d.isActive ? <Badge tone="success">Active</Badge> : <Badge>Archived</Badge>}</td>
              <td><div className="row gap-sm"><Button size="sm" onClick={() => open(d)}>Edit</Button>
                {d.isActive ? <Button size="sm" variant="danger-ghost" onClick={() => setArchive(d)}>Archive</Button>
                  : <Button size="sm" onClick={async () => { await put(`/departments/${d.id}`, { name: d.name, description: d.description, isActive: true }); reload() }}>Restore</Button>}</div></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormDialog title={edit === 'new' ? 'Add department' : 'Edit department'} onClose={() => setEdit(null)} onSubmit={async () => {
          if (edit === 'new') await post('/departments', { name, description: desc || null })
          else await put(`/departments/${edit.id}`, { name, description: desc || null, isActive: edit.isActive })
          reload(); toast.success('Department saved.')
        }}>
          {(fe) => (<>
            <Field label="Name" required error={fe?.fieldError('name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
            <Field label="Description" error={fe?.fieldError('description')}><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
          </>)}
        </FormDialog>
      )}
      {archive && <ConfirmDialog title={`Archive ${archive.name}?`} message="It will no longer be selectable. Existing employees keep their history." confirmLabel="Archive" tone="danger" onClose={() => setArchive(null)}
        onConfirm={async () => { await del(`/departments/${archive.id}`); reload(); toast.success('Department archived.') }} />}
    </Card>
  )
}

function LeaveTypes() {
  const q = useLeaveTypes(true)
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<LeaveType | 'new' | null>(null)
  const blank = { name: '', code: '', color: '#0f766e', defaultAnnualDays: '12', tracksBalance: true, allowHalfDay: true, isPaid: true, isActive: true }
  const [f, setF] = useState(blank)
  const reload = () => { qc.invalidateQueries({ queryKey: ['leave-types'] }); qc.invalidateQueries({ queryKey: ['leaves'] }) }
  const open = (t: LeaveType | 'new') => { setEdit(t); setF(t === 'new' ? blank : { ...t, defaultAnnualDays: String(t.defaultAnnualDays) }) }
  const text = (k: 'name' | 'code' | 'color' | 'defaultAnnualDays') => (e: ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const flag = (k: 'tracksBalance' | 'allowHalfDay' | 'isPaid' | 'isActive') => (e: ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.checked }))

  return (
    <Card>
      <div className="card-body row between"><span className="small muted">Changing default days affects balances created from now on, not existing ones.</span><Button variant="primary" onClick={() => open('new')}><Plus size={16} /> Add leave type</Button></div>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="table-wrap"><table className="table responsive">
          <thead><tr><th scope="col">Type</th><th scope="col">Code</th><th scope="col">Days / year</th><th scope="col">Rules</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data?.map((t) => (
            <tr key={t.id}>
              <td data-label="Type"><span className="row gap-sm strong"><span className="dot" style={{ background: t.color }} />{t.name}</span></td>
              <td data-label="Code">{t.code}</td>
              <td data-label="Days / year">{t.tracksBalance ? t.defaultAnnualDays : 'Unlimited'}</td>
              <td data-label="Rules"><div className="pill-row">{t.isPaid ? <Badge tone="info">Paid</Badge> : <Badge>Unpaid</Badge>}{t.allowHalfDay && <Badge>Half day</Badge>}</div></td>
              <td data-label="Status">{t.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
              <td><Button size="sm" onClick={() => open(t)}>Edit</Button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormDialog title={edit === 'new' ? 'Add leave type' : 'Edit leave type'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body = { ...f, defaultAnnualDays: Number(f.defaultAnnualDays) || 0 }
          if (edit === 'new') await post('/leave-types', body); else await put(`/leave-types/${edit.id}`, body)
          reload(); toast.success('Leave type saved.')
        }}>
          {(fe) => (<>
            <div className="form-grid">
              <Field label="Name" required error={fe?.fieldError('name')}><input className="input" value={f.name} onChange={text('name')} maxLength={60} /></Field>
              <Field label="Code" required error={fe?.fieldError('code')}><input className="input" value={f.code} onChange={text('code')} maxLength={10} /></Field>
              <Field label="Days per year" error={fe?.fieldError('defaultAnnualDays')}><input className="input" type="number" min={0} step={0.5} value={f.defaultAnnualDays} onChange={text('defaultAnnualDays')} disabled={!f.tracksBalance} /></Field>
              <Field label="Colour" error={fe?.fieldError('color')}><input className="input" type="color" value={f.color} onChange={text('color')} style={{ padding: 4, height: 42 }} /></Field>
            </div>
            <label className="row gap-sm"><input type="checkbox" checked={f.tracksBalance} onChange={flag('tracksBalance')} /> Track a yearly balance</label>
            <label className="row gap-sm"><input type="checkbox" checked={f.allowHalfDay} onChange={flag('allowHalfDay')} /> Allow half days</label>
            <label className="row gap-sm"><input type="checkbox" checked={f.isPaid} onChange={flag('isPaid')} /> Paid leave</label>
            <label className="row gap-sm"><input type="checkbox" checked={f.isActive} onChange={flag('isActive')} /> Available for new requests</label>
          </>)}
        </FormDialog>
      )}
    </Card>
  )
}

function Holidays() {
  const toast = useToast()
  const qc = useQueryClient()
  const [year, setYear] = useState(new Date().getFullYear())
  const q = useQuery({ queryKey: ['holidays', year], queryFn: () => get<Holiday[]>('/holidays', { year }) })
  const [edit, setEdit] = useState<Holiday | 'new' | null>(null)
  const [remove, setRemove] = useState<Holiday | null>(null)
  const [f, setF] = useState({ name: '', date: '', kind: 'Holiday' })
  const reload = () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['calendar'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  const open = (h: Holiday | 'new') => { setEdit(h); setF(h === 'new' ? { name: '', date: '', kind: 'Holiday' } : { name: h.name, date: h.date, kind: h.kind }) }

  return (
    <Card>
      <div className="card-body row between row-wrap">
        <div className="row gap-sm">
          <Button size="sm" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>&lt;</Button>
          <span className="strong" aria-live="polite">{year}</span>
          <Button size="sm" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>&gt;</Button>
        </div>
        <Button variant="primary" onClick={() => open('new')}><Plus size={16} /> Add date</Button>
      </div>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? <EmptyState title={`No dates for ${year}`} text="Holidays and office-off days are excluded from leave day counts." /> : (
        <div className="table-wrap"><table className="table responsive">
          <thead><tr><th scope="col">Date</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.map((h) => (
            <tr key={h.id}>
              <td data-label="Date" className="nowrap">{formatDate(h.date)}</td><td data-label="Name" className="strong">{h.name}</td>
              <td data-label="Kind">{h.kind === 'Holiday' ? <Badge tone="warning">Holiday</Badge> : <Badge>Office off</Badge>}</td>
              <td><div className="row gap-sm"><Button size="sm" onClick={() => open(h)}>Edit</Button><Button size="sm" variant="danger-ghost" onClick={() => setRemove(h)}>Delete</Button></div></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormDialog title={edit === 'new' ? 'Add date' : 'Edit date'} onClose={() => setEdit(null)} onSubmit={async () => {
          if (edit === 'new') await post('/holidays', f); else await put(`/holidays/${edit.id}`, f)
          reload(); toast.success('Calendar updated.')
        }}>
          {(fe) => (<>
            <Field label="Name" required error={fe?.fieldError('name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} /></Field>
            <Field label="Date" required error={fe?.fieldError('date')}><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Kind" error={fe?.fieldError('kind')}><select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="Holiday">Public holiday</option><option value="OfficeOff">Office off</option></select></Field>
          </>)}
        </FormDialog>
      )}
      {remove && <ConfirmDialog title={`Delete ${remove.name}?`} message="Existing approved leave is not recalculated automatically." confirmLabel="Delete" tone="danger" onClose={() => setRemove(null)}
        onConfirm={async () => { await del(`/holidays/${remove.id}`); reload(); toast.success('Date deleted.') }} />}
    </Card>
  )
}
