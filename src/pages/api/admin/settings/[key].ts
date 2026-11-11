import type { APIRoute } from 'astro';
import { getMedia, getSetting, putSetting } from '../../../../lib/server/repo';
import { error, json, readBody } from '../../../../lib/server/http';
import { settingsSchemas } from '../../../../lib/shared/schemas';
import { watermarkHasContent } from '../../../../lib/shared/watermark';
import { cleanTopics, MAX_LIST_TOPICS, type SettingKey, type SettingsMap } from '../../../../lib/shared/types';

function isKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(settingsSchemas, k);
}

// Site settings also report where the default cover is stored, so Settings can warn when it's on the NAS
// (if the NAS is off, the fallback picture fails along with everything else).
async function respond(key: SettingKey): Promise<Response> {
  const value = await getSetting(key);
  if (key !== 'site') return json({ value });
  const id = (value as SettingsMap['site']).defaultCoverId;
  const coverHost = id ? ((await getMedia(id))?.provider ?? null) : null;
  return json({ value, coverHost });
}

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';
  if (!isKey(key)) return error(404, 'Unknown setting');
  return respond(key);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const key = params.key ?? '';
  if (!isKey(key)) return error(404, 'Unknown setting');
  const body = await readBody(request, settingsSchemas[key] as never, 50_000);
  if (!body.ok) return body.res;
  let value = body.data as SettingsMap[typeof key];
  if (key === 'wordpress') {
    // The address changes only through the WordPress address action (which checks it first).
    value = { ...(value as SettingsMap['wordpress']), baseUrl: (await getSetting('wordpress')).baseUrl ?? '' } as SettingsMap[typeof key];
  }
  if (key === 'site') {
    const v = value as SettingsMap['site'];
    // The default cover must be a photo in the library (it is shown wherever a picture is missing).
    if (v.defaultCoverId) {
      const m = await getMedia(v.defaultCoverId);
      if (!m || !m.mime.startsWith('image/')) return error(422, 'Pick a photo from the library for the default cover');
    }
    value = { ...v, topics: cleanTopics(v.topics, MAX_LIST_TOPICS), defaultCoverId: v.defaultCoverId ?? null } as SettingsMap[typeof key];
  }
  if (key === 'topics') {
    const v = value as SettingsMap['topics'];
    value = { work: cleanTopics(v.work, MAX_LIST_TOPICS), photos: cleanTopics(v.photos, MAX_LIST_TOPICS), film: cleanTopics(v.film, MAX_LIST_TOPICS) } as SettingsMap[typeof key];
  }
  if (key === 'protection') {
    // logoHash belongs to the logo endpoint; keep whatever is stored.
    const p = { ...(value as SettingsMap['protection']), logoHash: (await getSetting('protection')).logoHash };
    if (!watermarkHasContent(p)) return error(400, 'Add watermark text or a logo');
    value = p as SettingsMap[typeof key];
  }
  if (key === 'telegram') {
    // One row per channel; a channel added now only gets entries published from now on.
    const v = value as SettingsMap['telegram'];
    const before = new Map((await getSetting('telegram')).channels.map((c) => [c.chat, c.addedAt]));
    const seen = new Set<string>();
    const now = new Date().toISOString();
    const channels = v.channels.filter((c) => !seen.has(c.chat) && seen.add(c.chat)).map((c) => ({ ...c, kinds: [...new Set(c.kinds)], addedAt: before.get(c.chat) ?? now }));
    value = { ...v, channels } as SettingsMap[typeof key];
  }
  if (key === 'sponsor') {
    // Which ways to pay are connected is the server's to say (connecting and disconnecting set it).
    const v = value as SettingsMap['sponsor'];
    value = { ...v, amounts: [...v.amounts].sort((a, b) => a - b), methods: (await getSetting('sponsor')).methods } as SettingsMap[typeof key];
  }
  if (key === 'featured') {
    // Also write the previous release's fields, so a rollback still shows the first featured story.
    const f = value as SettingsMap['featured'];
    value = { entryIds: f.entryIds, order: f.order, mode: f.entryIds.length ? 'manual' : 'latest', entryId: f.entryIds[0] ?? null } as SettingsMap[typeof key];
  }
  await putSetting(key, value);
  return respond(key);
};
