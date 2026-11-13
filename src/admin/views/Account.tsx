import { useCallback, useEffect, useRef, useState } from 'react';
import { encode } from 'uqr';
import { api, errorText } from '../api';
import { relTime, useToast } from '../components/ui';
import { Page, Panel, Row, SaveBar } from '../components/kit';
import { Pager, usePaging } from '../components/Pager';
import { pageCount } from '../../lib/shared/paging';
import { PasswordField, StrengthMeter } from '../auth/fields';

interface Overview {
  profile: { email: string; name: string; role: string; totp_enabled: boolean; last_login_at: string | null; password_changed_at: string; created_at: string };
  totp: { enabled: boolean; available: boolean; unavailableReason: string; recoveryCodesLeft: number };
  sessions: { id: string; current: boolean; created_at: string; last_seen_at: string; ip: string; user_agent: string }[];
}
interface ActivityEvent { event: string; ok: boolean; ip: string; user_agent: string; at: string }

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
    <Page title="Account" section="account" width="narrow" sub={data ? `${data.profile.email} · ${data.profile.role}` : undefined}>
      {mustChangePassword && <div className="alert warn">Set your own password to continue.</div>}
      {welcome && !mustChangePassword && <div className="alert ok">Account ready. Turn on 2-step below, then delete the setup token in Cloudflare.</div>}
      {err && <div className="alert err" role="alert">{err}</div>}
      {data && <ProfilePanel data={data} reload={load} />}
      <PasswordPanel mustChange={mustChangePassword} onDone={() => { onPasswordChanged(); load(); }} />
      {data && (
        <>
          <TwoStepPanel data={data} reload={load} />
          <DevicesPanel data={data} reload={load} />
          <ActivityPanel stamp={data} />
        </>
      )}
    </Page>
  );
}

function ProfilePanel({ data, reload }: { data: Overview; reload: () => void }) {
  const [name, setName] = useState(data.profile.name);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try { await api.patch('/api/admin/account', { name }); toast('Saved'); reload(); } catch (e) { toast(errorText(e)); }
    setBusy(false);
  };
  return (
    <Panel title="Profile">
      <Row label="Name" hint="Shown in the admin" htmlFor="acc-name">
        <input id="acc-name" className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </Row>
      <Row label="Email" hint="Sign-in address"><span className="mono" style={{ paddingTop: 8 }}>{data.profile.email}</span></Row>
      <SaveBar dirty={name.trim() !== data.profile.name} busy={busy} onSave={save} />
    </Panel>
  );
}

