import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useDebounced, useDepartments, useLeaveTypes } from '../../lib/hooks'
import type { LeaveRow, Paged } from '../../lib/types'
import { Card, Field, PageHead, Pagination, Tabs } from '../../components/ui'
import LeaveDetailDrawer from '../leaves/LeaveDetailDrawer'
import LeaveTable from '../leaves/LeaveTable'

const PAGE_SIZE = 12
type Tab = 'Pending' | 'all'

export default function ApprovalsPage() {
  const { isHr } = useAuth()
  const [tab, setTab] = useState<Tab>('Pending')
  const [status, setStatus] = useState('')
  const [typeId, setTypeId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const debouncedSearch = useDebounced(search)
  const types = useLeaveTypes(true)
  const depts = useDepartments()

  useEffect(() => { setPage(1) }, [tab, status, typeId, deptId, from, to, debouncedSearch])

  const effectiveStatus = tab === 'Pending' ? 'Pending' : status
  const list = useQuery({
    queryKey: ['approvals', 'list', { effectiveStatus, typeId, deptId, from, to, search: debouncedSearch, page }],
    queryFn: () => get<Paged<LeaveRow>>('/leaves', { status: effectiveStatus, leaveTypeId: typeId, departmentId: deptId, from, to, search: debouncedSearch, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Approvals" subtitle={isHr ? 'Review leave requests across the organization.' : 'Review leave requests from your team.'} />
      <Tabs<Tab> label="Approvals view" value={tab} onChange={setTab} items={[{ value: 'Pending', label: 'Needs your decision' }, { value: 'all', label: 'All requests' }]} />
      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <Field label="Search" className="grow"><input className="input" type="search" placeholder="Employee name or reason" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            {tab === 'all' && (
              <Field label="Status">
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Cancelled</option>
                </select>
              </Field>
            )}
            <Field label="Leave type">
              <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">All</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {isHr && (
              <Field label="Department">
                <select className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                  <option value="">All</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
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
          showEmployee
          emptyText={tab === 'Pending' ? 'You are all caught up - no requests are waiting for a decision.' : 'No requests match these filters.'}
        />
        {list.data && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
      </Card>
      {openId !== null && <LeaveDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
