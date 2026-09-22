import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Cake, CalendarDays, CalendarPlus, Megaphone, PartyPopper, Pin, Sun, UserRound } from 'lucide-react'
import { get } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { EmployeeDashboard } from '../../lib/types'
import { formatDate, formatDays, formatRange, greeting, parseIso, MONTHS, tenure, timeAgo } from '../../lib/format'
import { Avatar, BalanceBar, Badge, Button, Card, CardHead, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../components/ui'

function DateChip({ iso }: { iso: string }) {
  const d = parseIso(iso)
  return <div className="date-chip" aria-hidden="true"><span className="d">{d.getDate()}</span><span className="m">{MONTHS[d.getMonth()]}</span></div>
}

const todayTone = { Holiday: 'warning', Weekend: 'neutral', OnLeave: 'info', Working: 'success' } as const
const todayLabel = { Holiday: 'Holiday', Weekend: 'Weekend', OnLeave: 'On leave', Working: 'Working day' } as const

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['dashboard', 'me'], queryFn: () => get<EmployeeDashboard>('/dashboard/me') })

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const d = q.data

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="hero" aria-label="Welcome">
        <div className="row" style={{ gap: 18 }}>
          <Avatar name={user?.name ?? ''} url={user?.avatarUrl} size="lg" />
          <div>
            <h1>{greeting()}, {user?.name.split(' ')[0]}</h1>
            <p>{[user?.designation, user?.department].filter(Boolean).join(' - ') || 'Welcome to SelfMade HRM'}</p>
            {d && (
              <div className="row row-wrap gap-sm" style={{ marginTop: 10 }}>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.92)', color: '#0f172a' }}>
                  <Sun size={14} /> Today: {todayLabel[d.today.status]}{d.today.status !== 'Working' && d.today.status !== 'Weekend' ? ` (${d.today.detail})` : ''}
                </span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.92)', color: '#0f172a' }}>With SelfMade {tenure(d.joinDate)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="row row-wrap gap-sm">
          <Button variant="secondary" onClick={() => navigate('/leaves?apply=1')}><CalendarPlus size={18} /> Apply for leave</Button>
          <Button variant="ghost" onClick={() => navigate('/calendar')}><CalendarDays size={18} /> Calendar</Button>
        </div>
      </section>

      <div className="grid grid-3">
        <Card className="stat">
          <div className="label">Pending requests</div>
          {q.isLoading ? <Skeleton h={34} w={60} /> : <div className="value">{d?.pendingCount ?? 0}</div>}
          <div className="hint">{d?.pendingCount ? <Link to="/leaves">Track your requests</Link> : 'Nothing waiting for approval'}</div>
        </Card>
        <Card className="stat">
          <div className="label">Next approved leave</div>
          {q.isLoading ? <Skeleton h={34} w={140} /> : d?.nextLeave ? (
            <>
              <div className="value" style={{ fontSize: 22 }}>{formatRange(d.nextLeave.startDate, d.nextLeave.endDate)}</div>
              <div className="hint">{d.nextLeave.leaveType} - {formatDays(d.nextLeave.days)} day(s)</div>
            </>
          ) : (<><div className="value" style={{ fontSize: 22 }}>None planned</div><div className="hint">Time to plan a break?</div></>)}
        </Card>
        <Card className="stat">
          <div className="label">Profile completeness</div>
          {q.isLoading ? <Skeleton h={34} w={80} /> : <div className="value">{d?.profileCompleteness ?? 0}%</div>}
          <div className="hint">{d?.profileTodo[0] ? <Link to="/profile">{d.profileTodo[0]}</Link> : 'All set'}</div>
        </Card>
      </div>

      <div className="grid grid-main">
        <div className="stack" style={{ gap: 22 }}>
          <Card>
            <CardHead title="Leave balance" subtitle={`${new Date().getFullYear()} - approved and pending days are shaded`} action={<Link to="/leaves" className="small strong">View history</Link>} />
            <div className="card-body">
              {q.isLoading ? <div className="grid grid-3">{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div> : (
                <div className="grid grid-3">
                  {d?.balances.map((b) => (
                    <div key={b.leaveTypeId} className="card balance-card" style={{ boxShadow: 'none' }}>
                      <div className="top">
                        <span className="row gap-sm strong"><span className="dot" style={{ background: b.color }} />{b.code}</span>
                        <span className="tiny muted">{b.name}</span>
                      </div>
                      {b.tracksBalance ? (
                        <>
                          <div className="avail">{formatDays(b.available)}<span className="small muted"> / {formatDays(b.total)}</span></div>
                          <BalanceBar used={b.used} pending={b.pending} total={b.total} color={b.color} />
                          <div className="tiny muted">{formatDays(b.used)} used{b.pending > 0 ? `, ${formatDays(b.pending)} pending` : ''}</div>
                        </>
                      ) : (
                        <><div className="avail">{formatDays(b.used)}<span className="small muted"> taken</span></div><div className="tiny muted">No fixed balance</div></>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Company feed" action={<Link to="/announcements" className="small strong">All announcements</Link>} />
            <div className="card-body">
              {q.isLoading ? <Skeleton h={80} /> : d && d.announcements.length > 0 ? (
                <ul className="list">
                  {d.announcements.map((a) => (
                    <li key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <span className="badge badge-brand" style={{ padding: 8, borderRadius: 10 }}>{a.isPinned ? <Pin size={16} /> : <Megaphone size={16} />}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong">{a.title}</div>
                        <p className="small muted" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{a.body.length > 180 ? a.body.slice(0, 180) + '...' : a.body}</p>
                        <div className="tiny muted" style={{ marginTop: 4 }}>{a.createdBy ? `${a.createdBy} - ` : ''}{timeAgo(a.publishedAt)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No announcements yet" text="Company news and policy updates will show up here." icon={<Megaphone size={24} />} />}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 22 }}>
          <Card>
            <CardHead title="Upcoming holidays" action={<Link to="/calendar" className="small strong">Calendar</Link>} />
            <div className="card-body">
              {q.isLoading ? <Skeleton h={90} /> : d && d.holidays.length > 0 ? (
                <ul className="list">
                  {d.holidays.map((h) => (
                    <li key={h.id} className="list-item">
                      <DateChip iso={h.date} />
                      <div><div className="strong">{h.name}</div><div className="tiny muted">{h.kind === 'OfficeOff' ? 'Office off' : 'Public holiday'}</div></div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No upcoming holidays" icon={<PartyPopper size={24} />} />}
            </div>
          </Card>

          <Card>
            <CardHead title="Birthdays & anniversaries" subtitle="Next 30 days" />
            <div className="card-body">
              {q.isLoading ? <Skeleton h={90} /> : d && d.events.length > 0 ? (
                <ul className="list">
                  {d.events.map((e) => (
                    <li key={`${e.type}-${e.employeeId}-${e.date}`} className="list-item">
                      <Avatar name={e.name} url={e.avatarUrl} />
                      <div style={{ minWidth: 0 }}>
                        <div className="strong">{e.name}</div>
                        <div className="tiny muted">{e.type === 'birthday' ? 'Birthday' : `${e.years} year${e.years === 1 ? '' : 's'} at SelfMade`} - {formatDate(e.date, false)}</div>
                      </div>
                      <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>{e.type === 'birthday' ? <Cake size={18} /> : <PartyPopper size={18} />}</span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Nothing coming up" text="No birthdays or work anniversaries in the next 30 days." icon={<Cake size={24} />} />}
            </div>
          </Card>

          {d && d.profileTodo.length > 0 && (
            <Card pad>
              <div className="row between" style={{ marginBottom: 8 }}><h2>Finish your profile</h2><Badge tone="brand">{d.profileCompleteness}%</Badge></div>
              <ul className="list">
                {d.profileTodo.slice(0, 4).map((t) => (
                  <li key={t} className="list-item small"><UserRound size={16} className="muted" /><Link to="/profile">{t}</Link></li>
                ))}
              </ul>
            </Card>
          )}
          {d?.nextLeave && (<Card pad><div className="row between"><span className="small muted">Latest leave status</span><StatusBadge status={d.nextLeave.status} /></div></Card>)}
        </div>
      </div>
    </div>
  )
}
