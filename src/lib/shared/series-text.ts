// Wording shared by every series surface, so the series page, cards and story box say the same thing.

/** "2 of 5 parts" while parts are still to come; "3 parts" once done; "1 part". */
export function partsLabel(published: number, planned: number | null | undefined, lastPart = published): string {
  const total = Math.max(planned ?? 0, published, lastPart);
  if (total > published) return `${published} of ${total} parts`;
  return `${published} ${published === 1 ? 'part' : 'parts'}`;
}

/** The parts after `after` up to `total`: "Part 5" · "Parts 4 and 5" · "Parts 4–9"; '' when none. */
export function laterParts(after: number, total: number): string {
  if (total <= after) return '';
  if (total === after + 1) return `Part ${total}`;
  if (total === after + 2) return `Parts ${after + 1} and ${total}`;
  return `Parts ${after + 1}–${total}`;
}

/**
 * When a scheduled part comes out, after "Out": "tonight, 11:00 pm" · "today, 9:00 am" · "tomorrow, 9:00 am" ·
 * "Thursday, 9:00 am" (within a week) · "24 Nov, 9:00 am". Formatted in `timeZone` (the page renders Singapore
 * time like every other date on the site; a small script redoes it in the reader's own zone).
 */
export function outWhen(iso: string, now = Date.now(), timeZone?: string): string {
  const d = new Date(iso);
  const parts = (t: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(t).map((p) => [p.type, p.value]));
  const a = parts(d), b = parts(new Date(now));
  const day = (x: Record<string, string>) => Date.UTC(+x.year, +x.month - 1, +x.day) / 86_400_000;
  const diff = day(a) - day(b);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d).toLowerCase().replace(/\s/g, ' ');
  if (diff <= 0) return `${+a.hour >= 18 ? 'tonight' : 'today'}, ${time}`;
  if (diff === 1) return `tomorrow, ${time}`;
  if (diff < 7) return `${new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(d)}, ${time}`;
  return `${new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(d)}, ${time}`;
}
