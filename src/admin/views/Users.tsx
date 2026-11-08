import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, errorText } from '../api';
import { relTime, useToast } from '../components/ui';

interface UserRow {
  id: string; email: string; name: string; role: 'owner' | 'admin'; disabled: boolean; totp_enabled: boolean;
  must_change_password: boolean; last_login_at: string | null; created_at: string; locked: boolean; sessions: number;
}

function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <div className="card stack" style={{ borderColor: '#efe0b5' }}>
      <div className="lbl">Temporary password for {email}</div>
      <div className="secret" style={{ fontSize: 16 }}>{password}</div>
      <span className="muted">Send it to them privately (not in the same message as the sign-in link if you can). It’s shown only now. They must choose their own password when they first sign in at sxingxian.com/admin.</span>
      <div className="row">
        <button className="btn" onClick={() => navigator.clipboard?.writeText(password)}>Copy</button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function Users({ meId }: { meId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get<{ users: UserRow[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setErr(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const add = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const r = await api.post<{ temporaryPassword: string }>('/api/admin/users', { email, name, role });
      setTemp({ email, password: r.temporaryPassword });
      setAdding(false); setEmail(''); setName(''); setRole('admin');
      load();
    } catch (e2) { toast(errorText(e2)); }
  };

  const patch = async (u: UserRow, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const r = await api.patch<{ temporaryPassword?: string }>(`/api/admin/users/${u.id}`, body);
      if (r.temporaryPassword) setTemp({ email: u.email, password: r.temporaryPassword });
      else toast('Saved');
      load();
    } catch (e) { toast(errorText(e)); }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><b>Users</b></div>
        <div className="actions"><button className="btn primary" onClick={() => setAdding(true)}>Add user</button></div>
      </div>
      <div className="page" style={{ maxWidth: 900 }}>
        <h1>Users</h1>
        <p className="muted">Everyone here can write and publish. Owners can also add, reset and disable users. There’s no public sign-up.</p>
        {err && <div className="alert err">{err}</div>}
        <div className="stack">
          {temp && <TempPassword email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
          {adding && (
            <form className="card stack" onSubmit={add}>
              <div className="lbl">New user</div>
              <div className="grid2">
                <label className="field">Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoCapitalize="off" spellCheck={false} /></label>
                <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
              </div>
              <label className="field" style={{ maxWidth: 240 }}>Role
                <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'owner')}>
                  <option value="admin">Admin: write and publish</option>
                  <option value="owner">Owner: also manage users</option>
                </select>
              </label>
              <span className="muted">A temporary password is created and shown once.</span>
              <div className="row"><button className="btn primary" disabled={!email}>Create user</button><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
            </form>
          )}
          <div className="table-box">
            <div className="list" style={{ padding: '4px 16px' }}>
              {users.map((u) => {
                const self = u.id === meId;
                return (
                  <div key={u.id}>
                    <span>
                      <b style={{ fontWeight: 500 }}>{u.name || u.email}</b>{self && <span className="pill" style={{ marginLeft: 8 }}>You</span>}<br />
                      <span className="muted">{u.email}</span>
                      <span className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className="pill">{u.role}</span>
                        {u.disabled && <span className="pill" style={{ color: 'var(--danger)' }}>disabled</span>}
                        {u.locked && <span className="pill" style={{ color: 'var(--danger)' }}>locked</span>}
                        <span className="pill">{u.totp_enabled ? '2-step on' : '2-step off'}</span>
                        {u.must_change_password && <span className="pill">temporary password</span>}
                        <span className="muted">last sign-in {relTime(u.last_login_at)}</span>
                      </span>
                    </span>
                    {!self && (
                      <span className="row" style={{ gap: 6 }}>
                        {u.locked && <button className="btn small" onClick={() => patch(u, { unlock: true })}>Unlock</button>}
                        <button className="btn small" onClick={() => patch(u, { role: u.role === 'owner' ? 'admin' : 'owner' })}>{u.role === 'owner' ? 'Make admin' : 'Make owner'}</button>
                        <button className="btn small" onClick={() => patch(u, { resetPassword: true }, `Reset ${u.email}'s password? They'll be signed out and need the new temporary password.`)}>Reset password</button>
                        {u.totp_enabled && <button className="btn small" onClick={() => patch(u, { reset2fa: true }, `Turn off two-step sign-in for ${u.email}? Only do this if they lost their phone and recovery codes.`)}>Reset 2-step</button>}
                        <button className="btn small danger" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? undefined : `Disable ${u.email}? They'll be signed out immediately.`)}>{u.disabled ? 'Enable' : 'Disable'}</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
