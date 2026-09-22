import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin, Plus } from 'lucide-react'
import { ApiError, del, get, post, put } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { formatDate } from '../../lib/format'
import type { Announcement, Paged } from '../../lib/types'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormError, Overlay, PageHead, Pagination, SkeletonRows } from '../../components/ui'

const PAGE_SIZE = 10

export default function NoticeBoardAdminPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null)
  const [remove, setRemove] = useState<Announcement | null>(null)
  const q = useQuery({ queryKey: ['announcements', 'manage', page], queryFn: () => get<Paged<Announcement>>('/announcements/manage', { page, pageSize: PAGE_SIZE }), placeholderData: (p) => p })
  const reload = () => { qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Notice board" subtitle="Publish company announcements to every employee's home page." actions={<Button variant="primary" onClick={() => setEdit('new')}><Plus size={18} /> New announcement</Button>} />
      <Card>
        {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <EmptyState title="No announcements yet" /> : (
          <div className="card-body">
            <ul className="list">
              {q.data.items.map((a) => (
                <li key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row gap-sm row-wrap"><span className="strong">{a.title}</span>{a.isPinned && <Badge tone="brand"><Pin size={12} /> Pinned</Badge>}{!a.isPublished && <Badge>Draft</Badge>}</div>
                    <p className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.body.length > 220 ? a.body.slice(0, 220) + '...' : a.body}</p>
                    <div className="tiny muted" style={{ marginTop: 4 }}>{formatDate(a.publishedAt)}{a.createdBy ? ` - ${a.createdBy}` : ''}</div>
                  </div>
                  <div className="row gap-sm"><Button size="sm" onClick={() => setEdit(a)}>Edit</Button><Button size="sm" variant="danger-ghost" onClick={() => setRemove(a)}>Delete</Button></div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
      </Card>
      {edit && <Editor item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { reload(); toast.success('Announcement saved.') }} />}
      {remove && <ConfirmDialog title="Delete announcement?" message={`"${remove.title}" will be removed for everyone.`} confirmLabel="Delete" tone="danger" onClose={() => setRemove(null)}
        onConfirm={async () => { await del(`/announcements/${remove.id}`); reload(); toast.success('Announcement deleted.') }} />}
    </div>
  )
}

function Editor({ item, onClose, onSaved }: { item: Announcement | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [isPinned, setPinned] = useState(item?.isPinned ?? false)
  const [isPublished, setPublished] = useState(item?.isPublished ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fe = error instanceof ApiError ? error : null

  async function save() {
    setBusy(true); setError(null)
    try {
      const payload = { title, body, isPinned, isPublished }
      if (item) await put(`/announcements/${item.id}`, payload); else await post('/announcements', payload)
      onSaved(); onClose()
    } catch (e) { setError(e); setBusy(false) }
  }

  return (
    <Overlay title={item ? 'Edit announcement' : 'New announcement'} onClose={onClose} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <Field label="Title" required error={fe?.fieldError('title')}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></Field>
        <Field label="Message" required error={fe?.fieldError('body')} hint="Plain text. Line breaks are kept."><textarea className="textarea" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        <label className="row gap-sm"><input type="checkbox" checked={isPinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top</label>
        <label className="row gap-sm"><input type="checkbox" checked={isPublished} onChange={(e) => setPublished(e.target.checked)} /> Published (uncheck to keep as draft)</label>
        <FormError error={fe && Object.keys(fe.errors).length === 0 ? error : null} />
      </div>
    </Overlay>
  )
}
