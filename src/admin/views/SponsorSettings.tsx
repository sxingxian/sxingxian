// Settings → Sponsor: where the invitation shows, the amounts (SGD), the words, and connecting Stripe and PayPal.
// Keys are checked with the provider, then stored encrypted on the server; they're never sent back here.
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import { Field, Loading, Panel, SaveBar, Segmented, ToggleRow } from '../components/kit';
import { formatMoney, parseMoney } from '../../lib/shared/sponsor';
import { PAYPAL_ID_RE, PAYPAL_ME_RE, STRIPE_KEY_RE } from '../../lib/shared/schemas';
import { whenLabel } from '../../lib/shared/state';
import { paypalVia, type EntryKind, type SponsorSetting } from '../../lib/shared/types';

const KINDS: [EntryKind, string][] = [['post', 'Stories'], ['project', 'Work'], ['gallery', 'Photos'], ['film', 'Film']];

interface ProviderStatus { connected: boolean; mode: 'live' | 'test' | null; account: string; hint: string; connectedAt: string | null; lastPaidAt: string | null }
interface Status { available: boolean; stripe: ProviderStatus; paypal: ProviderStatus }

const dollars = (c: number) => (c / 100).toFixed(c % 100 ? 2 : 0);

export default function SponsorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [s, setS] = useState<SponsorSetting | null>(null);
  const [saved, setSaved] = useState<SponsorSetting | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const toast = useToast();

  useEffect(() => {
    Promise.all([api.get<Status>('/api/admin/sponsor'), api.get<{ value: SponsorSetting }>('/api/admin/settings/sponsor')])
      .then(([st, r]) => { setStatus(st); setS(r.value); setSaved(r.value); setMinText(dollars(r.value.min)); setMaxText(dollars(r.value.max)); })
      .catch((e) => setErr(errorText(e)));
  }, []);
  if (!status || !s || !saved) return <Loading error={err} />;
  if (!status.available) {
    return <Panel title="Sponsor"><p className="hint">Sponsoring needs a database update first: run “Deploy Neon” on GitHub (migration 0012), then reload this page.</p></Panel>;
  }

  const anyMethod = status.stripe.connected || paypalVia({ ...saved, methods: { stripe: status.stripe.connected, paypal: status.paypal.connected } }) !== null;
  const problem = (() => {
    if (!s.amounts.length) return 'Add at least one amount';
    if (s.allowCustom && s.min >= s.max) return 'The minimum must be below the maximum';
    if ([s.cardTitle, s.cardText, s.pageTitle, s.pageText].some((x) => !x.trim())) return 'Fill in all the words';
    if (s.paypalMode === 'me' && s.paypalMe && !PAYPAL_ME_RE.test(s.paypalMe)) return 'A PayPal.Me name is letters and numbers, up to 20';
    return '';
  })();
  const dirty = JSON.stringify({ ...s, methods: null }) !== JSON.stringify({ ...saved, methods: null });

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ value: SponsorSetting }>('/api/admin/settings/sponsor', s);
      setS(r.value); setSaved(r.value);
      toast('Saved');
    } catch (e) { toast(errorText(e)); }
    setBusy(false);
  };

  const addAmount = () => {
    const c = parseMoney(adding ?? '');
    if (c === null || c < 100 || c > 1_000_000) { toast('Type an amount from S$1 to S$10,000, like 15 or 15.50'); return; }
    if (s.amounts.includes(c)) { toast('That amount is already there'); return; }
    setS({ ...s, amounts: [...s.amounts, c].sort((a, b) => a - b) });
    setAdding(null);
  };
  const removeAmount = (c: number) => {
    const amounts = s.amounts.filter((x) => x !== c);
    setS({ ...s, amounts, defaultAmount: s.defaultAmount === c ? (amounts[Math.floor(amounts.length / 2)] ?? 0) : s.defaultAmount });
  };
  const setLimit = (which: 'min' | 'max', text: string) => {
    const c = parseMoney(text);
    if (c === null || c < 100 || c > 1_000_000) { toast('Type an amount from S$1 to S$10,000'); (which === 'min' ? setMinText : setMaxText)(dollars(s[which])); return; }
    setS({ ...s, [which]: c });
    (which === 'min' ? setMinText : setMaxText)(dollars(c));
  };

  return (
    <>
      <Panel title="Show it" desc={anyMethod ? 'Off hides the page, the invitation and the footer link. Payments already made are kept.' : 'Nothing shows on the site until Stripe or PayPal is connected below.'}>
        <ToggleRow label="Sponsor page" hint="/sponsor" checked={s.enabled} onChange={(enabled) => setS({ ...s, enabled })} />
        <ToggleRow label="Invite at the end of a page" checked={s.storyCard} disabled={!s.enabled} onChange={(storyCard) => setS({ ...s, storyCard })} />
        {s.storyCard && s.enabled && (
          <div className="tg-kinds sp-kinds" role="group" aria-label="Pages that get the invitation">
            {KINDS.map(([k, label]) => {
              const on = s.cardKinds.includes(k);
              return <button key={k} type="button" aria-pressed={on} onClick={() => setS({ ...s, cardKinds: on ? s.cardKinds.filter((x) => x !== k) : [...s.cardKinds, k] })}>{label}</button>;
            })}
          </div>
        )}
        <ToggleRow label="“Sponsor” link in the footer" checked={s.footerLink} disabled={!s.enabled} onChange={(footerLink) => setS({ ...s, footerLink })} />
      </Panel>

      <Panel title="Amounts (SGD)" desc="Up to 4 to pick from. Click one to make it the default. Charged in Singapore dollars on both Stripe and PayPal.">
        <div className="sp-amounts" role="group" aria-label="Amounts">
          {s.amounts.map((c) => (
            <span key={c} className={`sp-amount${c === s.defaultAmount ? ' is-default' : ''}`}>
              <button type="button" className="sp-amount-pick" aria-pressed={c === s.defaultAmount} onClick={() => setS({ ...s, defaultAmount: c })}
                title={c === s.defaultAmount ? 'Picked by default' : 'Make this the default'}>
                {formatMoney(c)}{c === s.defaultAmount && <small>default</small>}
              </button>
              <button type="button" className="sp-amount-x" aria-label={`Remove ${formatMoney(c)}`} onClick={() => removeAmount(c)}>×</button>
            </span>
          ))}
          {adding === null ? (
            s.amounts.length < 4 && <button type="button" className="sp-amount-add" onClick={() => setAdding('')}>+ Add</button>
          ) : (
            <span className="sp-amount-new">
              <span aria-hidden="true">S$</span>
              <input className="input" autoFocus inputMode="decimal" aria-label="New amount in Singapore dollars" value={adding} maxLength={10}
                onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addAmount(); if (e.key === 'Escape') setAdding(null); }} />
              <button type="button" className="btn small primary" onClick={addAmount}>Add</button>
              <button type="button" className="btn small" onClick={() => setAdding(null)}>Cancel</button>
            </span>
          )}
        </div>
        <ToggleRow label="Let visitors type their own amount" checked={s.allowCustom} onChange={(allowCustom) => setS({ ...s, allowCustom })} />
        {s.allowCustom && (
          <div className="sp-limits">
            <Field label="Minimum" htmlFor="sp-min">
              <span className="sp-money"><span aria-hidden="true">S$</span><input id="sp-min" className="input" inputMode="decimal" value={minText} maxLength={10}
                onChange={(e) => setMinText(e.target.value)} onBlur={() => setLimit('min', minText)} /></span>
            </Field>
            <Field label="Maximum" htmlFor="sp-max">
              <span className="sp-money"><span aria-hidden="true">S$</span><input id="sp-max" className="input" inputMode="decimal" value={maxText} maxLength={10}
                onChange={(e) => setMaxText(e.target.value)} onBlur={() => setLimit('max', maxText)} /></span>
            </Field>
          </div>
        )}
      </Panel>

      <Panel title="Words">
        <div className="sp-words">
          <span className="field-l">End of a page</span>
          <div className="sp-words-c">
            <input className="input" aria-label="End of a page: heading" maxLength={80} value={s.cardTitle} onChange={(e) => setS({ ...s, cardTitle: e.target.value })} />
            <textarea className="input" aria-label="End of a page: text" rows={2} maxLength={300} value={s.cardText} onChange={(e) => setS({ ...s, cardText: e.target.value })} />
            <span className="field-hint">{'{this}'} becomes “this story”, “this work”, “these photos” or “this film”.</span>
          </div>
          <span className="field-l">Sponsor page</span>
          <div className="sp-words-c">
            <input className="input" aria-label="Sponsor page: heading" maxLength={80} value={s.pageTitle} onChange={(e) => setS({ ...s, pageTitle: e.target.value })} />
            <textarea className="input" aria-label="Sponsor page: text" rows={3} maxLength={600} value={s.pageText} onChange={(e) => setS({ ...s, pageText: e.target.value })} />
          </div>
        </div>
      </Panel>

      <div className="sp-providers">
        <StripePanel status={status.stripe} onStatus={setStatus} />
        <Panel title="PayPal" desc="How visitors pay you with PayPal.">
          <Segmented label="PayPal mode" value={s.paypalMode} onChange={(paypalMode) => setS({ ...s, paypalMode })} options={[['me', 'PayPal.Me link'], ['api', 'Business (API)']] as const} />
          {s.paypalMode === 'me' ? (
            <>
              <p className="hint sp-me-intro">Works with a personal PayPal account. No keys needed. PayPal doesn’t tell the site who paid, so each PayPal sponsor waits in <b>Sponsors → To check</b> until you mark it.</p>
              <Field label="Your PayPal.Me name" htmlFor="sp-me" hint="Find it in PayPal → Settings → PayPal.Me. Letters and numbers only.">
                <span className="sp-prefix"><span aria-hidden="true">paypal.me/</span><input id="sp-me" className="input" autoComplete="off" spellCheck={false} maxLength={20} value={s.paypalMe}
                  onChange={(e) => setS({ ...s, paypalMe: e.target.value.trim() })} /></span>
              </Field>
              {s.paypalMe && PAYPAL_ME_RE.test(s.paypalMe) && (
                <div className="tg-actions"><a className="btn" href={`https://www.paypal.com/paypalme/${encodeURIComponent(s.paypalMe)}`} target="_blank" rel="noopener noreferrer">Open my link to check ↗</a></div>
              )}
              <p className="sp-warn">Your PayPal.Me page shows your PayPal name and photo to anyone who opens it.</p>
              {saved.paypalMode !== 'me' && <span className="hint">Save to switch PayPal to this link.</span>}
            </>
          ) : (
            <>
              <PaypalPanel status={status.paypal} onStatus={setStatus} bare />
              {saved.paypalMode !== 'api' && <span className="hint">Save to switch PayPal to the business account.</span>}
            </>
          )}
        </Panel>
      </div>

      <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} error={dirty ? problem || undefined : undefined} disabled={!!problem} />
    </>
  );
}

