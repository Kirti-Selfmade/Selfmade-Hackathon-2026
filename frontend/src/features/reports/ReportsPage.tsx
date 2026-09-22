import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { download, get } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { useAuth } from '../../lib/auth'
import { useDepartments, useLeaveTypes } from '../../lib/hooks'
import { formatDays, addDays, todayIso } from '../../lib/format'
import type { LeaveReport } from '../../lib/types'
import { Button, Card, CardHead, Field, PageHead, Pagination } from '../../components/ui'
import LeaveDetailDrawer from '../leaves/LeaveDetailDrawer'
import LeaveTable from '../leaves/LeaveTable'

const PAGE_SIZE = 15

function HBars({ items, label }: { items: { name: string; days: number }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.days))
  if (items.length === 0) return <p className="small muted">No data for these filters.</p>
  return (
    <div role="list" aria-label={label}>
      {items.map((i) => (
        <div key={i.name} className="hbar" role="listitem">
          <span className="name" title={i.name}>{i.name}</span>
          <div className="track"><div className="fill" style={{ width: `${(i.days / max) * 100}%` }} /></div>
          <span className="strong">{formatDays(i.days)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ReportsPage() {
  const { isHr } = useAuth()
  const toast = useToast()
  const [from, setFrom] = useState(addDays(todayIso(), -180))
  const [to, setTo] = useState(addDays(todayIso(), 30))
  const [status, setStatus] = useState('')
  const [typeId, setTypeId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const types = useLeaveTypes(true)
  const depts = useDepartments()

  useEffect(() => { setPage(1) }, [from, to, status, typeId, deptId])
  const filters = { from, to, status, leaveTypeId: typeId, departmentId: deptId }
  const q = useQuery({
    queryKey: ['reports', 'leaves', filters, page],
    queryFn: () => get<LeaveReport>('/reports/leaves', { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })

  async function exportCsv() {
    setExporting(true)
    try { await download('/reports/leaves/export', filters, 'leave-report.csv') } catch { toast.error('Export failed. Please try again.') } finally { setExporting(false) }
  }

  const s = q.data?.summary
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Leave reports" subtitle="Consumption across types, months and people. Rejected and cancelled requests are excluded from day totals."
        actions={<Button onClick={exportCsv} loading={exporting}><Download size={16} /> Export CSV</Button>} />
      <Card pad>
        <div className="filters">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Status"><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Cancelled</option></select></Field>
          <Field label="Leave type"><select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}><option value="">All</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          {isHr && <Field label="Department"><select className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}><option value="">All</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        </div>
      </Card>

      {s && (
        <>
          <div className="grid grid-4">
            <Card className="stat"><div className="label">Applications</div><div className="value">{s.totalApplications}</div></Card>
            <Card className="stat"><div className="label">Days (approved + pending)</div><div className="value">{formatDays(s.totalDays)}</div></Card>
            {s.byStatus.slice(0, 2).map((x) => <Card key={x.status} className="stat"><div className="label">{x.status}</div><div className="value">{x.count}</div></Card>)}
          </div>
          <div className="grid grid-2">
            <Card><CardHead title="By leave type" /><div className="card-body"><HBars label="Days by leave type" items={s.byType} /></div></Card>
            <Card><CardHead title="By department" /><div className="card-body"><HBars label="Days by department" items={s.byDepartment} /></div></Card>
            <Card><CardHead title="By month" /><div className="card-body"><HBars label="Days by month" items={s.byMonth.map((m) => ({ name: m.label, days: m.days }))} /></div></Card>
            <Card><CardHead title="Most leave taken" /><div className="card-body"><HBars label="Top employees" items={s.topEmployees} /></div></Card>
          </div>
        </>
      )}

      <Card>
        <CardHead title="Requests" />
        <LeaveTable rows={q.data?.rows.items} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} onOpen={setOpenId} showEmployee />
        {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.rows.total} onPage={setPage} />}
      </Card>
      {openId !== null && <LeaveDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
