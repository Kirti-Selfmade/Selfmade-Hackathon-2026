import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cake, ChevronLeft, ChevronRight, LayoutGrid, List, PartyPopper } from 'lucide-react'
import { get } from '../../lib/api'
import type { CalendarEvent } from '../../lib/types'
import { MONTHS, WEEKDAYS, addDays, formatDate, isWeekend, toIso, todayIso } from '../../lib/format'
import { Button, Card, EmptyState, ErrorState, PageHead, Skeleton, Tabs } from '../../components/ui'

type Kind = CalendarEvent['type']
const KIND_LABEL: Record<Kind, string> = { holiday: 'Holidays', officeoff: 'Office off', leave: 'Leave', birthday: 'Birthdays', anniversary: 'Anniversaries' }

function evClass(e: CalendarEvent) {
  return `ev-${e.type}${e.type === 'leave' && e.status === 'Pending' ? ' pending' : ''}`
}

/** Monday-first 6-week grid that contains the given month. */
function buildGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = addDays(toIso(first), -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [view, setView] = useState<'month' | 'list'>('month')
  const [selected, setSelected] = useState<string>(todayIso())
  const [hidden, setHidden] = useState<Set<Kind>>(new Set())

  const grid = useMemo(() => buildGrid(year, month), [year, month])
  const q = useQuery({
    queryKey: ['calendar', grid[0], grid[41]],
    queryFn: () => get<CalendarEvent[]>('/calendar', { from: grid[0], to: grid[41] }),
    placeholderData: (prev) => prev,
  })

  const events = useMemo(() => (q.data ?? []).filter((e) => !hidden.has(e.type)), [q.data, hidden])
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    for (const e of events) { const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a) }
    return m
  }, [events])

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  function toggle(kind: Kind) {
    setHidden((cur) => { const n = new Set(cur); if (n.has(kind)) n.delete(kind); else n.add(kind); return n })
  }

  const today = todayIso()
  const selectedEvents = byDate.get(selected) ?? []
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEvents = events.filter((e) => e.date.startsWith(monthPrefix))

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Calendar"
        subtitle="Holidays, leave, birthdays and work anniversaries in one place."
        actions={
          <div className="row gap-sm">
            <Button size="sm" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelected(today) }}>Today</Button>
            <Button size="sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
            <span className="strong" style={{ minWidth: 130, textAlign: 'center' }} aria-live="polite">{MONTHS[month]} {year}</span>
            <Button size="sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
          </div>
        }
      />

      <div className="row between row-wrap">
        <div className="pill-row" role="group" aria-label="Show on calendar">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button key={k} className="chip" aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <Tabs<'month' | 'list'> label="Calendar view" value={view} onChange={setView} items={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'List' }]} />
      </div>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {view === 'month' ? (
        <div className="grid grid-main">
          <Card>
            {q.isLoading ? <div style={{ padding: 20 }}><Skeleton h={420} /></div> : (
              <div className="cal-grid" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
                {WEEKDAYS.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
                {grid.map((iso) => {
                  const dayEvents = byDate.get(iso) ?? []
                  const inMonth = iso.startsWith(monthPrefix)
                  const cls = ['cal-cell', inMonth ? '' : 'out', isWeekend(iso) ? 'weekend' : '', iso === today ? 'today' : '', iso === selected ? 'selected' : ''].join(' ')
                  const label = `${formatDate(iso)}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`
                  return (
                    <button key={iso} className={cls} role="gridcell" aria-label={label} aria-selected={iso === selected} onClick={() => setSelected(iso)}>
                      <span className="cal-day">{Number(iso.slice(8))}</span>
                      {dayEvents.slice(0, 3).map((e, i) => (
                        <span key={i} className={`cal-ev ${evClass(e)}`} style={e.type === 'leave' && e.color ? { borderColor: e.color } : undefined} title={e.title}>{e.title}</span>
                      ))}
                      {dayEvents.length > 3 && <span className="cal-more">+{dayEvents.length - 3} more</span>}
                      {dayEvents.length > 0 && (
                        <span className="cal-dots" aria-hidden="true">
                          {dayEvents.slice(0, 4).map((e, i) => <span key={i} className="dot" style={{ background: e.type === 'leave' && e.color ? e.color : 'var(--brand)', width: 6, height: 6 }} />)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{ padding: 14 }} className="legend">
              <span><span className="dot" style={{ background: 'var(--warning)' }} /> Holiday</span>
              <span><span className="dot" style={{ background: 'var(--muted)' }} /> Office off</span>
              <span><span className="dot" style={{ background: 'var(--info)' }} /> Birthday</span>
              <span><span className="dot" style={{ background: 'var(--brand)' }} /> Anniversary</span>
              <span>Dashed = pending leave</span>
            </div>
          </Card>

          <Card pad>
            <h2 style={{ marginBottom: 12 }}>{formatDate(selected)}</h2>
            {selectedEvents.length === 0 ? <p className="small muted">{isWeekend(selected) ? 'Weekend.' : 'Nothing scheduled.'}</p> : (
              <ul className="list">
                {selectedEvents.map((e, i) => <EventLine key={i} e={e} />)}
              </ul>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          {monthEvents.length === 0 ? <EmptyState title="Nothing this month" text="No events match your filters." /> : (
            <ul className="list" style={{ padding: '0 20px' }}>
              {monthEvents.map((e, i) => (
                <li key={i} className="list-item">
                  <div className="date-chip"><span className="d">{Number(e.date.slice(8))}</span><span className="m">{MONTHS[Number(e.date.slice(5, 7)) - 1]}</span></div>
                  <EventLine e={e} bare />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function EventLine({ e, bare }: { e: CalendarEvent; bare?: boolean }) {
  const icon = e.type === 'birthday' ? <Cake size={16} /> : e.type === 'anniversary' ? <PartyPopper size={16} /> : e.type === 'leave' ? <LayoutGrid size={16} /> : <List size={16} />
  const content = (
    <>
      <span className={`badge ${e.type === 'holiday' ? 'badge-warning' : e.type === 'birthday' ? 'badge-info' : e.type === 'anniversary' ? 'badge-brand' : ''}`} style={{ padding: 6, borderRadius: 8 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="strong small">{e.title}</div>
        <div className="tiny muted">{KIND_LABEL[e.type]}{e.status === 'Pending' ? ' - pending approval' : ''}</div>
      </div>
    </>
  )
  return bare ? <div className="row" style={{ minWidth: 0 }}>{content}</div> : <li className="list-item">{content}</li>
}
