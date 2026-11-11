// Story editor → Publishing: which series this story belongs to, and its part number.
// Saves at once (separately from the story's autosave), like "Feature on home page".
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useToast } from './ui';
import { Field } from './kit';
import type { SeriesAdminRow } from '../../lib/shared/types';

interface Taken { part: number; entry_id: string; title: string }

export default function SeriesField({ entryId, onManage }: { entryId: string | null; onManage: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<SeriesAdminRow[] | null>(null);
  const [notReady, setNotReady] = useState('');
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [part, setPart] = useState<string>('');
  const [taken, setTaken] = useState<Taken[]>([]);

  useEffect(() => {
    api.get<{ series: SeriesAdminRow[]; notReady?: string }>('/api/admin/series').then((r) => { setList(r.series); setNotReady(r.notReady ?? ''); }).catch(() => setList([]));
  }, []);
  useEffect(() => {
    if (!entryId) return;
    api.get<{ seriesId: string | null; part: number | null }>(`/api/admin/entries/${entryId}/series`)
      .then((r) => { setSeriesId(r.seriesId); setPart(r.part ? String(r.part) : ''); })
      .catch(() => {});
  }, [entryId]);
  useEffect(() => {
    if (!seriesId) { setTaken([]); return; }
    api.get<{ parts: Taken[] }>(`/api/admin/series/${seriesId}`).then((r) => setTaken(r.parts)).catch(() => setTaken([]));
  }, [seriesId]);

  const save = async (nextSeries: string | null, nextPart: number | null) => {
    if (!entryId) { toast('Save the story first'); return; }
    try {
      const r = await api.put<{ seriesId: string | null; part: number | null }>(`/api/admin/entries/${entryId}/series`, { seriesId: nextSeries, part: nextPart });
      setSeriesId(r.seriesId);
      setPart(r.part ? String(r.part) : '');
      toast(r.seriesId ? `Part ${r.part} of the series` : 'Not in a series');
    } catch (e) {
      toast(errorText(e));
      // Put the field back to what's saved.
      const cur = await api.get<{ seriesId: string | null; part: number | null }>(`/api/admin/entries/${entryId}/series`).catch(() => null);
      if (cur) { setSeriesId(cur.seriesId); setPart(cur.part ? String(cur.part) : ''); }
    }
  };

  if (!list) return null;
  if (notReady) return <Field label="Series" hint={notReady}><span className="hint">Not available yet.</span></Field>;
  const others = taken.filter((t) => t.entry_id !== entryId);
  const next = others.reduce((m, t) => Math.max(m, t.part), 0) + 1;
  const clash = others.find((t) => String(t.part) === part);
  // "1–3, 5": the part numbers the other stories in this series already use.
  const used = [...new Set(others.map((t) => t.part))].sort((a, b) => a - b).reduce<[number, number][]>((runs, n) => {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
    return runs;
  }, []).map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(', ');
  const useNext = <button type="button" className="linklike" onClick={() => { setPart(String(next)); void save(seriesId, next); }}>Use Part {next}</button>;
  const partHint = clash
    ? <>Part {part} is taken. {useNext}</>
    : !others.length
      ? (part ? 'First in this series' : <>First in this series. {useNext}</>)
      : part ? `Other parts: ${used}` : <>Other parts: {used}. {useNext}</>;

  return (
    <>
      <Field label="Series" htmlFor="ed-series" hint={list.length ? undefined : <>No series yet. <button type="button" className="linklike" onClick={onManage}>Create one</button></>}>
        <select id="ed-series" className="select" value={seriesId ?? ''} disabled={!list.length}
          onChange={(e) => void save(e.target.value || null, null)}>
          <option value="">None</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </Field>
      {seriesId && (
        <Field label="Part" htmlFor="ed-part" hint={partHint}>
          <input id="ed-part" className="input" inputMode="numeric" style={{ maxWidth: 100 }} value={part}
            onChange={(e) => setPart(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => { const n = Number(part); if (Number.isInteger(n) && n >= 1 && n <= 99) void save(seriesId, n); else setPart(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </Field>
      )}
    </>
  );
}
