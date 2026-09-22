import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Mail, MapPin, Phone, Users } from 'lucide-react'
import { get } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import type { DirectoryItem, Paged } from '../../lib/types'
import { Avatar, Card, EmptyState, ErrorState, Field, PageHead, Pagination, SkeletonRows } from '../../components/ui'

const PAGE_SIZE = 12

export default function DirectoryPage() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search)

  useEffect(() => { setPage(1) }, [debounced])
  useEffect(() => {
    const next: Record<string, string> = debounced ? { q: debounced } : {}
    setParams(next, { replace: true })
  }, [debounced, setParams])

  const q = useQuery({
    queryKey: ['employees', 'directory', debounced, page],
    queryFn: () => get<Paged<DirectoryItem>>('/directory', { search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="People" subtitle="Find colleagues, their role and how to reach them." />
      <Card pad>
        <Field label="Search people"><input className="input" type="search" placeholder="Name, title, department or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      </Card>
      {q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
        q.data && q.data.items.length === 0 ? <Card><EmptyState title="No one found" text="Try a different name or department." icon={<Users size={24} />} /></Card> : (
          <>
            <div className="grid grid-3">
              {q.data?.items.map((p) => (
                <Card key={p.id} pad>
                  <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                    <Avatar name={p.name} url={p.avatarUrl} size="lg" />
                    <div style={{ minWidth: 0 }}>
                      <div className="strong">{p.name}</div>
                      <div className="small muted">{[p.designation, p.department].filter(Boolean).join(' - ') || 'No title'}</div>
                    </div>
                  </div>
                  <div className="stack small" style={{ gap: 6, marginTop: 14 }}>
                    <a className="row gap-sm" href={`mailto:${p.email}`} style={{ minWidth: 0, overflowWrap: 'anywhere' }}><Mail size={14} /> {p.email}</a>
                    {p.phone && <a className="row gap-sm" href={`tel:${p.phone}`}><Phone size={14} /> {p.phone}</a>}
                    {p.location && <span className="row gap-sm muted"><MapPin size={14} /> {p.location}</span>}
                    {p.manager && <span className="tiny muted">Reports to {p.manager}</span>}
                  </div>
                </Card>
              ))}
            </div>
            {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
          </>
        )}
    </div>
  )
}
