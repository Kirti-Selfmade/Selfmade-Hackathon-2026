import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Cake, ClipboardCheck, PartyPopper, UserMinus, UserPlus, Users } from 'lucide-react'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate, formatDays } from '../../lib/format'
import type { TeamDashboard } from '../../lib/types'
import { Avatar, Badge, Card, CardHead, EmptyState, ErrorState, Notice, PageHead, SkeletonRows } from '../../components/ui'
import LeaveDetailDrawer from '../leaves/LeaveDetailDrawer'
import LeaveTable from '../leaves/LeaveTable'

function Stat({ label, value, hint, icon }: { label: string; value: number | string; hint?: string; icon: ReactNode }) {
  return (
    <Card className="stat">
      <div className="row between"><span className="label">{label}</span><span className="muted" aria-hidden="true">{icon}</span></div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </Card>
  )
}

export default function DashboardPage() {
  const { isHr } = useAuth()
  const [openId, setOpenId] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['dashboard', 'team'], queryFn: () => get<TeamDashboard>('/dashboard/team') })

  if (q.isLoading) return <SkeletonRows rows={10} />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data
  const max = Math.max(1, ...d.trend.map((t) => t.days))

  return (
    <div className="stack" style={{ gap: 22 }}>
      <PageHead title={isHr ? 'Organization dashboard' : 'Team dashboard'} subtitle={d.scope === 'organization' ? 'Everyone across SelfMade.' : 'You and the people reporting to you.'}
        actions={<Link className="btn btn-secondary" to="/approvals"><ClipboardCheck size={18} /> Open approvals</Link>} />

      <div className="grid grid-4">
        <Stat label="Headcount" value={d.headcount} icon={<Users size={18} />} hint={`${d.availableToday} available today`} />
        <Stat label="On leave today" value={d.onLeaveToday.length} icon={<UserMinus size={18} />} />
        <Stat label="Pending approvals" value={d.pending.count} icon={<ClipboardCheck size={18} />} hint={d.pending.overdue > 0 ? `${d.pending.overdue} waiting more than 2 days` : 'Nothing overdue'} />
        <Stat label="Joiners / exits (30d)" value={`${d.newJoiners} / ${d.exits}`} icon={<UserPlus size={18} />} />
      </div>

      {d.exceptions.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {d.exceptions.map((x, i) => (
            <Notice key={i} tone={x.kind === 'error' ? 'danger' : x.kind === 'warning' ? 'warning' : 'info'}>
              <div className="row between row-wrap"><span className="small"><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> {x.text}</span>{x.link && <Link to={x.link} className="small strong">Review</Link>}</div>
            </Notice>
          ))}
        </div>
      )}

      <div className="grid grid-main">
        <Card>
          <CardHead title="Waiting for your decision" action={d.pending.count > 0 ? <Badge tone="warning">{d.pending.count}</Badge> : undefined} />
          <LeaveTable rows={d.pending.items} loading={false} error={null} onRetry={() => q.refetch()} onOpen={setOpenId} showEmployee emptyText="You are all caught up." />
          {d.pending.count > d.pending.items.length && <div className="card-body"><Link to="/approvals" className="small strong">See all {d.pending.count} requests</Link></div>}
        </Card>

        <Card>
          <CardHead title="Out today" />
          <div className="card-body">
            {d.onLeaveToday.length === 0 ? <p className="small muted">Everyone is in.</p> : (
              <ul className="list">
                {d.onLeaveToday.map((p) => (
                  <li key={p.employeeId} className="list-item">
                    <Avatar name={p.name} url={p.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0 }}><div className="strong small">{p.name}</div><div className="tiny muted">{p.type}{p.isHalfDay ? ' (half day)' : ''} until {formatDate(p.until)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Leave days taken" subtitle="Last six months" />
          <div className="card-body">
            <div className="bars" role="img" aria-label={`Leave days by month: ${d.trend.map((t) => `${t.label} ${formatDays(t.days)}`).join(', ')}`}>
              {d.trend.map((t) => (
                <div key={t.label} className="bar-col">
                  <span className="bar-val">{formatDays(t.days)}</span>
                  <div className="bar" style={{ height: `${(t.days / max) * 100}%` }} />
                  <span className="bar-label">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Coming up" />
          <div className="card-body stack" style={{ gap: 16 }}>
            {d.holidays.length === 0 && d.events.length === 0 && <EmptyState title="Nothing upcoming" />}
            {d.holidays.length > 0 && (
              <ul className="list">
                {d.holidays.map((h) => (
                  <li key={h.id} className="list-item"><Badge tone="warning">{formatDate(h.date, false)}</Badge><span className="small">{h.name}</span></li>
                ))}
              </ul>
            )}
            {d.events.length > 0 && (
              <ul className="list">
                {d.events.map((e, i) => (
                  <li key={i} className="list-item">
                    <Avatar name={e.name} url={e.avatarUrl} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div className="strong small">{e.name}</div>
                      <div className="tiny muted">{e.type === 'birthday' ? <><Cake size={12} /> Birthday</> : <><PartyPopper size={12} /> {e.years} year{e.years === 1 ? '' : 's'} at SelfMade</>} - {formatDate(e.date, false)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
      {openId !== null && <LeaveDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
