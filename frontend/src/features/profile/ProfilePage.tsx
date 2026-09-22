import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Eye, EyeOff, Lock } from 'lucide-react'
import { ApiError, api, get, put } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { formatDate, roleLabel, tenure } from '../../lib/format'
import type { EmployeeDetail } from '../../lib/types'
import { Avatar, Badge, Button, Card, CardHead, ErrorState, Field, FormError, Notice, PageHead, SkeletonRows } from '../../components/ui'

function KV({ items }: { items: [string, string | null | undefined][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v || <span className="muted">Not provided</span>}</dd></div>))}
    </dl>
  )
}

export function maskAccount(n: string | null | undefined, reveal: boolean) {
  if (!n) return null
  return reveal || n.length <= 4 ? n : '•'.repeat(Math.max(0, n.length - 4)) + n.slice(-4)
}

export default function ProfilePage() {
  const { updateUser } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['employees', 'me'], queryFn: () => get<EmployeeDetail>('/me') })
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [reveal, setReveal] = useState(false)

  const [form, setForm] = useState({ phone: '', localAddress: '', permanentAddress: '', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const d = q.data
  useEffect(() => {
    if (!d) return
    setForm({
      phone: d.phone ?? '', localAddress: d.localAddress ?? '', permanentAddress: d.permanentAddress ?? '',
      emergencyContactName: d.emergencyContactName ?? '', emergencyContactPhone: d.emergencyContactPhone ?? '', emergencyContactRelation: d.emergencyContactRelation ?? '',
    })
  }, [d])

  if (q.isLoading) return <SkeletonRows rows={10} />
  if (q.isError || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== ((d[k] as string | null) ?? ''))
  const fe = error instanceof ApiError ? error : null
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await put<EmployeeDetail>('/me', form)
      qc.setQueryData(['employees', 'me'], updated)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Profile updated.')
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  async function onAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be 2 MB or smaller.'); return }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error('Please choose a PNG, JPG or WEBP image.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api<{ avatarUrl: string }>('/me/avatar', { method: 'POST', form: fd })
      updateUser({ avatarUrl: res.avatarUrl })
      qc.invalidateQueries({ queryKey: ['employees', 'me'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Profile photo updated.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const fullName = `${d.firstName} ${d.lastName}`

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead title="My profile" subtitle="Your employment record and contact details." />

      <Card pad>
        <div className="row row-wrap" style={{ gap: 24 }}>
          <div style={{ position: 'relative' }}>
            <Avatar name={fullName} url={d.avatarUrl} size="xl" />
            <button className="icon-btn" aria-label="Change profile photo" disabled={uploading} onClick={() => fileRef.current?.click()}
              style={{ position: 'absolute', right: -4, bottom: -4, background: 'var(--brand)', color: 'var(--brand-ink)', width: 36, height: 36, borderRadius: '50%' }}>
              {uploading ? <span className="spinner" /> : <Camera size={18} />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onAvatar} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ fontSize: 26 }}>{fullName}</h1>
            <p className="muted">{[d.designation, d.department].filter(Boolean).join(' - ')}</p>
            <div className="pill-row" style={{ marginTop: 10 }}>
              <Badge tone="brand">{roleLabel(d.role)}</Badge>
              <Badge>{d.employeeCode}</Badge>
              <Badge>{d.employmentType.replace(/([A-Z])/g, ' $1').trim()}</Badge>
              <Badge tone="info">With SelfMade {tenure(d.joinDate)}</Badge>
            </div>
          </div>
          <div style={{ minWidth: 200 }}>
            <div className="row between small"><span className="muted">Profile completeness</span><strong>{d.profileCompleteness}%</strong></div>
            <div className="progress" style={{ marginTop: 8 }}><span style={{ width: `${d.profileCompleteness}%`, background: 'var(--brand)' }} /></div>
          </div>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Employment" subtitle="Managed by HR" action={<Lock size={16} className="muted" aria-label="Read only" />} />
          <div className="card-body">
            <KV items={[
              ['Employee ID', d.employeeCode], ['Designation', d.designation], ['Department', d.department], ['Reports to', d.manager],
              ['Location', d.location], ['Joined', formatDate(d.joinDate)], ['Work email', d.email],
            ]} />
          </div>
        </Card>

        <Card>
          <CardHead title="Personal details" subtitle="Managed by HR" action={<Lock size={16} className="muted" aria-label="Read only" />} />
          <div className="card-body">
            <KV items={[
              ['Full name', fullName], ["Father's name", d.fatherName], ['Date of birth', d.dateOfBirth ? formatDate(d.dateOfBirth) : null], ['Gender', d.gender],
            ]} />
            <p className="tiny muted" style={{ marginTop: 14 }}>To correct a protected field, please contact HR.</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Contact & emergency details" subtitle="You can update these yourself" />
        <div className="card-body stack">
          <div className="form-grid">
            <Field label="Phone" error={fe?.fieldError('phone')}><input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} maxLength={30} /></Field>
            <div />
            <Field label="Current address" error={fe?.fieldError('localAddress')} className="full"><textarea className="textarea" value={form.localAddress} onChange={set('localAddress')} maxLength={300} style={{ minHeight: 70 }} /></Field>
            <Field label="Permanent address" error={fe?.fieldError('permanentAddress')} className="full"><textarea className="textarea" value={form.permanentAddress} onChange={set('permanentAddress')} maxLength={300} style={{ minHeight: 70 }} /></Field>
            <div className="form-section full">Emergency contact</div>
            <Field label="Name" error={fe?.fieldError('emergencyContactName')}><input className="input" value={form.emergencyContactName} onChange={set('emergencyContactName')} maxLength={100} /></Field>
            <Field label="Relationship" error={fe?.fieldError('emergencyContactRelation')}><input className="input" value={form.emergencyContactRelation} onChange={set('emergencyContactRelation')} maxLength={50} /></Field>
            <Field label="Phone" error={fe?.fieldError('emergencyContactPhone')}><input className="input" type="tel" value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} maxLength={30} /></Field>
          </div>
          <FormError error={fe && Object.keys(fe.errors).length === 0 ? error : null} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save changes</Button>
          </div>
        </div>
      </Card>

      {d.sensitiveVisible && (
        <Card>
          <CardHead title="Bank & tax details" subtitle="Only you and HR can see this" action={
            <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />} {reveal ? 'Hide' : 'Reveal'}</Button>
          } />
          <div className="card-body">
            <KV items={[
              ['Account holder', d.bankAccountHolder], ['Bank', d.bankName], ['Account number', maskAccount(d.bankAccountNumber, reveal)],
              ['IFSC', d.bankIfsc], ['Tax ID', reveal ? d.taxId : d.taxId ? '•••••' + d.taxId.slice(-3) : null],
            ]} />
            <div style={{ marginTop: 14 }}><Notice tone="info"><div className="small">Bank and tax details are maintained by HR. Ask HR if something needs correcting.</div></Notice></div>
          </div>
        </Card>
      )}
    </div>
  )
}
