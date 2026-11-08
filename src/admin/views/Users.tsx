import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, errorText } from '../api';
import { relTime, useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import { Page, Panel, Row, Segmented, Empty } from '../components/kit';

interface UserRow {
  id: string; email: string; name: string; role: 'owner' | 'admin'; disabled: boolean; totp_enabled: boolean;
  must_change_password: boolean; last_login_at: string | null; created_at: string; locked: boolean; sessions: number;
}

function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Panel title="Temporary password" desc={`For ${email}. Shown once — send it privately.`}>
      <Row label="Password" hint="They set their own at first sign-in">
        <div className="secret" style={{ fontSize: 16 }}>{password}</div>
      </Row>
      <div className="save-bar">
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(password)}>Copy</button>
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Panel>
  );
}

const ROLES = [['admin', 'Admin'], ['owner', 'Owner']] as const;

export default function Users({ meId }: { meId: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const toast = useToast();
  const dialog = useDialog();

  const load = useCallback(() => {
    api.get<{ users: UserRow[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setErr(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const cancel = () => { setAdding(false); setEmail(''); setName(''); setRole('admin'); };
  const add = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ temporaryPassword: string }>('/api/admin/users', { email, name, role });
      setTemp({ email, password: r.temporaryPassword });
      cancel();
      load();
    } catch (e2) { toast(errorText(e2)); }
    setBusy(false);
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
    <Page title="Users" width="narrow" sub="Who can sign in to the admin. Owners also manage users."
      actions={!adding && <button type="button" className="btn primary" onClick={() => setAdding(true)}>Add user</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      {temp && <TempPassword email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
      {adding && (
        <Panel title="New user" desc="They get a temporary password to change at first sign-in.">
          <form onSubmit={add}>
            <Row label="Email" htmlFor="nu-email">
              <input id="nu-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoCapitalize="off" spellCheck={false} autoComplete="off" />
            </Row>
            <Row label="Name" hint="Optional" htmlFor="nu-name">
              <input id="nu-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
            </Row>
            <Row label="Role" hint={role === 'owner' ? 'Can add and remove users' : 'Can edit content and settings'}>
              <Segmented label="Role" value={role} options={ROLES} onChange={setRole} />
            </Row>
            <div className="save-bar">
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!email || busy}>{busy ? 'Creating…' : 'Create user'}</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="People" desc={users ? `${users.length} ${users.length === 1 ? 'account' : 'accounts'}` : undefined} flush>
        {users === null ? <Empty>Loading…</Empty> : (
          <div className="list-rows">
            {users.map((u) => {
              const self = u.id === meId;
              const expanded = open === u.id;
              return (
                <div key={u.id} className="list-row user-row">
                  <div className="user-main">
                    <span>
                      <b style={{ fontWeight: 500 }}>{u.name || u.email}</b>{self && <span className="pill" style={{ marginLeft: 8 }}>You</span>}
                      <span className="meta" style={{ display: 'block' }}>{u.email} · {u.last_login_at ? `last in ${relTime(u.last_login_at)}` : 'never signed in'}</span>
                      <span className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className="pill">{u.role === 'owner' ? 'Owner' : 'Admin'}</span>
                        {u.disabled && <span className="pill bad">Disabled</span>}
                        {u.locked && <span className="pill bad">Locked</span>}
                        {u.totp_enabled ? <span className="pill ok">2-step</span> : <span className="pill">No 2-step</span>}
                        {u.must_change_password && <span className="pill">Temp password</span>}
                      </span>
                    </span>
                    {!self && (
                      <button type="button" className="btn small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : u.id)}>{expanded ? 'Close' : 'Manage'}</button>
                    )}
                  </div>
                  {expanded && !self && (
                    <div className="user-actions">
                      {u.locked && <button type="button" className="btn small" onClick={() => patch(u, { unlock: true })}>Unlock</button>}
                      <button type="button" className="btn small" onClick={() => patch(u, { role: u.role === 'owner' ? 'admin' : 'owner' })}>{u.role === 'owner' ? 'Make admin' : 'Make owner'}</button>
                      <button type="button" className="btn small" onClick={() => patch(u, { resetPassword: true }, { title: `Reset password for ${u.email}?`, body: 'They’ll be signed out and get a new temporary password.', label: 'Reset' })}>Reset password</button>
                      {u.totp_enabled && <button type="button" className="btn small" onClick={() => patch(u, { reset2fa: true }, { title: `Reset 2-step for ${u.email}?`, body: 'Only if they’ve lost their phone and recovery codes.', label: 'Reset' })}>Reset 2-step</button>}
                      <button type="button" className="btn small danger" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? undefined : { title: `Disable ${u.email}?`, body: 'They’ll be signed out straight away.', label: 'Disable' })}>{u.disabled ? 'Enable' : 'Disable'}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Page>
  );
}
