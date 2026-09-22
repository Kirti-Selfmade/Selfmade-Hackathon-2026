import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Moon, Monitor, Sun } from 'lucide-react'
import { ApiError, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useTheme, type ThemeChoice } from '../../lib/theme'
import { Button, Card, CardHead, Field, FormError, Notice, PageHead } from '../../components/ui'

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { choice, setChoice } = useTheme()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== next
  const fe = error instanceof ApiError ? error : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!current || !next || next !== confirm) return
    setBusy(true)
    setError(null)
    try {
      await post('/auth/change-password', { currentPassword: current, newPassword: next })
      updateUser({ mustChangePassword: false })
      setCurrent(''); setNext(''); setConfirm(''); setTouched(false)
      toast.success('Password changed.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const themes: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={16} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
    { value: 'system', label: 'System', icon: <Monitor size={16} /> },
  ]

  return (
    <div className="stack" style={{ gap: 22, maxWidth: 760 }}>
      <PageHead title="Settings" subtitle="Account security and preferences." />

      {user?.mustChangePassword && <Notice tone="warning"><div className="small">For your security, please choose a new password before continuing.</div></Notice>}

      <Card>
        <CardHead title="Change password" subtitle="Use at least 10 characters with upper and lower case letters and a number." />
        <form className="card-body stack" onSubmit={submit} noValidate>
          <Field label="Current password" required error={fe?.fieldError('currentPassword') ?? (touched && !current ? 'Enter your current password.' : undefined)}>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required error={fe?.fieldError('newPassword') ?? (touched && !next ? 'Enter a new password.' : undefined)}>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match.' : undefined}>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {fe && Object.keys(fe.errors).length === 0 && <FormError error={error} />}
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" variant="primary" loading={busy}>Update password</Button></div>
        </form>
      </Card>

      <Card>
        <CardHead title="Appearance" subtitle="Light is the default. Choose what feels comfortable." />
        <div className="card-body">
          <div className="pill-row" role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <button key={t.value} className="chip" role="radio" aria-checked={choice === t.value} aria-pressed={choice === t.value} onClick={() => setChoice(t.value)}>{t.icon} {t.label}</button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>Animations are reduced automatically if your device asks for it.</p>
        </div>
      </Card>

      <Card>
        <CardHead title="Sessions" subtitle="Signed in as" />
        <div className="card-body row between row-wrap">
          <div><div className="strong">{user?.name}</div><div className="small muted">{user?.email}</div></div>
          <div className="row gap-sm">
            <Button onClick={async () => { try { await post('/auth/logout-all') } catch { /* ignore */ } await logout(); navigate('/login') }}>Sign out everywhere</Button>
            <Button variant="danger-ghost" onClick={async () => { await logout(); navigate('/login') }}><LogOut size={16} /> Sign out</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
