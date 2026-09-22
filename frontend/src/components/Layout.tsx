import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, CalendarDays, CheckSquare, ChevronDown, ClipboardList, Contact, Database, Home, LayoutDashboard, LogOut,
  Megaphone, Menu, Moon, Palmtree, Search, Settings, Shield, Sun, UserCircle, Users, BarChart3, UserCog,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { get } from '../lib/api'
import { useTheme } from '../lib/theme'
import { roleLabel } from '../lib/format'
import type { Paged, LeaveRow } from '../lib/types'
import { Avatar } from './ui'

interface NavItem { to: string; label: string; icon: ReactNode; badge?: number; end?: boolean }

export default function Layout() {
  const { user, logout, isManager, isHr, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { choice, setChoice } = useTheme()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  })
  const pending = useQuery({
    queryKey: ['approvals', 'badge'],
    queryFn: () => get<Paged<LeaveRow>>('/leaves', { status: 'Pending', pageSize: 1 }),
    enabled: isManager,
    refetchInterval: 60_000,
  })

  useEffect(() => { setNavOpen(false); setMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  if (!user) return null

  const me: NavItem[] = [
    { to: '/', label: 'Home', icon: <Home size={19} />, end: true },
    { to: '/profile', label: 'My profile', icon: <UserCircle size={19} /> },
    { to: '/leaves', label: 'Leaves', icon: <Palmtree size={19} /> },
    { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={19} /> },
    { to: '/people', label: 'People', icon: <Contact size={19} /> },
    { to: '/announcements', label: 'Announcements', icon: <Megaphone size={19} /> },
  ]
  const manage: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={19} /> },
    { to: '/approvals', label: 'Approvals', icon: <CheckSquare size={19} />, badge: pending.data?.total },
    { to: '/manage/people', label: 'Manage people', icon: <Users size={19} /> },
    { to: '/reports', label: 'Reports', icon: <BarChart3 size={19} /> },
  ]
  const admin: NavItem[] = [
    { to: '/master-data', label: 'Master data', icon: <Database size={19} /> },
    { to: '/manage/announcements', label: 'Notice board', icon: <ClipboardList size={19} /> },
  ]
  if (isSuperAdmin) admin.push({ to: '/audit', label: 'Audit & security', icon: <Shield size={19} /> })

  const renderLinks = (items: NavItem[]) => items.map((i) => (
    <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      {i.icon}<span>{i.label}</span>
      {!!i.badge && <span className="count" aria-label={`${i.badge} pending`}>{i.badge}</span>}
    </NavLink>
  ))

  function onSearch(e: FormEvent) {
    e.preventDefault()
    navigate(`/people?q=${encodeURIComponent(search.trim())}`)
    setSearch('')
  }

  const unreadCount = unread.data?.unread ?? 0

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Primary">
        <NavLink to="/" className="brand" aria-label="SelfMade HRM home">
          <span className="brand-mark"><Palmtree size={19} /></span>SelfMade HRM
        </NavLink>
        <nav aria-label="Main navigation" className="stack" style={{ gap: 2 }}>
          {renderLinks(me)}
          {isManager && <div className="nav-group">{isHr ? 'HR workspace' : 'My team'}</div>}
          {isManager && renderLinks(manage)}
          {isHr && <div className="nav-group">Administration</div>}
          {isHr && renderLinks(admin)}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings size={19} /><span>Settings</span></NavLink>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Menu size={22} /></button>
          <form className="search" role="search" onSubmit={onSearch}>
            <Search size={18} aria-hidden="true" />
            <input className="input" type="search" placeholder="Search people by name, role or department" aria-label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <div className="topbar-spacer" />
          <NavLink to="/notifications" className="icon-btn rel" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
            <Bell size={21} />
            {unreadCount > 0 && <span className="count" style={{ position: 'absolute', top: 2, right: 0, background: 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '0 5px', borderRadius: 999, minWidth: 17, textAlign: 'center' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </NavLink>
          <div className="rel" ref={menuRef}>
            <button className="user-chip" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <Avatar name={user.name} url={user.avatarUrl} />
              <span className="small strong" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="menu-pop" role="menu">
                <div style={{ padding: '8px 10px' }}>
                  <div className="strong">{user.name}</div>
                  <div className="tiny muted">{user.email}</div>
                  <div className="tiny muted">{roleLabel(user.role)}{user.department ? ` - ${user.department}` : ''}</div>
                </div>
                <hr />
                <NavLink to="/profile" className="item" role="menuitem"><UserCog size={17} />My profile</NavLink>
                <NavLink to="/settings" className="item" role="menuitem"><Settings size={17} />Settings</NavLink>
                <button className="item" role="menuitem" onClick={() => setChoice(choice === 'dark' ? 'light' : 'dark')}>
                  {choice === 'dark' ? <Sun size={17} /> : <Moon size={17} />}{choice === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <hr />
                <button className="item" role="menuitem" onClick={async () => { await logout(); navigate('/login') }}><LogOut size={17} />Sign out</button>
              </div>
            )}
          </div>
        </header>

        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>

        <nav className="mobile-bar" aria-label="Quick navigation">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><Home size={20} />Home</NavLink>
          <NavLink to="/leaves" className={({ isActive }) => (isActive ? 'active' : '')}><Palmtree size={20} />Leaves</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'active' : '')}><CalendarDays size={20} />Calendar</NavLink>
          {isManager
            ? <NavLink to="/approvals" className={({ isActive }) => (isActive ? 'active' : '')}><CheckSquare size={20} />Approvals</NavLink>
            : <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}><UserCircle size={20} />Profile</NavLink>}
        </nav>
      </div>
    </div>
  )
}
