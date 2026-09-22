import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Megaphone, Pin } from 'lucide-react'
import { get } from '../../lib/api'
import { formatDate } from '../../lib/format'
import type { Announcement, Paged } from '../../lib/types'
import { Badge, Card, EmptyState, ErrorState, PageHead, Pagination, SkeletonRows } from '../../components/ui'

const PAGE_SIZE = 8

export default function AnnouncementsPage() {
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['announcements', 'list', page], queryFn: () => get<Paged<Announcement>>('/announcements', { page, pageSize: PAGE_SIZE }), placeholderData: (p) => p })
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Announcements" subtitle="News and updates from the company." />
      {q.isLoading ? <SkeletonRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <Card><EmptyState title="No announcements" icon={<Megaphone size={24} />} /></Card> : (
        <>
          {q.data.items.map((a) => (
            <Card key={a.id} pad>
              <div className="row gap-sm row-wrap"><h2>{a.title}</h2>{a.isPinned && <Badge tone="brand"><Pin size={12} /> Pinned</Badge>}</div>
              <div className="tiny muted" style={{ margin: '4px 0 10px' }}>{formatDate(a.publishedAt)}{a.createdBy ? ` - ${a.createdBy}` : ''}</div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
            </Card>
          ))}
          <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
