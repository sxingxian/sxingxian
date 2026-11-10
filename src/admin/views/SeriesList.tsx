// Content → Series: create, edit and delete series. Stories are put into a series from the
// story editor (Publishing → Series and Part).
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import { Empty, Loading, Page, Panel, Row, Segmented } from '../components/kit';
import { slugify } from '../../lib/shared/safe';
import type { SeriesAdminRow } from '../../lib/shared/types';

interface Form { title: string; slug: string; description: string; planned: string; is_public: boolean }
const EMPTY: Form = { title: '', slug: '', description: '', planned: '', is_public: true };

export default function SeriesList() {
  const [rows, setRows] = useState<SeriesAdminRow[] | null>(null);
  const [notReady, setNotReady] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = useDialog();

  const load = useCallback(() => {
    api.get<{ series: SeriesAdminRow[]; notReady?: string }>('/api/admin/series')
      .then((r) => { setRows(r.series); setNotReady(r.notReady ?? ''); })
      .catch((e) => setErr(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const open = (s: SeriesAdminRow | null) => {
    setEditing(s ? s.id : 'new');
    setSlugTouched(!!s);
    setForm(s ? { title: s.title, slug: s.slug, description: s.description, planned: s.planned_parts ? String(s.planned_parts) : '', is_public: s.is_public } : EMPTY);
  };
  const close = () => { setEditing(null); setForm(EMPTY); };

  const save = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const planned = form.planned.trim() ? Number(form.planned) : null;
    if (planned !== null && (!Number.isInteger(planned) || planned < 1 || planned > 99)) { toast('Planned parts: a number from 1 to 99, or leave it empty'); return; }
    const body = { title: form.title.trim(), slug: form.slug, description: form.description.trim(), planned_parts: planned, is_public: form.is_public };
    setBusy(true);
    try {
      if (editing === 'new') await api.post('/api/admin/series', body);
      else await api.put(`/api/admin/series/${editing}`, body);
      toast('Saved');
      close();
      load();
    } catch (e2) { toast(errorText(e2)); }
    setBusy(false);
  };

  const remove = async (s: SeriesAdminRow) => {
    const ok = await dialog.confirm({
      title: `Delete “${s.title}”?`,
      body: 'Its stories stay as they are; they just stop being parts of a series.',
      confirmLabel: 'Delete series',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/series/${s.id}`);
      toast('Series deleted');
      close();
      load();
    } catch (e) { toast(errorText(e)); }
  };

  if (!rows) return <Page title="Series" section="series" width="narrow"><Loading error={err} /></Page>;
  const current = rows.find((r) => r.id === editing) ?? null;

  return (
    <Page title="Series" section="series" width="narrow" sub="Group stories into numbered parts. Add a story to a series from its editor: Publishing → Series."
      actions={!editing && !notReady && <button type="button" className="btn primary" onClick={() => open(null)}>New series</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      {notReady && <div className="alert" role="status">{notReady}</div>}
      {editing && (
        <Panel title={editing === 'new' ? 'New series' : 'Edit series'}>
          <form onSubmit={save}>
            <Row label="Title" htmlFor="se-title">
              <input id="se-title" className="input" required maxLength={120} value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value, ...(slugTouched ? {} : { slug: slugify(e.target.value) }) })} />
            </Row>
            <Row label="Address" hint={`/series/${form.slug || '…'}`} htmlFor="se-slug">
              <input id="se-slug" className="input mono" required maxLength={80} value={form.slug}
                onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: slugify(e.target.value) }); }} />
            </Row>
            <Row label="Short description" hint={`${form.description.length}/300`} htmlFor="se-desc">
              <textarea id="se-desc" className="input" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Row>
            <Row label="Planned parts" hint="Optional. Shows progress, e.g. 3 of 5." htmlFor="se-planned">
              <input id="se-planned" className="input" inputMode="numeric" style={{ maxWidth: 100 }} value={form.planned}
                onChange={(e) => setForm({ ...form, planned: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Row>
            <Row label="Show on site">
              <Segmented label="Show on site" value={form.is_public ? 'on' : 'off'} options={[['on', 'Public'], ['off', 'Hidden']] as const}
                onChange={(v) => setForm({ ...form, is_public: v === 'on' })} />
            </Row>
            <div className="save-bar">
              {current && <button type="button" className="btn danger" onClick={() => void remove(current)} style={{ marginRight: 'auto' }}>Delete series</button>}
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy || !form.title.trim() || !form.slug}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="All series" flush>
        {rows.length === 0 ? (
          <Empty>No series yet.</Empty>
        ) : (
          <div className="list-rows">
            {rows.map((s) => (
              <div key={s.id} className="list-row">
                <span style={{ minWidth: 0 }}>
                  <button type="button" className="title linklike" onClick={() => open(s)}>{s.title}</button>
                  <span className="meta" style={{ display: 'block' }}>
                    /series/{s.slug} · {s.published} published{s.drafts ? `, ${s.drafts} draft${s.drafts === 1 ? '' : 's'}` : ''}{s.planned_parts ? ` · ${s.planned_parts} planned` : ''}
                  </span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`pill${s.is_public ? ' ok' : ''}`}>{s.is_public ? 'Public' : 'Hidden'}</span>
                  <button type="button" className="btn small" onClick={() => open(s)} aria-label={`Edit ${s.title}`}>Edit</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
