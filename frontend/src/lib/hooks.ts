import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get } from './api'
import type { Department, LeaveType } from './types'

/** Invalidate everything that a leave / people change can affect. */
export function useRefreshData() {
  const qc = useQueryClient()
  return useCallback(() => {
    for (const key of ['leaves', 'dashboard', 'approvals', 'calendar', 'notifications', 'reports', 'employees', 'balances']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
  }, [qc])
}

/** Debounce a fast-changing value (search boxes, live previews). */
export function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

export function useLeaveTypes(includeInactive = false) {
  return useQuery({
    queryKey: ['leave-types', includeInactive],
    queryFn: () => get<LeaveType[]>('/leave-types', { includeInactive }),
    staleTime: 5 * 60_000,
  })
}

export function useDepartments(includeInactive = false) {
  return useQuery({
    queryKey: ['departments', includeInactive],
    queryFn: () => get<Department[]>('/departments', { includeInactive }),
    staleTime: 5 * 60_000,
  })
}
