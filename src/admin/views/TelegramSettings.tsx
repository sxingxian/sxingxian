// Settings → Telegram: connect the bot (the token is stored encrypted on the server and never shown again),
// the channels it posts to and what each gets, the default message and the button text.
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import { Field, Loading, Panel, SaveBar, ToggleRow } from '../components/kit';
import { TELEGRAM_CHAT_RE } from '../../lib/shared/schemas';
import type { EntryKind, TelegramChannel, TelegramSetting } from '../../lib/shared/types';

const KIND_SECTION_LABEL: Record<EntryKind, string> = { post: 'Stories', project: 'Work', gallery: 'Photos', film: 'Film' };

interface Status { available: boolean; connected: boolean; username: string | null }
interface Check { chat: string; title: string; canPost: boolean; reason: string }
const KINDS: EntryKind[] = ['post', 'project', 'gallery', 'film'];

export default function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [t, setT] = useState<TelegramSetting | null>(null);
  const [saved, setSaved] = useState<TelegramSetting | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const dialog = useDialog();

  const check = async (c: string) => {
    try {
      const r = await api.post<Check>('/api/admin/telegram/channel', { chat: c, action: 'check' });
      setChecks((cur) => ({ ...cur, [c]: r }));
      return r;
    } catch (e) {
      toast(errorText(e));
      return null;
    }
  };

  useEffect(() => {
    Promise.all([api.get<Status>('/api/admin/telegram'), api.get<{ value: TelegramSetting }>('/api/admin/settings/telegram')])
      .then(([s, r]) => {
        setStatus(s); setT(r.value); setSaved(r.value);
        if (s.connected) r.value.channels.forEach((c) => void check(c.chat));
      })
      .catch((e) => setErr(errorText(e)));
  }, []);
  if (!status || !t || !saved) return <Loading error={err} />;

  if (!status.available) {
    return <Panel title="Telegram"><p className="hint">Telegram needs a database update first: run “Deploy Neon” on GitHub (migration 0011), then reload this page.</p></Panel>;
  }

  const connect = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ username: string }>('/api/admin/telegram/bot', { token: token.trim() });
      setStatus({ ...status, connected: true, username: r.username });
      setToken(''); setReplacing(false);
      toast(`Connected as @${r.username}`);
      t.channels.forEach((c) => void check(c.chat));
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };
  const disconnect = async () => {
    if (!(await dialog.confirm({ title: 'Disconnect the bot?', body: 'Nothing is posted to Telegram until you connect a bot again. Your channels and message stay.', confirmLabel: 'Disconnect', danger: true }))) return;
    try {
      await api.del('/api/admin/telegram/bot');
      setStatus({ ...status, connected: false, username: null });
      toast('Bot disconnected');
    } catch (e) { toast(errorText(e)); }
  };

  const tokenForm = (
    <>
      <ol className="tg-steps">
        <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code> and follow the steps.</li>
        <li>Copy the token it gives you and paste it below.</li>
        <li>Add the bot to your channel as an admin with “Post messages”.</li>
      </ol>
      <Field label="Bot token" htmlFor="tg-token" hint="Stored encrypted on the server. It’s never shown again.">
        <input id="tg-token" className="input" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && token.trim()) void connect(); }} />
      </Field>
      <div className="tg-actions">
        <button type="button" className="btn primary" disabled={busy || !token.trim()} onClick={() => void connect()}>{busy ? 'Checking…' : 'Connect bot'}</button>
        {replacing && <button type="button" className="btn" onClick={() => { setReplacing(false); setToken(''); }}>Cancel</button>}
      </div>
    </>
  );

  if (!status.connected) {
    return <Panel title="Announce new posts on Telegram" desc="Connect a bot once, then pick the channels it posts to.">{tokenForm}</Panel>;
  }

  const setChannel = (i: number, c: TelegramChannel) => setT({ ...t, channels: t.channels.map((x, j) => (j === i ? c : x)) });
  const addChannel = async () => {
    const c = chat.trim();
    if (!TELEGRAM_CHAT_RE.test(c)) { toast('A channel is @name, or a private channel’s -100… id'); return; }
    if (t.channels.some((x) => x.chat === c)) { toast('That channel is already on the list'); return; }
    setBusy(true);
    const r = await check(c);
    setBusy(false);
    if (!r) return;
    setT({ ...t, channels: [...t.channels, { chat: c, title: r.title, kinds: [...KINDS], addedAt: new Date().toISOString() }] });
    setChat('');
    if (!r.canPost) toast('Added. The bot can’t post there yet: make it an admin, then check again.');
  };
  const test = async (c: string) => {
    try { await api.post('/api/admin/telegram/channel', { chat: c, action: 'test' }); toast('Test message sent'); } catch (e) { toast(errorText(e)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ value: TelegramSetting }>('/api/admin/settings/telegram', t);
      setT(r.value); setSaved(r.value);
      toast('Saved');
    } catch (e) { toast(errorText(e)); }
    setBusy(false);
  };
  const dirty = JSON.stringify(t) !== JSON.stringify(saved);

  return (
    <>
      <Panel title="Bot">
        {replacing ? tokenForm : (
          <>
            <div className="tg-connected">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--accent)' }}><path d="M3 8.5l3.2 3L13 4.5" /></svg>
              <span>Connected as <b>@{status.username}</b></span>
            </div>
            <div className="tg-actions">
              <button type="button" className="btn" onClick={() => setReplacing(true)}>Replace token</button>
              <button type="button" className="btn danger" onClick={() => void disconnect()}>Disconnect</button>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Channels" desc="Choose what each channel gets. A new channel only gets posts published after you add it.">
        {t.channels.length === 0 && <p className="hint">No channels yet.</p>}
        {t.channels.map((c, i) => {
          const k = checks[c.chat];
          return (
            <div key={c.chat} className={`tg-channel${k && !k.canPost ? ' bad' : ''}`}>
              <div className="tg-channel-head"><b>{k?.title || c.title || c.chat}</b><span className="hint">{c.chat}</span></div>
              {k ? (k.canPost ? <span className="tg-ok">The bot can post here.</span> : <span className="tg-bad">{k.reason}</span>) : <span className="hint">Checking…</span>}
              <div className="tg-kinds" role="group" aria-label={`What ${c.title || c.chat} gets`}>
                {KINDS.map((kind) => {
                  const on = c.kinds.includes(kind);
                  return <button key={kind} type="button" aria-pressed={on} onClick={() => setChannel(i, { ...c, kinds: on ? c.kinds.filter((x) => x !== kind) : [...c.kinds, kind] })}>{KIND_SECTION_LABEL[kind]}</button>;
                })}
              </div>
              <div className="tg-actions">
                {k?.canPost ? <button type="button" className="btn small" onClick={() => void test(c.chat)}>Send a test</button>
                  : <button type="button" className="btn small" onClick={() => void check(c.chat)}>Check again</button>}
                <button type="button" className="btn small" onClick={() => setT({ ...t, channels: t.channels.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            </div>
          );
        })}
        {t.channels.length < 10 && (
          <Field label="Add a channel" htmlFor="tg-chat" hint="A public @name, or a private channel’s ID (-100…).">
            <div className="tg-actions" style={{ flexWrap: 'nowrap' }}>
              <input id="tg-chat" className="input" placeholder="@channelname" value={chat} autoComplete="off" spellCheck={false}
                onChange={(e) => setChat(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') void addChannel(); }} />
              <button type="button" className="btn" disabled={busy || !chat} onClick={() => void addChannel()}>Add</button>
            </div>
          </Field>
        )}
      </Panel>
      <Panel title="Default message" desc="Used unless a post has its own message.">
        <Field label="Message" htmlFor="tg-template" hint="Fill-ins: {title} {excerpt} {topics} {series}. Formatting: **bold**, _italic_, [link](https://…).">
          <textarea id="tg-template" className="input tg-text" rows={4} maxLength={2000} value={t.template} onChange={(e) => setT({ ...t, template: e.target.value })} />
        </Field>
        <ToggleRow label="Attach the cover image" hint="Text only when there’s no cover" checked={t.attachImage} onChange={(attachImage) => setT({ ...t, attachImage })} />
        <span className="field-l">Button</span>
        <div className="tg-buttons">
          {KINDS.map((kind) => (
            <Field key={kind} label={KIND_SECTION_LABEL[kind]} htmlFor={`tg-btn-${kind}`}>
              <input id={`tg-btn-${kind}`} className="input" maxLength={40} value={t.buttons[kind]} onChange={(e) => setT({ ...t, buttons: { ...t.buttons, [kind]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </Panel>
      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} />
    </>
  );
}