function Connected({ p, name, onCheck, onReplace, onDisconnect }: { p: ProviderStatus; name: string; onCheck: () => void; onReplace: () => void; onDisconnect: () => void }) {
  return (
    <>
      <div className="sp-connected">
        <span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
          Connected{p.account ? <> to <b>{p.account}</b></> : ''} · {p.mode === 'live' ? 'Live' : name === 'PayPal' ? 'Sandbox' : 'Test mode'}</span>
        <span className="hint">{name === 'Stripe' ? 'Key' : 'Client ID'} ends in {p.hint.replace('…', '')}{p.lastPaidAt ? ` · last payment ${whenLabel(p.lastPaidAt)}` : ' · no payments yet'}</span>
        {p.mode !== 'live' && <span className="sp-test">Testing: no real money is taken. Connect a live {name === 'Stripe' ? 'key' : 'app'} when you’re ready.</span>}
      </div>
      <div className="tg-actions">
        <button type="button" className="btn" onClick={onCheck}>Check</button>
        <button type="button" className="btn" onClick={onReplace}>{name === 'Stripe' ? 'Replace key' : 'Replace'}</button>
        <button type="button" className="btn danger" onClick={onDisconnect}>Disconnect</button>
      </div>
    </>
  );
}

function useProvider(provider: 'stripe' | 'paypal', name: string, onStatus: (s: Status) => void) {
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  return {
    busy, replacing, setReplacing,
    async connect(body: unknown, done: () => void) {
      setBusy(true);
      try {
        onStatus(await api.post<Status>(`/api/admin/sponsor/${provider}`, body));
        setReplacing(false); done();
        toast(`${name} connected`);
      } catch (e) { toast(errorText(e)); }
      setBusy(false);
    },
    async check() {
      try {
        const r = await api.post<{ ok: boolean; message: string }>('/api/admin/sponsor/check', { provider });
        toast(r.message);
      } catch (e) { toast(errorText(e)); }
    },
    async disconnect() {
      if (!(await dialog.confirm({ title: `Disconnect ${name}?`, body: `Visitors can’t pay with ${name} until you connect it again. Payments already made are kept.`, confirmLabel: 'Disconnect', danger: true }))) return;
      try { onStatus(await api.del<Status>(`/api/admin/sponsor/${provider}`)); toast(`${name} disconnected`); } catch (e) { toast(errorText(e)); }
    },
  };
}

