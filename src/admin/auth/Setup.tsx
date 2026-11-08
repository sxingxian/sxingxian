import { useState, type SubmitEvent } from 'react';
import '../admin.css';
import { PasswordField, StrengthMeter, authPost } from './fields';

export default function Setup({ available, closedMessage }: { available: boolean; closedMessage: string }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!available) {
    return (
      <main className="auth">
        <div className="auth-card">
          <h1>Setup is closed</h1>
          <p className="muted" style={{ margin: 0 }}>{closedMessage}</p>
          <a className="btn primary" href="/admin/login">Go to sign in</a>
        </div>
      </main>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setErr('');
    try {
      const r = await authPost('/api/auth/setup', { token, name, email, password });
      if (r.ok) {
        window.location.replace('/admin/account?welcome=1');
        return;
      }
      const details = Array.isArray(r.data.details) ? (r.data.details as { message: string }[]).map((d) => d.message).join(' ') : '';
      setErr(details || (typeof r.data.error === 'string' ? r.data.error : 'Setup failed.'));
    } catch {
      setErr('Couldn’t reach the server. Check your connection.');
    }
    setBusy(false);
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-mini">sxingxian<span>.</span></div>
        <h1>Create the owner account</h1>
        {err && <div className="alert err" role="alert">{err}</div>}
        <form onSubmit={submit}>
          <label className="field" htmlFor="token">
            Setup token
            <input id="token" className="input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off"
              spellCheck={false} autoCapitalize="off" required maxLength={256} />
          </label>
          <label className="field" htmlFor="name">
            Name
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
          <label className="field" htmlFor="email">
            Email
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" required maxLength={254} autoCapitalize="off" spellCheck={false} />
          </label>
          <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password"
            hint="12+ characters" />
          <StrengthMeter value={password} />
          <PasswordField id="confirm" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {mismatch && <span className="err-text">The passwords don’t match.</span>}
          <button className="btn primary" disabled={busy || !token || !email || [...password].length < 12 || confirm !== password}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  );
}
