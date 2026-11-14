// Read count shown on a story page ("640 reads", "1.2k reads").
import type { ReadsSetting } from './types';

/**
 * Short form of a count. Always rounded down, so the page never claims more reads than there were:
 * 999 → "999", 1,250 → "1.2k", 1,999 → "1.9k", 12,800 → "12k", 1,250,000 → "1.2M".
 */
export function shortCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const unit = (div: number, suffix: string) => {
    const x = v / div;
    // One decimal below 10 (1.2k), whole numbers above (12k); drop a trailing ".0".
    const r = x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x);
    return `${String(r)}${suffix}`;
  };
  if (v >= 1_000_000) return unit(1_000_000, 'M');
  if (v >= 1_000) return unit(1_000, 'k');
  return String(v);
}

/** The label for a story's meta line, or null when it should not show (switched off or under the minimum). */
export function readsLabel(n: number, setting: ReadsSetting): { short: string; full: string } | null {
  if (!setting.show) return null;
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (v < Math.max(1, setting.minimum)) return null;
  const noun = v === 1 ? 'read' : 'reads';
  return { short: `${shortCount(v)} ${noun}`, full: `${v.toLocaleString('en-US')} ${noun}` };
}