function PasswordPanel({ mustChange, onDone }: { mustChange: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = !!current && [...next].length >= 12 && next === confirm;

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/api/admin/account/password', { current, next });
      setCurrent(''); setNext(''); setConfirm('');
      toast('Password changed. Other devices were signed out.');
      onDone();
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  };

  return (
    <Panel title="Password" desc="Changing it signs out your other devices.">
      <form onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
        <Row label={mustChange ? 'Temporary password' : 'Current password'} htmlFor="pw-current">
          <PasswordField bare id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        </Row>
        <Row label="New password" hint="12+ characters" htmlFor="pw-next">
          <PasswordField bare id="pw-next" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
          <StrengthMeter value={next} />
        </Row>
        <Row label="Confirm" htmlFor="pw-confirm">
          <PasswordField bare id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {mismatch && <span className="err-text">The passwords don’t match.</span>}
        </Row>
        <SaveBar dirty={!!(current || next || confirm)} busy={busy} onSave={save} label="Change password" disabled={!ready} error={err || undefined} />
      </form>
    </Panel>
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
      <div className="alert warn">Save these now. Each works once if you lose your phone.</div>
      <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row">
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
        <button type="button" className="btn" onClick={download}>Download .txt</button>
        <button type="button" className="btn primary" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

function TwoStepPanel({ data, reload }: { data: Overview; reload: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'off' | 'regen'>('idle');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };
  const reset = () => { setMode('idle'); setPassword(''); setCode(''); };

  return (
    <Panel title="2-step sign-in" desc="A code from an authenticator app at sign-in."
      actions={<span className={`pill${data.totp.enabled ? ' ok' : ''}`}>{data.totp.enabled ? 'On' : 'Off'}</span>}>
      {err && <div className="alert err" role="alert" style={{ marginTop: 12 }}>{err}</div>}

      {codes ? (
        <Row label="Recovery codes"><RecoveryCodes codes={codes} onDone={() => { setCodes(null); reload(); }} /></Row>
      ) : !data.totp.enabled ? (
        setup ? (
          <>
            <Row label="1. Scan" hint="With your authenticator app">
              <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <Qr text={setup.uri} />
                <div className="stack" style={{ gap: 6, flex: '1 1 180px' }}>
                  <span className="muted">Or enter this key</span>
                  <span className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span>
                </div>
              </div>
            </Row>
            <Row label="2. Enter code" htmlFor="totp-code">
              <input id="totp-code" className="input code-input" style={{ maxWidth: 220 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
            </Row>
            <div className="save-bar">
              <button type="button" className="btn" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy || code.length !== 6}
                onClick={() => run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/api/admin/account/totp-enable', { code }); setSetup(null); setCode(''); setCodes(r.recoveryCodes); toast('2-step sign-in is on'); })}>Turn on</button>
            </div>
          </>
        ) : (
          <Row label="Status" hint="Recommended for every account">
            {data.totp.available
              ? <div><button type="button" className="btn accent" disabled={busy} onClick={() => run(async () => setSetup(await api.post('/api/admin/account/totp-start')))}>Set up</button></div>
              : <div className="alert warn">{data.totp.unavailableReason}</div>}
          </Row>
        )
      ) : mode === 'idle' ? (
        <Row label="Recovery codes" hint={`${data.totp.recoveryCodesLeft}/10 left`}>
          <div className="row">
            <button type="button" className="btn small" onClick={() => setMode('regen')}>New codes</button>
            <button type="button" className="btn small danger" onClick={() => setMode('off')}>Turn off 2-step</button>
          </div>
        </Row>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'regen') void run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/api/admin/account/recovery-codes', { password }); reset(); setCodes(r.recoveryCodes); });
          else void run(async () => { await api.post('/api/admin/account/totp-disable', { password, code }); reset(); toast('2-step sign-in is off'); reload(); });
        }}>
          <Row label="Password" hint={mode === 'regen' ? 'Old codes stop working' : 'Confirm it’s you'} htmlFor="tf-pw">
            <PasswordField bare id="tf-pw" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          </Row>
          {mode === 'off' && (
            <Row label="Code" hint="Authenticator or recovery code" htmlFor="tf-code">
              <input id="tf-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} />
            </Row>
          )}
          <div className="save-bar">
            <button type="button" className="btn" onClick={reset}>Cancel</button>
            <button type="submit" className={`btn ${mode === 'off' ? 'danger-solid' : 'primary'}`} disabled={busy || !password || (mode === 'off' && !code)}>
              {mode === 'off' ? 'Turn off' : 'Create new codes'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function DevicesPanel({ data, reload }: { data: Overview; reload: () => void }) {
  const toast = useToast();
  const others = data.sessions.filter((s) => !s.current).length;
  const revoke = async (id: string) => {
    try { await api.del(`/api/admin/account/sessions/${id}`); toast('Signed out'); reload(); } catch (e) { toast(errorText(e)); }
  };
  const revokeAll = async () => {
    try { await api.post('/api/admin/account/revoke-others'); toast('Signed out of all other devices'); reload(); } catch (e) { toast(errorText(e)); }
  };
  return (
    <Panel title="Devices" desc={`${data.sessions.length} signed in`} flush
      actions={others > 0 && <button type="button" className="btn small" onClick={revokeAll}>Sign out others</button>}>
      <div className="list-rows">
        {data.sessions.map((s) => (
          <div key={s.id} className="list-row">
            <span>
              <b style={{ fontWeight: 500 }}>{device(s.user_agent)}</b>{s.current && <span className="pill ok" style={{ marginLeft: 8 }}>This device</span>}
              <span className="meta" style={{ display: 'block' }}>{s.ip || '—'} · active {relTime(s.last_seen_at)}</span>
            </span>
            {!s.current && <button type="button" className="btn small" onClick={() => revoke(s.id)}>Sign out</button>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Sign-ins and security changes, 10 a page. `stamp` changes whenever the account reloads (a new event may exist). */
function ActivityPanel({ stamp }: { stamp: Overview }) {
  const paging = usePaging('account-activity');
  const [rows, setRows] = useState<{ events: ActivityEvent[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    api.get<{ events: ActivityEvent[]; total: number }>(`/api/admin/account/activity?page=${paging.page}&size=${paging.size}`).then((r) => {
      if (mine !== seq.current) return;
      if (r.events.length === 0 && r.total > 0 && paging.page > 1) { paging.setPage(pageCount(r.total, paging.size)); return; }
      setRows(r); setErr(''); setLoading(false);
    }).catch((e) => { if (mine === seq.current) { setErr(errorText(e)); setLoading(false); } });
  }, [paging, stamp]);
  return (
    <Panel title="Activity" desc="Sign-ins and security changes, kept for 180 days" flush>
      {err && <div className="empty">{err}</div>}
      {!rows ? (!err && <div className="empty">Loading…</div>) : rows.events.length === 0 ? <div className="empty">Nothing yet.</div> : (
        <div className={`list-rows${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          {rows.events.map((e, i) => (
            <div key={`${e.at}-${i}`} className="list-row">
              <span><span className={`dot ${e.ok ? 'good' : 'bad'}`} aria-hidden="true" style={{ marginRight: 8 }} />{e.event.charAt(0).toUpperCase() + e.event.slice(1)}{!e.ok && <span className="sr-only"> (failed)</span>}
                <span className="meta" style={{ display: 'block', paddingLeft: 18 }}>{device(e.user_agent)} · {e.ip || '—'}</span></span>
              <span className="meta">{relTime(e.at)}</span>
            </div>
          ))}
        </div>
      )}
      {rows && <Pager paging={paging} total={rows.total} label="Activity pages" />}
    </Panel>
  );
}
