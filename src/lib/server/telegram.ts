// SERVER-ONLY. Telegram announcements.
//
// Security:
//  - The bot token is sealed with AUTH_SECRET (AES-GCM, bound to "telegram-bot") in telegram_bot and only
//    opened here, to call api.telegram.org. It is never returned to the browser or written to a log: the
//    request URL holds it, so errors are reported from Telegram's description only.
//  - Messages go out as Telegram HTML built by markdownToTelegramHtml (escape first, then a few tags).
//
// When posts go out:
//  - Publish now: right after the response (waitUntil).
//  - A scheduled entry: when it goes live, the next page visit's background check posts it (the same
//    visit-driven jobs as the WordPress sync; no timer).
//  - Each entry is posted once per channel per publication; moving it back to draft clears the record, so
//    publishing again posts again. A post Telegram refused is tried up to 3 times.
//  - Never posted twice by itself: when we can't tell whether Telegram posted (no answer in time, the
//    connection dropped, Telegram's own server error, or the request was cut off mid-send) it is marked
//    "not confirmed" and NOT retried automatically, because Telegram may have posted it anyway (it has no
//    way to send a message only once). The editor asks you to check the channel; "Post again" is yours.
import { env } from 'cloudflare:workers';
import { sql } from './db';
import { getPublicEntryById, getSetting } from './repo';
import { seriesForEntry } from './series';
import { authSecretProblem, openSecret, sealSecret } from './authcrypto';
import { buildPost, fillTemplate, type Post } from '../shared/telegram-format';
import { TELEGRAM_CHAT_RE, TELEGRAM_TOKEN_RE, type EntryTelegramInput } from '../shared/schemas';
import { KIND_PATH, type Entry, type TelegramChannel } from '../shared/types';

const API = 'https://api.telegram.org';
const AAD = 'telegram-bot';
const TIMEOUT_MS = 10_000;
/** Posting waits longer: for a photo, Telegram first downloads it from this site. */
const SEND_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_S = 120;
/** A post still "sending" after this long was cut off mid-send: its outcome is unknown. */
const STUCK_MIN = 5;
/** Stored as the error of a post whose outcome is unknown (shown in the editor as "not confirmed"). */
export const UNCONFIRMED = 'Telegram didn’t confirm this post. It may have gone out anyway: check the channel before posting again.';
/** Every error meaning "outcome unknown", including the wording saved before UNCONFIRMED existed. */
const UNSURE = [UNCONFIRMED, 'Telegram didn’t answer in time', 'Couldn’t reach Telegram'];
/** A scheduled entry is still posted if the first visit after its time comes within this long. */
const LATE_LIMIT = '3 days';

export class TelegramError extends Error {}

function missingTable(e: unknown): boolean {
  return (e as { code?: string })?.code === '42P01';
}

/**
 * `uncertain`: we can't tell whether Telegram acted (no answer in time, connection lost, a 5xx, or an answer
 * we couldn't read). A clear refusal from Telegram (ok: false with a 4xx) is certain: nothing was posted.
 */
interface TgReply<T> { ok: boolean; result?: T; description?: string; error_code?: number; uncertain?: boolean }

async function call<T>(token: string, method: string, payload: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<TgReply<T>> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => null)) as TgReply<T> | null;
    if (!data || typeof data.ok !== 'boolean' || res.status >= 500) {
      return { ok: false, description: `Telegram answered with an error (HTTP ${res.status})`, error_code: res.status, uncertain: true };
    }
    return { ok: data.ok, result: data.result, description: (data.description ?? `HTTP ${res.status}`).slice(0, 200), error_code: data.error_code ?? res.status };
  } catch (e) {
    return { ok: false, description: (e as Error)?.name === 'TimeoutError' ? 'Telegram didn’t answer in time' : 'Couldn’t reach Telegram', uncertain: true };
  }
}

// ---------- the bot ----------

export interface BotStatus { available: boolean; connected: boolean; username: string | null }

