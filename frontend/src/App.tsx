import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import { Button, SkeletonRows } from './components/ui'

const LoginPage = lazy(() => import('./features/auth/LoginPage'))
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage'))
const HomePage = lazy(() => import('./features/home/HomePage'))
const ProfilePage = lazy(() => import('./features/profile/ProfilePage'))
const LeavesPage = lazy(() => import('./features/leaves/LeavesPage'))
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage'))
const DirectoryPage = lazy(() => import('./features/people/DirectoryPage'))
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'))
const AnnouncementsPage = lazy(() => import('./features/notifications/AnnouncementsPage'))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))
const DashboardPage = lazy(() => import('./features/manager/DashboardPage'))
const ApprovalsPage = lazy(() => import('./features/approvals/ApprovalsPage'))
const ManagePeoplePage = lazy(() => import('./features/people/ManagePeoplePage'))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const MasterDataPage = lazy(() => import('./features/admin/MasterDataPage'))
const NoticeBoardAdminPage = lazy(() => import('./features/admin/NoticeBoardAdminPage'))
const AuditPage = lazy(() => import('./features/admin/AuditPage'))

/** Friendly recovery screen for unexpected rendering failures. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="empty" role="alert" style={{ paddingTop: 96 }}>
        <h2>Something went wrong on this page</h2>
        <p className="small" style={{ margin: '8px 0 16px' }}>Your data is safe. Reload the page to continue.</p>
        <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="content"><SkeletonRows rows={6} /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // A freshly invited / reset account is sent straight to the change-password screen.
  if (user.mustChangePassword && location.pathname !== '/settings') return <Navigate to="/settings" replace />
  return <>{children}</>
}

function Only({ allow, children }: { allow: 'manager' | 'hr' | 'super'; children: ReactNode }) {
  const { isManager, isHr, isSuperAdmin } = useAuth()
  const ok = allow === 'manager' ? isManager : allow === 'hr' ? isHr : isSuperAdmin
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="content"><SkeletonRows rows={6} /></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<HomePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="leaves" element={<LeavesPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="people" element={<DirectoryPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="dashboard" element={<Only allow="manager"><DashboardPage /></Only>} />
            <Route path="approvals" element={<Only allow="manager"><ApprovalsPage /></Only>} />
            <Route path="manage/people" element={<Only allow="manager"><ManagePeoplePage /></Only>} />
            <Route path="reports" element={<Only allow="manager"><ReportsPage /></Only>} />
            <Route path="master-data" element={<Only allow="hr"><MasterDataPage /></Only>} />
            <Route path="manage/announcements" element={<Only allow="hr"><NoticeBoardAdminPage /></Only>} />
            <Route path="audit" element={<Only allow="super"><AuditPage /></Only>} />
            <Route path="*" element={<div className="empty"><h2>Page not found</h2><p className="small">The page you are looking for does not exist.</p></div>} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
