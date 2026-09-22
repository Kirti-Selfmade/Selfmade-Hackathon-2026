import { useEffect, useState, type ChangeEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { ApiError, get, post, put } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useDebounced, useDepartments, useRefreshData } from '../../lib/hooks'
import { formatDate, roleLabel, todayIso } from '../../lib/format'
import type { EmployeeDetail, EmployeeListItem, Paged } from '../../lib/types'
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormError, Overlay, PageHead, Pagination, SkeletonRows } from '../../components/ui'

const PAGE_SIZE = 12
const TYPES = ['FullTime', 'PartTime', 'Contract', 'Intern']
const ROLES = ['Employee', 'Manager', 'HrAdmin', 'SuperAdmin']

type Form = Record<string, string>
const EMPTY: Form = {
  employeeCode: '', firstName: '', lastName: '', email: '', role: 'Employee', departmentId: '', managerId: '', designation: '',
  employmentType: 'FullTime', location: '', joinDate: '', dateOfBirth: '', gender: '', phone: '', localAddress: '', permanentAddress: '', fatherName: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '', bankAccountHolder: '', bankName: '', bankAccountNumber: '', bankIfsc: '', taxId: '',
}

function fromDetail(d: EmployeeDetail): Form {
  const f: Form = { ...EMPTY }
  for (const k of Object.keys(EMPTY)) {
    const v = (d as unknown as Record<string, unknown>)[k]
    f[k] = v == null ? '' : String(v)
  }
  return f
}

