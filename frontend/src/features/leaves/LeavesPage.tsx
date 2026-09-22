import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { get } from '../../lib/api'
import { formatDays } from '../../lib/format'
import { useDebounced, useLeaveTypes } from '../../lib/hooks'
import type { Balance, LeaveRow, Paged } from '../../lib/types'
import { BalanceBar, Button, Card, Field, PageHead, Pagination, Skeleton } from '../../components/ui'
import ApplyLeaveDrawer from './ApplyLeaveDrawer'
import LeaveDetailDrawer from './LeaveDetailDrawer'
import LeaveTable from './LeaveTable'

const PAGE_SIZE = 10

export default function LeavesPage() {
  const [params, setParams] = useSearchParams()
  const [applying, setApplying] = useState(params.get('apply') === '1')
  const [openId, setOpenId] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [typeId, setTypeId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounced(search)
  const types = useLeaveTypes(true)

  // Deep link from the dashboard ("?apply=1") opens the form once, then cleans the URL.
  useEffect(() => {
    if (params.get('apply') === '1') { setParams({}, { replace: true }) }
  }, [params, setParams])

  useEffect(() => { setPage(1) }, [status, typeId, from, to, debouncedSearch])

  const balances = useQuery({ queryKey: ['leaves', 'balances'], queryFn: () => get<Balance[]>('/leaves/balances') })
  const list = useQuery({
    queryKey: ['leaves', 'mine', { status, typeId, from, to, search: debouncedSearch, page }],
    queryFn: () => get<Paged<LeaveRow>>('/leaves/mine', { status, leaveTypeId: typeId, from, to, search: debouncedSearch, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead
        title="My leaves"
        subtitle="Balances, applications and their approval status."
        actions={<Button variant="primary" onClick={() => setApplying(true)}><CalendarPlus size={18} /> Apply for leave</Button>}
      />

      <div className="grid grid-4">
        {balances.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} />)}
        {balances.data?.map((b) => (
          <Card key={b.leaveTypeId} className="balance-card">
            <div className="top"><span className="row gap-sm strong"><span className="dot" style={{ background: b.color }} />{b.name}</span></div>
            {b.tracksBalance ? (
              <>
                <div className="avail">{formatDays(b.available)}<span className="small muted"> of {formatDays(b.total)} left</span></div>
                <BalanceBar used={b.used} pending={b.pending} total={b.total} color={b.color} />
                <div className="tiny muted">{formatDays(b.used)} used{b.pending > 0 ? ` - ${formatDays(b.pending)} pending` : ''}</div>
              </>
            ) : (
              <><div className="avail">{formatDays(b.used)}<span className="small muted"> taken</span></div><div className="tiny muted">No balance limit</div></>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <Field label="Search" className="grow"><input className="input" type="search" placeholder="Search reason" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            <Field label="Status">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Cancelled</option>
              </select>
            </Field>
            <Field label="Leave type">
              <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">All</option>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
        <LeaveTable
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          onOpen={setOpenId}
          emptyText={status || typeId || from || to || debouncedSearch ? 'No requests match these filters.' : 'You have not applied for any leave yet.'}
          emptyAction={!status && !typeId && !from && !to && !debouncedSearch ? <Button variant="primary" onClick={() => setApplying(true)}>Apply for leave</Button> : undefined}
        />
        {list.data && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>

      {applying && <ApplyLeaveDrawer onClose={() => setApplying(false)} />}
      {openId !== null && <LeaveDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