export async function botStatus(): Promise<BotStatus> {
  try {
    const rows = await sql()`SELECT username FROM telegram_bot WHERE id = 1`;
    return { available: true, connected: rows.length > 0, username: (rows[0]?.username as string) ?? null };
  } catch (e) {
    if (missingTable(e)) return { available: false, connected: false, username: null };
    throw e;
  }
}

async function bot(): Promise<{ token: string; id: number; connectedAt: string } | null> {
  if (authSecretProblem(env.AUTH_SECRET)) return null;
  let rows;
  try {
    rows = await sql()`SELECT token_sealed, bot_id, connected_at FROM telegram_bot WHERE id = 1`;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
  if (!rows[0]) return null;
  const pt = await openSecret(env.AUTH_SECRET!, rows[0].token_sealed as string, AAD);
  return pt ? { token: new TextDecoder().decode(pt), id: Number(rows[0].bot_id), connectedAt: new Date(rows[0].connected_at as string).toISOString() } : null;
}

/** Checks the token with Telegram, then stores it sealed. Returns the bot's @username. */
export async function connectBot(token: string): Promise<string> {
  if (!TELEGRAM_TOKEN_RE.test(token)) throw new TelegramError('That doesn’t look like a bot token. It looks like 123456789:ABC…');
  const problem = authSecretProblem(env.AUTH_SECRET);
  if (problem) throw new TelegramError(`Can’t store the token safely: ${problem}`);
  const me = await call<{ id: number; username: string; is_bot: boolean }>(token, 'getMe', {});
  if (!me.ok || !me.result?.is_bot) throw new TelegramError(me.error_code === 401 || me.error_code === 404 ? 'Telegram didn’t accept that token' : me.description ?? 'Telegram didn’t accept that token');
  const sealed = await sealSecret(env.AUTH_SECRET!, new TextEncoder().encode(token), AAD);
  await sql()`INSERT INTO telegram_bot (id, token_sealed, bot_id, username, connected_at) VALUES (1, ${sealed}, ${me.result.id}, ${me.result.username}, now())
    ON CONFLICT (id) DO UPDATE SET token_sealed = EXCLUDED.token_sealed, bot_id = EXCLUDED.bot_id, username = EXCLUDED.username`;
  return me.result.username;
}

export async function disconnectBot(): Promise<void> {
  await sql()`DELETE FROM telegram_bot WHERE id = 1`;
}

export interface ChannelCheck { chat: string; title: string; canPost: boolean; reason: string }

/** Finds the channel and checks the bot may post there. */
export async function checkChannel(chat: string): Promise<ChannelCheck> {
  if (!TELEGRAM_CHAT_RE.test(chat)) throw new TelegramError('A channel is @name, or a private channel’s -100… id');
  const b = await bot();
  if (!b) throw new TelegramError('Connect the bot first');
  const info = await call<{ id: number; title?: string; type: string; username?: string }>(b.token, 'getChat', { chat_id: chat });
  if (!info.ok || !info.result) return { chat, title: chat, canPost: false, reason: 'Telegram can’t find that channel, or the bot isn’t in it yet. Add the bot as an admin first.' };
  const title = (info.result.title ?? chat).slice(0, 128);
  const member = await call<{ status: string; can_post_messages?: boolean }>(b.token, 'getChatMember', { chat_id: chat, user_id: b.id });
  const st = member.result?.status;
  const canPost = info.result.type === 'channel'
    ? st === 'creator' || (st === 'administrator' && member.result?.can_post_messages !== false)
    : st === 'creator' || st === 'administrator' || st === 'member';
  return { chat, title, canPost, reason: canPost ? '' : 'The bot isn’t an admin here yet. Add it with “Post messages”, then check again.' };
}

export async function sendTest(chat: string): Promise<void> {
  if (!TELEGRAM_CHAT_RE.test(chat)) throw new TelegramError('A channel is @name, or a private channel’s -100… id');
  const b = await bot();
  if (!b) throw new TelegramError('Connect the bot first');
  const r = await call(b.token, 'sendMessage', { chat_id: chat, text: '<b>Test from sxingxian</b>\nNew stories will be posted here.', parse_mode: 'HTML' });
  if (!r.ok) throw new TelegramError(`Telegram said: ${r.description}`);
}

// ---------- one entry's options and the post ----------

export interface EntryTelegram extends EntryTelegramInput {}
const DEFAULT_OPTIONS: EntryTelegram = { announce: true, message: null, image: 'cover', silent: null };

/** The silent column arrives with migration 0014; until then entries follow the default (code deploys first). */
function missingSilent(e: unknown): boolean {
  return (e as { code?: string })?.code === '42703' && /silent/.test(String((e as Error)?.message ?? ''));
}

export async function getEntryTelegram(entryId: string): Promise<EntryTelegram> {
  try {
    const rows = await sql()`SELECT announce, message, image, silent FROM entry_telegram WHERE entry_id = ${entryId}`
      .catch((e) => { if (missingSilent(e)) return sql()`SELECT announce, message, image, NULL::boolean AS silent FROM entry_telegram WHERE entry_id = ${entryId}`; throw e; });
    return rows[0]
      ? { announce: !!rows[0].announce, message: (rows[0].message as string) ?? null, image: rows[0].image as EntryTelegram['image'], silent: rows[0].silent === null || rows[0].silent === undefined ? null : !!rows[0].silent }
      : DEFAULT_OPTIONS;
  } catch (e) {
    if (missingTable(e)) return DEFAULT_OPTIONS;
    throw e;
  }
}

export async function putEntryTelegram(entryId: string, o: EntryTelegram): Promise<void> {
  try {
    await sql()`INSERT INTO entry_telegram (entry_id, announce, message, image, silent, updated_at) VALUES (${entryId}, ${o.announce}, ${o.message}, ${o.image}, ${o.silent}, now())
      ON CONFLICT (entry_id) DO UPDATE SET announce = EXCLUDED.announce, message = EXCLUDED.message, image = EXCLUDED.image, silent = EXCLUDED.silent, updated_at = now()`;
  } catch (e) {
    if (!missingSilent(e)) throw e;
    await sql()`INSERT INTO entry_telegram (entry_id, announce, message, image, updated_at) VALUES (${entryId}, ${o.announce}, ${o.message}, ${o.image}, now())
      ON CONFLICT (entry_id) DO UPDATE SET announce = EXCLUDED.announce, message = EXCLUDED.message, image = EXCLUDED.image, updated_at = now()`;
  }
}

/** Whether this entry posts without a sound: its own choice, else the default in Settings → Telegram. */
export async function isSilent(opts: EntryTelegram): Promise<boolean> {
  return opts.silent ?? (await getSetting('telegram')).silent;
}

/** The channels that take this kind of entry. */
export async function channelsFor(kind: Entry['kind']): Promise<TelegramChannel[]> {
  return (await getSetting('telegram')).channels.filter((c) => c.kinds.includes(kind));
}

/** The post as it would be sent now. `origin` is the site's address. */
export async function postFor(entry: Entry, opts: EntryTelegram, origin: string): Promise<{ post: Post; defaultMessage: string }> {
  const t = await getSetting('telegram');
  const s = entry.kind === 'post' ? await seriesForEntry(entry.id).catch(() => null) : null;
  const series = s ? `Part ${s.part} of ${s.series.title}` : '';
  const imageId = opts.image === 'none' || !t.attachImage && opts.image === 'cover' ? null : opts.image === 'cover' ? entry.cover_media_id : opts.image;
  const input = {
    kind: entry.kind, title: entry.title, dek: entry.dek, body: entry.body, topics: entry.topics ?? [], series,
    url: `${origin}${KIND_PATH[entry.kind]}/${entry.slug}`, template: t.template, custom: opts.message, button: t.buttons[entry.kind], imageId,
  };
  return { post: buildPost(input), defaultMessage: fillTemplate(t.template, input) };
}

/** `unconfirmed`: Telegram may or may not have posted it (see UNCONFIRMED); it is not retried by itself. */
export interface PostRecord { chat: string; status: 'sending' | 'sent' | 'failed' | 'unconfirmed'; attempts: number; messageId: number | null; error: string | null; at: string }

export async function postsFor(entryId: string): Promise<PostRecord[]> {
  try {
    const rows = await sql()`SELECT chat, status, attempts, message_id, error, updated_at,
        (status = 'sending' AND updated_at < now() - make_interval(mins => ${STUCK_MIN})) AS stuck
      FROM telegram_posts WHERE entry_id = ${entryId} ORDER BY chat`;
    return rows.map((r) => {
      const unconfirmed = !!r.stuck || (r.status === 'failed' && UNSURE.includes(r.error as string));
      return {
        chat: r.chat as string, status: unconfirmed ? 'unconfirmed' : r.status as PostRecord['status'], attempts: Number(r.attempts),
        messageId: r.message_id ? Number(r.message_id) : null, error: unconfirmed ? UNCONFIRMED : (r.error as string) ?? null, at: new Date(r.updated_at as string).toISOString(),
      };
    });
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Back to draft: forget what was posted, so publishing again posts again. */
export async function clearPosts(entryId: string): Promise<void> {
  try {
    await sql()`DELETE FROM telegram_posts WHERE entry_id = ${entryId}`;
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

/**
 * Claims (entry, chat) for this request: a new row, or a refused one that may be tried again.
 * An unconfirmed post (or one stuck in "sending") is only claimed by `force`: you pressing "Post again".
 */
async function claim(entryId: string, chat: string, force: boolean): Promise<boolean> {
  const fresh = await sql()`INSERT INTO telegram_posts (entry_id, chat, status) VALUES (${entryId}, ${chat}, 'sending') ON CONFLICT DO NOTHING RETURNING chat`;
  if (fresh.length) return true;
  const retry = await sql()`UPDATE telegram_posts SET status = 'sending', attempts = attempts + 1, updated_at = now()
    WHERE entry_id = ${entryId} AND chat = ${chat}
      AND ((status = 'failed' AND (${force} OR (NOT (coalesce(error, '') = ANY(${UNSURE}::text[])) AND attempts < ${MAX_ATTEMPTS} AND updated_at < now() - make_interval(secs => ${RETRY_AFTER_S}))))
        OR (${force} AND status = 'sending' AND updated_at < now() - make_interval(mins => ${STUCK_MIN})))
    RETURNING chat`;
  return retry.length > 0;
}

/** Posts cut off mid-send (the request ended before Telegram answered): their outcome is unknown. */
async function markStuckUnconfirmed(): Promise<void> {
  await sql()`UPDATE telegram_posts SET status = 'failed', error = ${UNCONFIRMED}, updated_at = now()
    WHERE status = 'sending' AND updated_at < now() - make_interval(mins => ${STUCK_MIN})`;
}

function origin(): string {
  return (env.SITE_URL || 'https://sxingxian.com').replace(/\/+$/, '');
}

/** Telegram's error, as advice. */
function plainError(d: string | undefined): string {
  const t = d ?? '';
  if (/not a member|not enough rights|have no rights|need administrator|kicked|CHAT_WRITE_FORBIDDEN/i.test(t)) return 'The bot isn’t allowed to post here. Make it an admin with “Post messages”.';
  if (/chat not found/i.test(t)) return 'Telegram can’t find this channel.';
  if (/Too Many Requests/i.test(t)) return 'Telegram asked to slow down. It’s tried again shortly.';
  if (/Unauthorized/i.test(t)) return 'Telegram no longer accepts the bot token. Replace it in Settings → Telegram.';
  return t || 'Telegram refused the post';
}

async function send(token: string, chat: string, post: Post, silent: boolean): Promise<TgReply<{ message_id: number }>> {
  const reply_markup = { inline_keyboard: [[{ text: post.button.text, url: post.button.url }]] };
  const disable_notification = silent; // members see it, with no sound or buzz
  if (post.imageId) {
    const r = await call<{ message_id: number }>(token, 'sendPhoto', { chat_id: chat, photo: `${origin()}/media/${post.imageId}`, caption: post.html, parse_mode: 'HTML', reply_markup, disable_notification }, SEND_TIMEOUT_MS);
    // Telegram clearly couldn't fetch the picture (e.g. the NAS is off): post the text alone rather than nothing.
    // Never after an uncertain answer: the photo post may already be in the channel.
    if (r.ok || r.uncertain || !/photo|file|URL|image|webpage/i.test(r.description ?? '')) return r;
  }
  return call<{ message_id: number }>(token, 'sendMessage', { chat_id: chat, text: post.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup, disable_notification }, SEND_TIMEOUT_MS);
}

/**
 * Posts a live entry to every channel that takes it and hasn't had it yet. Safe to call from several places
 * at once (each channel is claimed first). `only` limits it to one channel; `force` retries a failed one now.
 */
export async function announceEntry(entryId: string, { only, force = false }: { only?: string; force?: boolean } = {}): Promise<void> {
  const b = await bot();
  if (!b) return;
  const entry = await getPublicEntryById(entryId); // live entries only
  if (!entry || !entry.published_at) return;
  const opts = await getEntryTelegram(entryId);
  if (!opts.announce) return;
  const published = new Date(entry.published_at).getTime();
  if (published < new Date(b.connectedAt).getTime()) return; // published before the bot was connected
  const channels = (await channelsFor(entry.kind)).filter((c) => (!only || c.chat === only) && published >= new Date(c.addedAt).getTime() - 60_000);
  if (!channels.length) return;
  const { post } = await postFor(entry, opts, origin());
  const silent = await isSilent(opts);
  for (const c of channels) {
    if (!(await claim(entryId, c.chat, force))) continue;
    const r = await send(b.token, c.chat, post, silent);
    if (r.ok) await sql()`UPDATE telegram_posts SET status = 'sent', message_id = ${r.result?.message_id ?? null}, error = NULL, updated_at = now() WHERE entry_id = ${entryId} AND chat = ${c.chat}`;
    else await sql()`UPDATE telegram_posts SET status = 'failed', error = ${r.uncertain ? UNCONFIRMED : plainError(r.description)}, updated_at = now() WHERE entry_id = ${entryId} AND chat = ${c.chat}`;
  }
}

/**
 * The visit-driven check: entries that went live recently (a schedule reaching its time, or a post whose
 * first try failed) and still owe a channel a post.
 */
export async function announceDue(): Promise<void> {
  const b = await bot();
  if (!b) return;
  await markStuckUnconfirmed();
  const t = await getSetting('telegram');
  if (!t.channels.length) return;
  const n = (k: Entry['kind']) => t.channels.filter((c) => c.kinds.includes(k)).length;
  const rows = await sql()`
    SELECT e.id FROM entries e
    LEFT JOIN entry_telegram o ON o.entry_id = e.id
    WHERE e.status = 'published' AND e.is_public = true AND e.published_at <= now()
      AND e.published_at > now() - ${LATE_LIMIT}::interval AND e.published_at >= ${b.connectedAt}::timestamptz
      AND coalesce(o.announce, true)
      AND (SELECT count(*) FROM telegram_posts p WHERE p.entry_id = e.id
             AND (p.status IN ('sent', 'sending') OR p.error = ANY(${UNSURE}::text[]) OR p.attempts >= ${MAX_ATTEMPTS}::int))
        < (CASE e.kind WHEN 'post' THEN ${n('post')}::int WHEN 'project' THEN ${n('project')}::int WHEN 'gallery' THEN ${n('gallery')}::int ELSE ${n('film')}::int END)
    ORDER BY e.published_at LIMIT 10`;
  for (const r of rows) await announceEntry(r.id as string);
}
