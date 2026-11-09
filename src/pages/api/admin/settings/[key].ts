import type { APIRoute } from 'astro';
import { getSetting, putSetting } from '../../../../lib/server/repo';
import { error, json, readBody } from '../../../../lib/server/http';
import { settingsSchemas } from '../../../../lib/shared/schemas';
import { watermarkHasContent } from '../../../../lib/shared/watermark';
import type { SettingKey, SettingsMap } from '../../../../lib/shared/types';

function isKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(settingsSchemas, k);
}

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';
  if (!isKey(key)) return error(404, 'Unknown setting');
  return json({ value: await getSetting(key) });
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
  if (key === 'protection') {
    // logoHash belongs to the logo endpoint; keep whatever is stored.
    const p = { ...(value as SettingsMap['protection']), logoHash: (await getSetting('protection')).logoHash };
    if (!watermarkHasContent(p)) return error(400, 'Add watermark text or a logo');
    value = p as SettingsMap[typeof key];
  }
  await putSetting(key, value);
  return json({ value: await getSetting(key) });
};
