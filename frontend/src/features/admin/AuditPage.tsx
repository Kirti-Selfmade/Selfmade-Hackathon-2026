import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { get } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useDebounced } from '../../lib/hooks'
import type { AuditItem, Paged } from '../../lib/types'
import { Button, Card, EmptyState, ErrorState, Field, Overlay, PageHead, Pagination, SkeletonRows } from '../../components/ui'

const PAGE_SIZE = 20

function pretty(json: string | null) {
  if (!json) return '(none)'
  try { return JSON.stringify(JSON.parse(json), null, 2) } catch { return json }
}

export default function AuditPage() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<AuditItem | null>(null)
  const dAction = useDebounced(action)
  useEffect(() => { setPage(1) }, [dAction, entityType, from, to])

  const q = useQuery({
    queryKey: ['audit', dAction, entityType, from, to, page],
    queryFn: () => get<Paged<AuditItem>>('/audit', { action: dAction, entityType, from, to, page, pageSize: PAGE_SIZE }),
    placeholderData: (p) => p,
  })

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Audit log" subtitle="Who changed what, and when. Visible to super admins only." />
      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <Field label="Action contains" className="grow"><input className="input" placeholder="e.g. leave.approve" value={action} onChange={(e) => setAction(e.target.value)} /></Field>
            <Field label="Entity"><select className="select" value={entityType} onChange={(e) => setEntityType(e.target.value)}><option value="">All</option><option>Employee</option><option>LeaveApplication</option><option>Department</option><option>LeaveType</option><option>Holiday</option><option>Announcement</option><option>LeaveReport</option></select></Field>
            <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
        {q.isLoading ? <SkeletonRows rows={8} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <EmptyState title="No audit events" icon={<ShieldCheck size={24} />} text="Nothing matches these filters." /> : (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">IP</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{q.data.items.map((a) => (
              <tr key={a.id}>
                <td data-label="When" className="nowrap">{formatDateTime(a.at)}</td><td data-label="Actor">{a.actor ?? 'System'}</td>
                <td data-label="Action"><code>{a.action}</code></td><td data-label="Entity">{a.entityType}{a.entityId ? ` #${a.entityId}` : ''}</td>
                <td data-label="IP">{a.ipAddress ?? '-'}</td>
                <td>{(a.beforeJson || a.afterJson) && <Button size="sm" onClick={() => setOpen(a)}>Details</Button>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
      </Card>
      {open && (
        <Overlay title={open.action} onClose={() => setOpen(null)} wide>
          <div className="stack">
            <div><div className="strong small">Before</div><pre className="code-block" style={{ overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8, fontSize: 12.5 }}>{pretty(open.beforeJson)}</pre></div>
            <div><div className="strong small">After</div><pre className="code-block" style={{ overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8, fontSize: 12.5 }}>{pretty(open.afterJson)}</pre></div>
          </div>
        </Overlay>
      )}
    </div>
  )
}
