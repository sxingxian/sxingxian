// Sponsor amounts and messages, shared by the server, the sponsor page and the admin.
// Money is always whole cents (integers) in Singapore dollars; nothing here trusts the browser.
import type { SponsorSetting } from './types';

export const SPONSOR_CURRENCY = 'SGD';
export const MESSAGE_MAX = 280;

/** 1000 → "S$10", 1250 → "S$12.50". */
export function formatMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return `S$${(cents / 100).toLocaleString('en-SG', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "15", "15.5", "S$15.50", "1,000" → cents. Anything else (negative, 3 decimals, words) → null. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/^S?\$\s*/i, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [d, f = ''] = s.split('.');
  return Number(d) * 100 + Number((f + '00').slice(0, 2));
}

/** Why this amount can't be charged, or null when it can. The only place amounts are checked. */
export function amountProblem(s: SponsorSetting, cents: number): string | null {
  if (!Number.isInteger(cents) || cents <= 0) return 'Pick an amount';
  if (s.amounts.includes(cents)) return null;
  if (!s.allowCustom) return 'Pick one of the amounts';
  if (cents < s.min) return `The smallest amount is ${formatMoney(s.min)}`;
  if (cents > s.max) return `The largest amount is ${formatMoney(s.max)}`;
  return null;
}

/** A visitor's note: no control characters or invisible formatting, collapsed blank lines, at most 280. */
export function cleanMessage(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MESSAGE_MAX);
}