function StripePanel({ status, onStatus }: { status: ProviderStatus; onStatus: (s: Status) => void }) {
  const [key, setKey] = useState('');
  const h = useProvider('stripe', 'Stripe', onStatus);
  const ok = STRIPE_KEY_RE.test(key.trim());
  const form = (
    <>
      <ol className="tg-steps">
        <li>In Stripe, open <b>Developers → API keys</b> and choose <b>Create restricted key</b>.</li>
        <li>Allow <b>Checkout Sessions: Write</b> and <b>Webhook Endpoints: Write</b>. Leave the rest as None.</li>
        <li>Paste it here. The site sets up payment notifications itself.</li>
      </ol>
      <Field label="Restricted key" htmlFor="sp-stripe-key" hint="Checked with Stripe, then stored encrypted. It’s never shown again.">
        <input id="sp-stripe-key" className="input" type="password" autoComplete="off" spellCheck={false} placeholder="rk_live_…" value={key}
          onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) void h.connect({ key: key.trim() }, () => setKey('')); }} />
      </Field>
      <div className="tg-actions">
        <button type="button" className="btn primary" disabled={h.busy || !ok} onClick={() => void h.connect({ key: key.trim() }, () => setKey(''))}>{h.busy ? 'Checking…' : 'Connect Stripe'}</button>
        {h.replacing && <button type="button" className="btn" onClick={() => { h.setReplacing(false); setKey(''); }}>Cancel</button>}
      </div>
    </>
  );
  return (
    <Panel title="Card payments (Stripe)" desc="Card, Apple Pay, Google Pay and PayNow, as switched on in Stripe → Settings → Payment methods.">
      {status.connected && !h.replacing ? <Connected p={status} name="Stripe" onCheck={() => void h.check()} onReplace={() => h.setReplacing(true)} onDisconnect={() => void h.disconnect()} /> : form}
    </Panel>
  );
}

