import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { post } from '../../lib/api'
import { Button, Field, FormError, Notice } from '../../components/ui'
import AuthShell from './AuthShell'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await post('/auth/forgot-password', { email: email.trim() })
      setDone(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <div className="stack" style={{ gap: 20 }}>
        <div>
          <h1>Reset your password</h1>
          <p className="muted">Enter your work email and we will send you a reset link.</p>
        </div>
        {done ? (
          <Notice tone="success"><MailCheck size={20} /><div>If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 30 minutes.</div></Notice>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            <Field label="Work email" required><input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <FormError error={error} />
            <Button type="submit" variant="primary" block loading={busy} disabled={!email.trim()}>Send reset link</Button>
          </form>
        )}
        <Link to="/login" className="small">Back to sign in</Link>
      </div>
    </AuthShell>
  )
}
