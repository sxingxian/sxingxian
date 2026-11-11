// Settings → Home → Featured stories: pick up to 8 stories, order them by date or by hand.
// Saves on every change, like the other switches on this tab.
import { useState } from 'react';
import { api, errorText } from '../api';
import { useToast } from './ui';
import { Panel, Row, Segmented } from './kit';
import { featuredIds, FEATURED_INTERVAL_S, MAX_FEATURED, type Entry, type FeaturedSetting } from '../../lib/shared/types';
import { entryState, whenLabel } from '../../lib/shared/state';

type Post = Omit<Entry, 'body'>;

export default function FeaturedEditor({ value, posts, onSaved }: { value: FeaturedSetting; posts: Post[]; onSaved: (v: FeaturedSetting) => void }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(() => featuredIds(value));
  const [order, setOrder] = useState<FeaturedSetting['order']>(value.order === 'custom' ? 'custom' : 'date');
  const [drag, setDrag] = useState<number | null>(null);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const isPublic = (p?: Post) => entryState(p) === 'published';
  // What the visitor sees: newest first, or the hand-made order.
  const shown = order === 'date'
    ? [...ids].sort((a, b) => new Date(byId.get(b)?.published_at ?? 0).getTime() - new Date(byId.get(a)?.published_at ?? 0).getTime())
    : ids;
  const candidates = posts.filter((p) => isPublic(p) && !ids.includes(p.id));

  const save = async (nextIds: string[], nextOrder = order) => {
    const prev = { ids, order };
    setIds(nextIds);
    setOrder(nextOrder);
    try {
      const r = await api.put<{ value: FeaturedSetting }>('/api/admin/settings/featured', { entryIds: nextIds, order: nextOrder });
      onSaved(r.value);
      toast('Saved');
    } catch (e) {
      setIds(prev.ids);
      setOrder(prev.order);
      toast(errorText(e));
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length || from === to) return;
    const next = shown.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    void save(next, 'custom');
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <Panel title="Featured stories" flush
      desc={`The stories that rotate at the top of the home page, every ${FEATURED_INTERVAL_S} seconds. They stay there when a visitor picks a topic.`}>
      <div style={{ padding: '0 20px' }}>
        <Row label="Order" hint={order === 'date' ? 'Newest first, by publish date' : 'Drag, or use the arrows'}>
          <Segmented label="Order" value={order} options={[['date', 'Newest first'], ['custom', 'Custom']] as const}
            onChange={(o) => void save(order === 'date' && o === 'custom' ? shown : ids, o)} />
        </Row>
      </div>
      <ul className="list-rows feat-list" aria-label="Featured stories">
        {shown.length === 0 && <li className="list-row"><span className="meta">None chosen: the latest story is featured.</span></li>}
        {shown.map((id, i) => {
          const p = byId.get(id);
          const live = isPublic(p);
          return (
            <li key={id} className={`list-row feat-row${drag === i ? ' dragging' : ''}`}
              draggable={order === 'custom'}
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}>
              {order === 'custom' && <span className="feat-grip" aria-hidden="true">⠿</span>}
              <span className="feat-n">{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="title" style={{ display: 'block' }}>{p?.title ?? 'A deleted story'}</span>
                <span className="meta">{live
                  ? `${fmt(p!.published_at)}${p!.topics?.length ? ` · ${p!.topics.join(', ')}` : ''}`
                  : entryState(p) === 'scheduled' ? `Scheduled: shows from ${whenLabel(p!.published_at!)}` : p ? 'Draft: shows once it’s published' : 'Skipped'}</span>
              </span>
              <span className="row" style={{ gap: 4 }}>
                {order === 'custom' && <>
                  <button type="button" className="btn small" aria-label={`Move ${p?.title ?? 'story'} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                  <button type="button" className="btn small" aria-label={`Move ${p?.title ?? 'story'} down`} disabled={i === shown.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                </>}
                <button type="button" className="btn small" aria-label={`Stop featuring ${p?.title ?? 'story'}`} onClick={() => void save(ids.filter((x) => x !== id))}>✕</button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="feat-add">
        {ids.length < MAX_FEATURED ? (
          <>
            <label htmlFor="feat-add" className="sr-only">Add a featured story</label>
            <select id="feat-add" className="select" value="" disabled={!candidates.length}
              onChange={(e) => { if (e.target.value) void save([...ids, e.target.value]); }}>
              <option value="">{candidates.length ? '+ Add a story…' : 'All public stories are featured'}</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </>
        ) : <span className="meta">Up to {MAX_FEATURED} featured stories.</span>}
      </div>
    </Panel>
  );
}
