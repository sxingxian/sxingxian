import { useRef, useState, type SubmitEvent } from 'react';
import '../admin.css';
import { PasswordField, authPost, safeNext } from './fields';

export default function Login({ setupAvailable }: { setupAvailable: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await authPost('/api/auth/login', { email, password, ...(step === 'code' ? { code } : {}) });
      if (r.ok && r.data.mfa) {
        setStep('code');
        setTimeout(() => codeRef.current?.focus(), 0);
      } else if (r.ok && r.data.ok) {
        const next = r.data.mustChangePassword ? '/admin/account' : safeNext(new URLSearchParams(window.location.search).get('next'));
        window.location.replace(next);
        return;
      } else {
        setErr(typeof r.data.error === 'string' ? r.data.error : 'Sign-in failed. Try again.');
        if (step === 'code') setCode('');
      }
    } catch {
      setErr('Couldn’t reach the server. Check your connection.');
    }
    setBusy(false);
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-mini">sxingxian<span>.</span> <span className="muted" style={{ color: 'var(--faint)' }}>admin</span></div>
        <h1>{step === 'password' ? 'Sign in' : 'Two-step sign-in'}</h1>
        {err && <div className="alert err" role="alert">{err}</div>}
        <form onSubmit={submit} noValidate>
          {step === 'password' ? (
            <>
              <label className="field" htmlFor="email">
                Email
                <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username" required maxLength={254} autoCapitalize="off" spellCheck={false} autoFocus />
              </label>
              <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            </>
          ) : (
            <label className="field" htmlFor="code">
              {useRecovery ? 'Recovery code' : 'Authenticator code'}
              <input id="code" ref={codeRef} className={useRecovery ? 'input' : 'input code-input'} value={code}
                onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={20} required
                placeholder={useRecovery ? 'xxxxx-xxxxx' : '000000'} autoCapitalize="off" spellCheck={false} />
              <button type="button" className="linkbtn hint" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>
                {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
              </button>
            </label>
          )}
          <button className="btn primary" disabled={busy || !email || !password || (step === 'code' && !code)}>
            {busy ? 'Checking…' : step === 'password' ? 'Continue' : 'Verify'}
          </button>
          {step === 'code' && (
            <button type="button" className="btn" onClick={() => { setStep('password'); setCode(''); setErr(''); }}>Back</button>
          )}
        </form>
        <div className="auth-foot">
          {setupAvailable ? <a href="/admin/setup">Create the first admin account</a> : 'Forgot your password? Ask an owner.'}
        </div>
      </div>
    </main>
  );
}
