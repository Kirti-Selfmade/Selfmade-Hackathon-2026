import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, post, setSessionExpiredHandler, tokenStore } from './api'
import type { AuthResponse, EmployeeDetail, User } from './types'

const USER_KEY = 'hrm.user'

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw && tokenStore.access() ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch { /* ignore */ }
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  updateUser: (patch: Partial<User>) => void
  isManager: boolean
  isHr: boolean
  isSuperAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(readCachedUser)
  const [loading, setLoading] = useState<boolean>(() => readCachedUser() !== null)

  const clearSession = useCallback(() => {
    tokenStore.clear()
    cacheUser(null)
    setUser(null)
    qc.clear()
  }, [qc])

  useEffect(() => {
    setSessionExpiredHandler(clearSession)
  }, [clearSession])

  // Re-validate a cached session on first load and pick up role / profile changes.
  useEffect(() => {
    if (!readCachedUser()) {
      setLoading(false)
      return
    }
    let cancelled = false
    api<EmployeeDetail>('/me')
      .then((me) => {
        if (cancelled) return
        setUser((prev) => {
          const next: User = {
            id: me.id,
            name: `${me.firstName} ${me.lastName}`.trim(),
            email: me.email,
            role: me.role,
            designation: me.designation,
            department: me.department,
            avatarUrl: me.avatarUrl,
            mustChangePassword: prev?.mustChangePassword ?? false,
          }
          cacheUser(next)
          return next
        })
      })
      .catch(() => { /* a 401 already cleared the session via the handler */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false })
    tokenStore.set(res.accessToken, res.refreshToken)
    cacheUser(res.user)
    qc.clear()
    setUser(res.user)
    return res.user
  }, [qc])

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh()
    try {
      if (refreshToken) await post('/auth/logout', { refreshToken })
    } catch { /* ignore - we are leaving anyway */ }
    clearSession()
  }, [clearSession])

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      cacheUser(next)
      return next
    })
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login,
    logout,
    updateUser,
    isManager: !!user && ['Manager', 'HrAdmin', 'SuperAdmin'].includes(user.role),
    isHr: !!user && ['HrAdmin', 'SuperAdmin'].includes(user.role),
    isSuperAdmin: user?.role === 'SuperAdmin',
  }), [user, loading, login, logout, updateUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
