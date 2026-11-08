import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, errorText } from '../api';
import { relTime, useToast } from '../components/ui';
import { useDialog } from '../components/dialog';

interface UserRow {
  id: string; email: string; name: string; role: 'owner' | 'admin'; disabled: boolean; totp_enabled: boolean;
  must_change_password: boolean; last_login_at: string | null; created_at: string; locked: boolean; sessions: number;
}

function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <div className="card stack" style={{ borderColor: '#efe0b5' }}>
      <div className="lbl">Temporary password for {email}</div>
      <div className="secret" style={{ fontSize: 16 }}>{password}</div>
      <span className="muted">Shown once. Send it privately; they set their own at first sign-in.</span>
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
  const dialog = useDialog();

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

  const patch = async (u: UserRow, body: Record<string, unknown>, ask?: { title: string; body: string; label: string }) => {
    if (ask && !(await dialog.confirm({ title: ask.title, body: ask.body, confirmLabel: ask.label, danger: true }))) return;
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
                  <option value="admin">Admin</option>
                  <option value="owner">Owner (manages users)</option>
                </select>
              </label>
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
                        {!u.totp_enabled && <span className="pill">no 2-step</span>}
                        {u.must_change_password && <span className="pill">temp password</span>}
                        <span className="muted">{relTime(u.last_login_at)}</span>
                      </span>
                    </span>
                    {!self && (
                      <span className="row" style={{ gap: 6 }}>
                        {u.locked && <button className="btn small" onClick={() => patch(u, { unlock: true })}>Unlock</button>}
                        <button className="btn small" onClick={() => patch(u, { role: u.role === 'owner' ? 'admin' : 'owner' })}>{u.role === 'owner' ? 'Make admin' : 'Make owner'}</button>
                        <button className="btn small" onClick={() => patch(u, { resetPassword: true }, { title: `Reset password for ${u.email}?`, body: 'They’ll be signed out and get a new temporary password.', label: 'Reset' })}>Reset password</button>
                        {u.totp_enabled && <button className="btn small" onClick={() => patch(u, { reset2fa: true }, { title: `Reset 2-step for ${u.email}?`, body: 'Only if they’ve lost their phone and recovery codes.', label: 'Reset' })}>Reset 2-step</button>}
                        <button className="btn small danger" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? undefined : { title: `Disable ${u.email}?`, body: 'They’ll be signed out straight away.', label: 'Disable' })}>{u.disabled ? 'Enable' : 'Disable'}</button>
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
