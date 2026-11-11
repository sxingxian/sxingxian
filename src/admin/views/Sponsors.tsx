// Site → Sponsors: what came in. Totals, then each payment with the sponsor's note and a link to it in
// Stripe or PayPal (refunds and receipts are handled there).
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Empty, Loading, Page, Panel } from '../components/kit';
import { useGo } from '../nav';
import { formatMoney, parseMoney } from '../../lib/shared/sponsor';
import { useToast } from '../components/ui';
import { whenLabel } from '../../lib/shared/state';

interface Item { id: string; at: string; amount: number; status: 'paid' | 'refunded'; name: string; email: string; message: string; source: string; via: 'stripe' | 'paypal' | 'paypalme'; link: string | null; live: boolean }
interface Check { id: string; at: string; amount: number; message: string; source: string }
interface List { available: boolean; month: { total: number; count: number }; all: { total: number; count: number }; top: { title: string; count: number } | null; toCheck: Check[]; items: Item[]; more: boolean }
const VIA: Record<Item['via'], string> = { stripe: 'Stripe', paypal: 'PayPal', paypalme: 'PayPal.Me' };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Sponsors() {
  const [data, setData] = useState<List | null>(null);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const go = useGo();
  const toast = useToast();
  const [confirming, setConfirming] = useState<{ id: string; text: string } | null>(null);
  const reload = () => api.get<List>('/api/admin/sponsors?page=0').then((r) => { setData(r); setPage(0); }).catch((e) => setErr(errorText(e)));
  const mark = async (id: string, body: { action: 'received'; amount: number } | { action: 'not-received' }) => {
    try {
      await api.post(`/api/admin/sponsors/${id}`, body);
      setConfirming(null);
      toast(body.action === 'received' ? `Marked received: ${formatMoney(body.amount)}` : 'Removed');
      await reload();
    } catch (e) { toast(errorText(e)); }
  };
  const received = (c: Check) => {
    if (!confirming || confirming.id !== c.id) { setConfirming({ id: c.id, text: (c.amount / 100).toFixed(c.amount % 100 ? 2 : 0) }); return; }
    const cents = parseMoney(confirming.text);
    if (cents === null || cents < 100 || cents > 1_000_000) { toast('Type the amount that arrived, like 10 or 12.50'); return; }
    void mark(c.id, { action: 'received', amount: cents });
  };

  useEffect(() => {
    api.get<List>('/api/admin/sponsors?page=0').then(setData).catch((e) => setErr(errorText(e)));
  }, []);
  const more = async () => {
    setLoading(true);
    try {
      const r = await api.get<List>(`/api/admin/sponsors?page=${page + 1}`);
      setData((d) => (d ? { ...r, items: [...d.items, ...r.items] } : r));
      setPage(page + 1);
    } catch (e) { setErr(errorText(e)); }
    setLoading(false);
  };
  const settings = <a href="/admin/settings#sponsor" className="btn" onClick={(e) => { e.preventDefault(); go('/admin/settings#sponsor'); }}>Sponsor settings</a>;

  return (
    <Page title="Sponsors" section="sponsors" actions={settings}>
      {!data ? <Loading error={err} /> : !data.available ? (
        <Panel title="Sponsors"><p className="hint">Sponsoring needs a database update first: run “Deploy Neon” on GitHub (migration 0012), then reload this page.</p></Panel>
      ) : (
        <>
          <div className="sp-stats">
            <div className="sp-stat"><span>This month</span><b>{formatMoney(data.month.total)}</b><span>{plural(data.month.count, 'sponsor')}</span></div>
            <div className="sp-stat"><span>All time</span><b>{formatMoney(data.all.total)}</b><span>{plural(data.all.count, 'sponsor')}</span></div>
            <div className="sp-stat"><span>Most sponsored</span>{data.top ? <><b className="sp-top">{data.top.title}</b><span>{plural(data.top.count, 'sponsor')}</span></> : <><b className="sp-top">—</b><span>No story yet</span></>}</div>
          </div>
          {data.toCheck.length > 0 && (
            <section className="sp-check" aria-label="To check">
              <div><h2>To check · {data.toCheck.length}</h2><p>Visitors who went to your PayPal.Me. Look for the amount in PayPal around that time, then mark it. Totals only count Received; unmarked ones go after 30 days.</p></div>
              {data.toCheck.map((c) => (
                <div key={c.id} className="sp-check-row">
                  <span className="sp-when">{whenLabel(c.at)}</span>
                  <b>{formatMoney(c.amount)} <span className="hint">PayPal.Me</span></b>
                  <span className="sp-msg">{c.message ? <q>{c.message}</q> : <span className="hint">No message</span>}</span>
                  <span className="sp-src">{c.source}</span>
                  <span className="sp-check-act">
                    {confirming?.id === c.id && (
                      <span className="sp-money"><span aria-hidden="true">S$</span><input className="input" autoFocus inputMode="decimal" aria-label="Amount that arrived" value={confirming.text} maxLength={10}
                        onChange={(e) => setConfirming({ id: c.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') received(c); if (e.key === 'Escape') setConfirming(null); }} /></span>
                    )}
                    <button type="button" className="btn primary small" onClick={() => received(c)}>{confirming?.id === c.id ? 'Confirm' : 'Received'}</button>
                    <button type="button" className="btn small" onClick={() => (confirming?.id === c.id ? setConfirming(null) : void mark(c.id, { action: 'not-received' }))}>{confirming?.id === c.id ? 'Cancel' : 'Not received'}</button>
                  </span>
                </div>
              ))}
            </section>
          )}
          {data.items.length === 0 ? (
            <Empty>No sponsors yet. Payments appear here as soon as they come through.</Empty>
          ) : (
            <div className="table-box sp-table">
              <table>
                <thead><tr><th scope="col">When</th><th scope="col">Amount</th><th scope="col">From</th><th scope="col">Message</th><th scope="col">Came from</th><th scope="col">Paid with</th></tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id}>
                      <td className="sp-when">{whenLabel(it.at)}</td>
                      <td className="sp-amt"><b>{formatMoney(it.amount)}</b>{it.status === 'refunded' && <span className="sp-refunded">Refunded</span>}{!it.live && it.via !== 'paypalme' && <span className="sp-testpill">Test</span>}</td>
                      <td className="sp-who">{it.name || 'No name given'}{it.email && <><br /><a href={`mailto:${it.email}`}>{it.email}</a></>}</td>
                      <td className="sp-msg">{it.message ? <q>{it.message}</q> : <span className="hint">—</span>}</td>
                      <td className="sp-src">{it.source}</td>
                      <td className="sp-via">{it.link ? <a href={it.link} target="_blank" rel="noopener noreferrer">{VIA[it.via]} ↗</a> : VIA[it.via]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.more && <button type="button" className="btn" disabled={loading} onClick={() => void more()}>{loading ? 'Loading…' : 'Show older'}</button>}
          <p className="hint">Refunds and receipts are handled in your Stripe or PayPal dashboard. A Stripe refund shows here by itself; for PayPal, check PayPal.</p>
        </>
      )}
    </Page>
  );
}