export default function ManagePeoplePage() {
  const { isHr } = useAuth()
  const [search, setSearch] = useState('')
  const [deptId, setDeptId] = useState('')
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [disabling, setDisabling] = useState<EmployeeListItem | null>(null)
  const [enabling, setEnabling] = useState<EmployeeListItem | null>(null)
  const [cancelling, setCancelling] = useState<EmployeeListItem | null>(null)
  const refresh = useRefreshData()
  const toast = useToast()
  const debounced = useDebounced(search)
  const depts = useDepartments()

  useEffect(() => { setPage(1) }, [debounced, deptId, status])

  const q = useQuery({
    queryKey: ['employees', 'list', debounced, deptId, status, page],
    queryFn: () => get<Paged<EmployeeListItem>>('/employees', { search: debounced, departmentId: deptId, status, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Manage people"
        subtitle={isHr ? 'Create, update and deactivate employee records.' : 'People in your reporting line.'}
        actions={isHr ? <Button variant="primary" onClick={() => setEditing('new')}><UserPlus size={18} /> Add employee</Button> : undefined}
      />
      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <Field label="Search" className="grow"><input className="input" type="search" placeholder="Name, email or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            <Field label="Department">
              <select className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                <option value="">All</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option><option value="disabled">Disabled</option><option value="">All</option>
              </select>
            </Field>
          </div>
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
          !q.data || q.data.items.length === 0 ? <EmptyState title="No employees found" text="Try changing the filters." /> : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th scope="col">Employee</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Manager</th><th scope="col">Joined</th><th scope="col">Status</th>{isHr && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {q.data.items.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Employee"><div className="cell-person"><Avatar name={e.name} url={e.avatarUrl} size="sm" /><div><div className="name">{e.name}</div><div className="tiny muted">{e.employeeCode} - {e.email}</div></div></div></td>
                      <td data-label="Role">{roleLabel(e.role)}</td>
                      <td data-label="Department">{e.department ?? '-'}</td>
                      <td data-label="Manager">{e.manager ?? '-'}</td>
                      <td data-label="Joined" className="nowrap">{formatDate(e.joinDate)}</td>
                      <td data-label="Status">
                        <div className="stack" style={{ gap: 4 }}>
                          {e.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}
                          {e.scheduledDisableDate && <Badge tone="warning">Disabling {formatDate(e.scheduledDisableDate, false)}</Badge>}
                        </div>
                      </td>
                      {isHr && (
                        <td className="nowrap">
                          <div className="row gap-sm">
                            <Button size="sm" onClick={() => setEditing(e.id)}>Edit</Button>
                            {e.isActive ? (
                              <Button size="sm" variant="danger-ghost" onClick={() => setDisabling(e)}>{e.scheduledDisableDate ? 'Reschedule' : 'Disable'}</Button>
                            ) : (
                              <Button size="sm" onClick={() => setEnabling(e)}>Enable</Button>
                            )}
                            {e.scheduledDisableDate && <Button size="sm" onClick={() => setCancelling(e)}>Cancel</Button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
      </Card>

      {editing !== null && isHr && <EmployeeDrawer id={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); toast.success('Employee saved.') }} />}
      {disabling && (
        <DisableDialog
          employee={disabling}
          onClose={() => setDisabling(null)}
          onDone={(scheduled) => { refresh(); toast.success(scheduled ? 'Disable scheduled.' : 'Employee disabled.') }}
        />
      )}
      {enabling && (
        <ConfirmDialog
          title={`Enable ${enabling.name}?`}
          message="They will be able to sign in again."
          confirmLabel="Enable"
          onClose={() => setEnabling(null)}
          onConfirm={async () => {
            await post(`/employees/${enabling.id}/enable`)
            refresh()
            toast.success('Employee enabled.')
          }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel scheduled disable?"
          message={<>{cancelling.name} will stay active and will <strong>not</strong> be disabled on {formatDate(cancelling.scheduledDisableDate, false)}.</>}
          confirmLabel="Cancel the disable"
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await post(`/employees/${cancelling.id}/cancel-disable`)
            refresh()
            toast.success('Scheduled disable cancelled.')
          }}
        />
      )}
    </div>
  )
}

function DisableDialog({ employee, onClose, onDone }: { employee: EmployeeListItem; onClose: () => void; onDone: (scheduled: boolean) => void }) {
  const [reason, setReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)
  const fe = error instanceof ApiError ? error : null
  const scheduled = effectiveDate !== '' && effectiveDate > todayIso()

  async function submit() {
    setTouched(true)
    if (!reason.trim()) return
    setBusy(true)
    setError(null)
    try {
      await post(`/employees/${employee.id}/disable`, { reason: reason.trim(), effectiveDate: effectiveDate || null })
      onDone(scheduled)
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Overlay
      title={`Disable ${employee.name}?`}
      variant="modal"
      onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>{scheduled ? 'Schedule disable' : 'Disable now'}</Button></>}
    >
      <div className="stack">
        <p className="small muted">{scheduled ? 'Their account stays active until the effective date, then they are signed out and unable to log in.' : 'Leave the effective date empty to sign them out and disable access immediately.'}</p>
        <Field label="Reason" required error={fe?.fieldError('reason') ?? (touched && !reason.trim() ? 'This is required.' : undefined)}>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Effective date (optional)" hint="Leave blank to disable immediately." error={fe?.fieldError('effectiveDate')}>
          <input className="input" type="date" min={todayIso()} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <FormError error={fe && Object.keys(fe.errors).length === 0 ? error : null} />
      </div>
    </Overlay>
  )
}

function EmployeeDrawer({ id, onClose, onSaved }: { id: number | 'new'; onClose: () => void; onSaved: () => void }) {
  const isNew = id === 'new'
  const depts = useDepartments()
  const people = useQuery({ queryKey: ['employees', 'lookup'], queryFn: () => get<{ id: number; name: string; designation: string | null }[]>('/employees/lookup') })
  const existing = useQuery({ queryKey: ['employees', 'detail', id], queryFn: () => get<EmployeeDetail>(`/employees/${id}`), enabled: !isNew })
  const [form, setForm] = useState<Form>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => { if (existing.data) setForm(fromDetail(existing.data)) }, [existing.data])

  const fe = error instanceof ApiError ? error : null
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k: string) => fe?.fieldError(k)

  async function save() {
    setBusy(true)
    setError(null)
    const n = (v: string) => (v.trim() === '' ? null : v.trim())
    const body = {
      ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, n(v)])),
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      managerId: form.managerId ? Number(form.managerId) : null,
    }
    try {
      if (isNew) await post('/employees', body)
      else await put(`/employees/${id}`, body)
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Overlay
      title={isNew ? 'Add employee' : 'Edit employee'}
      onClose={onClose}
      wide
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!isNew && !existing.data}>Save</Button></>}
    >
      {!isNew && existing.isLoading ? <SkeletonRows rows={8} /> : !isNew && existing.isError ? <ErrorState error={existing.error} onRetry={() => existing.refetch()} /> : (
        <div className="form-grid">
          <div className="form-section full">Employment</div>
          <Field label="Employee ID" required error={err('employeeCode')}><input className="input" value={form.employeeCode} onChange={set('employeeCode')} maxLength={30} /></Field>
          <Field label="Work email" required error={err('email')}><input className="input" type="email" value={form.email} onChange={set('email')} maxLength={200} /></Field>
          <Field label="First name" required error={err('firstName')}><input className="input" value={form.firstName} onChange={set('firstName')} maxLength={80} /></Field>
          <Field label="Last name" required error={err('lastName')}><input className="input" value={form.lastName} onChange={set('lastName')} maxLength={80} /></Field>
          <Field label="Role" required error={err('role')}><select className="select" value={form.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></Field>
          <Field label="Employment type" error={err('employmentType')}><select className="select" value={form.employmentType} onChange={set('employmentType')}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/([A-Z])/g, ' $1').trim()}</option>)}</select></Field>
          <Field label="Department" error={err('departmentId')}><select className="select" value={form.departmentId} onChange={set('departmentId')}><option value="">None</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Reports to" error={err('managerId')}><select className="select" value={form.managerId} onChange={set('managerId')}><option value="">None</option>{people.data?.filter((p) => p.id !== id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Designation" error={err('designation')}><input className="input" value={form.designation} onChange={set('designation')} maxLength={100} /></Field>
          <Field label="Location" error={err('location')}><input className="input" value={form.location} onChange={set('location')} maxLength={100} /></Field>
          <Field label="Join date" required error={err('joinDate')}><input className="input" type="date" value={form.joinDate} onChange={set('joinDate')} /></Field>
          <div />
          <div className="form-section full">Personal</div>
          <Field label="Date of birth" error={err('dateOfBirth')}><input className="input" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></Field>
          <Field label="Gender" error={err('gender')}><input className="input" value={form.gender} onChange={set('gender')} maxLength={30} /></Field>
          <Field label="Father's name" error={err('fatherName')}><input className="input" value={form.fatherName} onChange={set('fatherName')} maxLength={100} /></Field>
          <Field label="Phone" error={err('phone')}><input className="input" type="tel" value={form.phone} onChange={set('phone')} maxLength={30} /></Field>
          <Field label="Current address" className="full" error={err('localAddress')}><textarea className="textarea" style={{ minHeight: 60 }} value={form.localAddress} onChange={set('localAddress')} maxLength={300} /></Field>
          <Field label="Permanent address" className="full" error={err('permanentAddress')}><textarea className="textarea" style={{ minHeight: 60 }} value={form.permanentAddress} onChange={set('permanentAddress')} maxLength={300} /></Field>
          <div className="form-section full">Emergency contact</div>
          <Field label="Name"><input className="input" value={form.emergencyContactName} onChange={set('emergencyContactName')} maxLength={100} /></Field>
          <Field label="Relationship"><input className="input" value={form.emergencyContactRelation} onChange={set('emergencyContactRelation')} maxLength={50} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} maxLength={30} /></Field>
          <div />
          <div className="form-section full">Bank & tax (sensitive)</div>
          <Field label="Account holder"><input className="input" value={form.bankAccountHolder} onChange={set('bankAccountHolder')} maxLength={100} /></Field>
          <Field label="Bank"><input className="input" value={form.bankName} onChange={set('bankName')} maxLength={100} /></Field>
          <Field label="Account number"><input className="input" autoComplete="off" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} maxLength={40} /></Field>
          <Field label="IFSC"><input className="input" value={form.bankIfsc} onChange={set('bankIfsc')} maxLength={20} /></Field>
          <Field label="Tax ID"><input className="input" autoComplete="off" value={form.taxId} onChange={set('taxId')} maxLength={30} /></Field>
          <div className="full"><FormError error={fe && Object.keys(fe.errors).length === 0 ? error : null} /></div>
        </div>
      )}
    </Overlay>
  )
}
