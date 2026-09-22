import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { ApiError } from '../../lib/api'
import { Button, Field, FormError } from '../../components/ui'
import AuthShell from './AuthShell'

const DEMO = [
  { label: 'Super Admin', email: 'admin@selfmade.tech' },
  { label: 'HR Admin', email: 'hr@selfmade.tech' },
  { label: 'Manager', email: 'manager@selfmade.tech' },
  { label: 'Employee', email: 'shreyas@selfmade.tech' },
]

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  if (user) return <Navigate to={user.mustChangePassword ? '/settings' : from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const u = await login(email.trim(), password)
      navigate(u.mustChangePassword ? '/settings' : from, { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const fieldError = error instanceof ApiError && error.status === 400 ? error : null

  return (
    <AuthShell>
      <div className="stack" style={{ gap: 22 }}>
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your SelfMade HRM account.</p>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Work email" required error={touched && !email.trim() ? 'Enter your email.' : fieldError?.fieldError('email')}>
            <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" required error={touched && !password ? 'Enter your password.' : undefined}>
            <div style={{ position: 'relative' }}>
              <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 44 }} />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((v) => !v)} style={{ position: 'absolute', right: 3, top: 3 }}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {!fieldError && <FormError error={error} />}
          <Button type="submit" variant="primary" block loading={busy}>Sign in</Button>
          <div className="right small"><Link to="/forgot-password">Forgot your password?</Link></div>
        </form>

        {import.meta.env.DEV && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="tiny muted">Local demo accounts (password: Password@123)</div>
            <div className="pill-row">
              {DEMO.map((d) => (
                <button key={d.email} type="button" className="chip" onClick={() => { setEmail(d.email); setPassword('Password@123') }}>{d.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
