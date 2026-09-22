import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { get, post } from '../../lib/api'
import { timeAgo } from '../../lib/format'
import type { AppNotification, Paged } from '../../lib/types'
import { Button, Card, EmptyState, ErrorState, PageHead, Pagination, SkeletonRows, Tabs } from '../../components/ui'

const PAGE_SIZE = 15
type Tab = 'all' | 'unread'
type Res = Paged<AppNotification> & { unread: number }

export default function NotificationsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['notifications', 'list', tab, page], queryFn: () => get<Res>('/notifications', { unreadOnly: tab === 'unread', page, pageSize: PAGE_SIZE }), placeholderData: (p) => p })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const markAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: invalidate })
  const markOne = useMutation({ mutationFn: (id: number) => post(`/notifications/${id}/read`), onSuccess: invalidate })

  function open(n: AppNotification) {
    if (!n.isRead) markOne.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Notifications" subtitle="Decisions, reminders and updates about your leave."
        actions={<Button onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={!q.data?.unread}><CheckCheck size={16} /> Mark all as read</Button>} />
      <Tabs<Tab> label="Filter notifications" value={tab} onChange={(t) => { setTab(t); setPage(1) }} items={[{ value: 'all', label: 'All' }, { value: 'unread', label: q.data?.unread ? `Unread (${q.data.unread})` : 'Unread' }]} />
      <Card>
        {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <EmptyState title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'} icon={<Bell size={24} />} /> : (
          <ul className="list" style={{ padding: '0 20px' }}>
            {q.data.items.map((n) => (
              <li key={n.id} className="list-item">
                <button onClick={() => open(n)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center' }}>
                  <span className="dot" style={{ background: n.isRead ? 'transparent' : 'var(--brand)', border: n.isRead ? '1px solid var(--border)' : undefined, width: 10, height: 10 }} aria-label={n.isRead ? 'Read' : 'Unread'} role="img" />
                  <span style={{ minWidth: 0 }}>
                    <span className={n.isRead ? 'small' : 'small strong'} style={{ display: 'block' }}>{n.title}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{n.message}</span>
                  </span>
                </button>
                <span className="tiny muted nowrap">{timeAgo(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
      </Card>
    </div>
  )
}