function PaypalPanel({ status, onStatus, bare = false }: { status: ProviderStatus; onStatus: (s: Status) => void; bare?: boolean }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<'live' | 'test'>('live');
  const h = useProvider('paypal', 'PayPal', onStatus);
  const ok = PAYPAL_ID_RE.test(clientId.trim()) && PAYPAL_ID_RE.test(secret.trim());
  const go = () => void h.connect({ clientId: clientId.trim(), secret: secret.trim(), mode }, () => { setClientId(''); setSecret(''); });
  const form = (
    <>
      <ol className="tg-steps">
        <li>In the <b>PayPal Developer</b> dashboard, open <b>Apps &amp; Credentials</b> and create an app ({mode === 'live' ? 'Live' : 'Sandbox'}).</li>
        <li>Copy its <b>Client ID</b> and <b>Secret</b> here.</li>
      </ol>
      <Segmented label="PayPal mode" value={mode} onChange={setMode} options={[['live', 'Live'], ['test', 'Sandbox (testing)']] as const} />
      <Field label="Client ID" htmlFor="sp-pp-id">
        <input id="sp-pp-id" className="input" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </Field>
      <Field label="Secret" htmlFor="sp-pp-secret" hint="Checked with PayPal, then stored encrypted. It’s never shown again.">
        <input id="sp-pp-secret" className="input" type="password" autoComplete="off" spellCheck={false} value={secret}
          onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) go(); }} />
      </Field>
      <div className="tg-actions">
        <button type="button" className="btn primary" disabled={h.busy || !ok} onClick={go}>{h.busy ? 'Checking…' : 'Connect PayPal'}</button>
        {h.replacing && <button type="button" className="btn" onClick={() => { h.setReplacing(false); setClientId(''); setSecret(''); }}>Cancel</button>}
      </div>
    </>
  );
  const body = status.connected && !h.replacing ? <Connected p={status} name="PayPal" onCheck={() => void h.check()} onReplace={() => h.setReplacing(true)} onDisconnect={() => void h.disconnect()} /> : form;
  return bare ? body : <Panel title="PayPal" desc="Visitors pay with their PayPal account, or a card through PayPal.">{body}</Panel>;
}
