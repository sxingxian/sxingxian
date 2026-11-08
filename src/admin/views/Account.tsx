import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { encode } from 'uqr';
import { api, errorText } from '../api';
import { relTime, useToast } from '../components/ui';
import { PasswordField, StrengthMeter } from '../auth/fields';

interface Overview {
  profile: { email: string; name: string; role: string; totp_enabled: boolean; last_login_at: string | null; password_changed_at: string; created_at: string };
  totp: { enabled: boolean; available: boolean; unavailableReason: string; recoveryCodesLeft: number };
  sessions: { id: string; current: boolean; created_at: string; last_seen_at: string; ip: string; user_agent: string }[];
  events: { event: string; ok: boolean; ip: string; user_agent: string; at: string }[];
}

function device(ua: string): string {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export default function Account({ mustChangePassword, onPasswordChanged }: { mustChangePassword: boolean; onPasswordChanged: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const welcome = new URLSearchParams(window.location.search).get('welcome') === '1';

  const load = useCallback(() => {
    if (mustChangePassword) return;
    api.get<Overview>('/api/admin/account').then(setData).catch((e) => setErr(errorText(e)));
  }, [mustChangePassword]);
  useEffect(load, [load]);

  return (
    <>
      <div className="topbar"><div className="crumbs"><b>Account</b></div></div>
      <div className="page" style={{ maxWidth: 760 }}>
        <h1>Account</h1>
        {mustChangePassword && <div className="alert warn" style={{ marginBottom: 16 }}>You signed in with a temporary password. Choose your own password to continue.</div>}
        {welcome && !mustChangePassword && <div className="alert ok" style={{ marginBottom: 16 }}>Your owner account is ready. Turn on two-step sign-in below, then delete the setup token from the Worker’s settings in Cloudflare.</div>}
        {err && <div className="alert err">{err}</div>}
        <div className="stack">
          <PasswordCard mustChange={mustChangePassword} onDone={() => { onPasswordChanged(); load(); }} />
          {data && (
            <>
              <TwoStepCard data={data} reload={load} />
              <SessionsCard data={data} reload={load} />
              <ActivityCard data={data} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PasswordCard({ mustChange, onDone }: { mustChange: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/api/admin/account/password', { current, next });
      setCurrent(''); setNext(''); setConfirm('');
      toast('Password changed. Other devices were signed out.');
      onDone();
    } catch (e2) {
      setErr(errorText(e2));
    }
    setBusy(false);
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <div><div className="lbl">Password</div><p className="muted" style={{ margin: '4px 0 0' }}>Changing it signs out every other device.</p></div>
      {err && <div className="alert err" role="alert">{err}</div>}
      <PasswordField id="pw-current" label={mustChange ? 'Temporary password' : 'Current password'} value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField id="pw-next" label="New password" value={next} onChange={setNext} autoComplete="new-password" hint="At least 12 characters. A few unrelated words works well." />
      <StrengthMeter value={next} />
      <PasswordField id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {mismatch && <span className="err-text">The passwords don’t match.</span>}
      <div><button className="btn primary" disabled={busy || !current || [...next].length < 12 || next !== confirm}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
  );
}

function Qr({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => row.forEach((on, x) => { if (on) cells.push(`M${x} ${y}h1v1h-1z`); }));
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <path d={cells.join('')} fill="#1b1a18" />
    </svg>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `sxingxian admin recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'sxingxian-recovery-codes.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="stack">
      <div className="alert warn">Save these recovery codes somewhere safe, such as a password manager. Each one signs you in once if you lose your phone. They won’t be shown again.</div>
      <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row">
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button type="button" className="btn" onClick={download}>Download .txt</button>
        <button type="button" className="btn primary" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

function TwoStepCard({ data, reload }: { data: Overview; reload: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [regen, setRegen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };

  if (codes) return <div className="card stack"><div className="lbl">Two-step sign-in</div><RecoveryCodes codes={codes} onDone={() => { setCodes(null); reload(); }} /></div>;

  return (
    <div className="card stack">
      <div className="spread">
        <div><div className="lbl">Two-step sign-in</div><p className="muted" style={{ margin: '4px 0 0' }}>A 6-digit code from an authenticator app (1Password, Google Authenticator, Authy…) on top of your password.</p></div>
        <span className="pill" style={data.totp.enabled ? { color: 'var(--accent)', borderColor: '#cfe0da' } : {}}>{data.totp.enabled ? 'On' : 'Off'}</span>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}

      {!data.totp.enabled && !setup && (
        data.totp.available
          ? <div><button className="btn accent" disabled={busy} onClick={() => run(async () => setSetup(await api.post('/api/admin/account/totp-start')))}>Set up two-step sign-in</button></div>
          : <div className="alert warn">{data.totp.unavailableReason}</div>
      )}

      {!data.totp.enabled && setup && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/api/admin/account/totp-enable', { code }); setSetup(null); setCode(''); setCodes(r.recoveryCodes); toast('Two-step sign-in is on'); }); }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <Qr text={setup.uri} />
            <div className="stack" style={{ flex: '1 1 220px', gap: 10 }}>
              <span>1. Scan the code with your authenticator app.</span>
              <span className="muted">Can’t scan? Enter this key instead:</span>
              <span className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span>
              <span>2. Enter the 6-digit code it shows.</span>
            </div>
          </div>
          <input className="input code-input" style={{ maxWidth: 220 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="6-digit code" />
          <div className="row">
            <button className="btn primary" disabled={busy || code.length !== 6}>Turn on</button>
            <button type="button" className="btn" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
          </div>
        </form>
      )}

      {data.totp.enabled && !confirmOff && !regen && (
        <div className="spread">
          <span className="muted">{data.totp.recoveryCodesLeft} of 10 recovery codes left.</span>
          <div className="row">
            <button className="btn small" onClick={() => setRegen(true)}>New recovery codes</button>
            <button className="btn small danger" onClick={() => setConfirmOff(true)}>Turn off</button>
          </div>
        </div>
      )}

      {data.totp.enabled && regen && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/api/admin/account/recovery-codes', { password }); setPassword(''); setRegen(false); setCodes(r.recoveryCodes); }); }}>
          <span className="muted">Your old recovery codes stop working.</span>
          <PasswordField id="regen-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="row"><button className="btn primary" disabled={busy || !password}>Create new codes</button><button type="button" className="btn" onClick={() => { setRegen(false); setPassword(''); }}>Cancel</button></div>
        </form>
      )}

      {data.totp.enabled && confirmOff && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/api/admin/account/totp-disable', { password, code }); setPassword(''); setCode(''); setConfirmOff(false); toast('Two-step sign-in is off'); reload(); }); }}>
          <span className="muted">Your account will be protected by your password only.</span>
          <PasswordField id="off-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <label className="field" htmlFor="off-code">Authenticator or recovery code
            <input id="off-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} />
          </label>
          <div className="row"><button className="btn danger" disabled={busy || !password || !code}>Turn off two-step sign-in</button><button type="button" className="btn" onClick={() => { setConfirmOff(false); setPassword(''); setCode(''); }}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

function SessionsCard({ data, reload }: { data: Overview; reload: () => void }) {
  const toast = useToast();
  const others = data.sessions.filter((s) => !s.current).length;
  const revoke = async (id: string) => {
    try { await api.del(`/api/admin/account/sessions/${id}`); toast('Signed out'); reload(); } catch (e) { toast(errorText(e)); }
  };
  const revokeAll = async () => {
    try { await api.post('/api/admin/account/revoke-others'); toast('Signed out of all other devices'); reload(); } catch (e) { toast(errorText(e)); }
  };
  return (
    <div className="card stack">
      <div className="spread">
        <div className="lbl">Signed-in devices</div>
        {others > 0 && <button className="btn small" onClick={revokeAll}>Sign out all others</button>}
      </div>
      <div className="list">
        {data.sessions.map((s) => (
          <div key={s.id}>
            <span><b style={{ fontWeight: 500 }}>{device(s.user_agent)}</b>{s.current && <span className="pill" style={{ marginLeft: 8 }}>This device</span>}<br />
              <span className="muted">{s.ip || 'unknown IP'} · signed in {relTime(s.created_at)} · active {relTime(s.last_seen_at)}</span></span>
            {!s.current && <button className="btn small" onClick={() => revoke(s.id)}>Sign out</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ data }: { data: Overview }) {
  return (
    <div className="card stack">
      <div className="lbl">Recent activity</div>
      {data.events.length === 0 ? <span className="muted">Nothing yet.</span> : (
        <div className="list">
          {data.events.map((e, i) => (
            <div key={i}>
              <span><span className="dot" style={{ background: e.ok ? '#3d8a6f' : '#c4552f', marginRight: 8 }} />{e.event}<br />
                <span className="muted">{device(e.user_agent)} · {e.ip || 'unknown IP'}</span></span>
              <span className="muted">{relTime(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
