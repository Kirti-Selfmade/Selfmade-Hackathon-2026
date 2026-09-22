import type { ReactNode } from 'react'
import { CalendarCheck, Palmtree, ShieldCheck, Sparkles } from 'lucide-react'

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-art" aria-hidden="true">
        <div className="brand" style={{ color: '#fff' }}>
          <span className="brand-mark" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}><Palmtree size={19} /></span>
          SelfMade HRM
        </div>
        <div>
          <h2>Everything HR, in one calm place.</h2>
          <ul>
            <li><CalendarCheck size={18} /> Apply for leave and see approvals in real time</li>
            <li><Sparkles size={18} /> Your profile, holidays, birthdays and notices at a glance</li>
            <li><ShieldCheck size={18} /> Secure, audited and built for your team</li>
          </ul>
        </div>
        <div className="small" style={{ opacity: 0.75 }}>&copy; {new Date().getFullYear()} SelfMade Software Pvt Ltd</div>
      </aside>
      <main className="auth-form-wrap" id="main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  )
}
