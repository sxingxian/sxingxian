// The one publishing state of an entry, used by every admin screen. Visitors see an entry only when it is
// Published (same rule as the public queries: status published, public, and its date has come).
//  - Draft: only the owner sees it.
//  - Scheduled: published with a future date; it goes live by itself at that time.
//  - Published: live.
// An older "published but hidden" row counts as a draft (migration 0010 turns those into drafts).

export type EntryState = 'draft' | 'scheduled' | 'published';

export const STATE_LABEL: Record<EntryState, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published' };

export function entryState(e: { status: string; is_public: boolean; published_at: string | null } | null | undefined, now = Date.now()): EntryState {
  if (!e || e.status !== 'published' || !e.is_public) return 'draft';
  return e.published_at && new Date(e.published_at).getTime() > now ? 'scheduled' : 'published';
}

const two = (n: number) => String(n).padStart(2, '0');
function time(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${two(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}
const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today, 11:00 pm" · "Tomorrow, 9:00 am" · "Thu 12 Nov, 9:00 am" · "12 Nov 2027, 9:00 am" (local time). */
export function whenLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / DAY);
  if (days === 0) return `Today, ${time(d)}`;
  if (days === 1) return `Tomorrow, ${time(d)}`;
  if (days === -1) return `Yesterday, ${time(d)}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString('en-GB', sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day.replace(',', '')}, ${time(d)}`;
}

/** "in 40 min" · "in 12 h" · "in 3 days" for a future time; '' otherwise. 12½ hours is "in 12 h", never "in 1 day". */
export function untilLabel(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return '';
  if (diff < 60_000) return 'in under a minute';
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)} min`;
  if (diff < DAY) return `in ${Math.floor(diff / 3_600_000)} h`;
  const days = Math.floor(diff / DAY);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
