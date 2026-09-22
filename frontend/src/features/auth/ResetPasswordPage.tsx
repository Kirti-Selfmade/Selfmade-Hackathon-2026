import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { post, ApiError } from '../../lib/api'
import { useToast } from '../../lib/toast'
import { Button, Field, FormError, Notice } from '../../components/ui'
import AuthShell from './AuthShell'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const email = params.get('email') ?? ''
  const navigate = useNavigate()
  const toast = useToast()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== password

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!password || password !== confirm) return
    setBusy(true)
    setError(null)
    try {
      await post('/auth/reset-password', { email, token, newPassword: password })
      toast.success('Password updated. Please sign in.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const pwError = error instanceof ApiError ? error.fieldError('newPassword') : undefined

  return (
    <AuthShell>
      <div className="stack" style={{ gap: 20 }}>
        <div>
          <h1>Choose a new password</h1>
          <p className="muted">Use at least 10 characters with upper and lower case letters and a number.</p>
        </div>
        {!token || !email ? (
          <Notice tone="danger">This reset link is incomplete. Please request a new one.</Notice>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            <Field label="New password" required error={pwError ?? (touched && !password ? 'Enter a new password.' : undefined)}>
              <input className="input" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match.' : undefined}>
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {!pwError && <FormError error={error} />}
            <Button type="submit" variant="primary" block loading={busy}>Update password</Button>
          </form>
        )}
        <Link to="/forgot-password" className="small">Request a new link</Link>
      </div>
    </AuthShell>
  )
}
