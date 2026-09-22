import { Palmtree } from 'lucide-react'
import type { LeaveRow } from '../../lib/types'
import { formatDate, formatDays, formatRange } from '../../lib/format'
import { Avatar, EmptyState, ErrorState, SkeletonRows, StatusBadge } from '../../components/ui'
import type { ReactNode } from 'react'

interface Props {
  rows: LeaveRow[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  onOpen: (id: number) => void
  showEmployee?: boolean
  emptyAction?: ReactNode
  emptyText?: string
}

export default function LeaveTable({ rows, loading, error, onRetry, onOpen, showEmployee, emptyAction, emptyText }: Props) {
  if (loading) return <SkeletonRows rows={6} />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!rows || rows.length === 0) {
    return <EmptyState title="No leave requests found" text={emptyText ?? 'Try changing the filters.'} icon={<Palmtree size={24} />} action={emptyAction} />
  }
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            {showEmployee && <th scope="col">Employee</th>}
            <th scope="col">Dates</th>
            <th scope="col">Type</th>
            <th scope="col">Days</th>
            <th scope="col">Reason</th>
            <th scope="col">Applied</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
              {showEmployee && (
                <td data-label="Employee">
                  <div className="cell-person"><Avatar name={r.employeeName} size="sm" /><div><div className="name">{r.employeeName}</div><div className="tiny muted">{r.department ?? ''}</div></div></div>
                </td>
              )}
              <td data-label="Dates" className="nowrap">
                <button className="btn-ghost" style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: 'var(--brand)' }} onClick={(e) => { e.stopPropagation(); onOpen(r.id) }}>
                  {formatRange(r.startDate, r.endDate)}
                </button>
                {r.isHalfDay && <span className="tiny muted"> (half)</span>}
              </td>
              <td data-label="Type"><span className="row gap-sm"><span className="dot" style={{ background: r.color }} />{r.leaveType}</span></td>
              <td data-label="Days">{formatDays(r.days)}</td>
              <td data-label="Reason" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.reason}>{r.reason}</td>
              <td data-label="Applied" className="nowrap">{formatDate(r.appliedAt.slice(0, 10))}</td>
              <td data-label="Status"><StatusBadge status={r.status} />{r.status === 'Pending' && r.ageDays >= 3 && <span className="tiny" style={{ color: 'var(--warning)', marginLeft: 6 }}>{r.ageDays}d</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
