import type { APIRoute } from 'astro';
import { getSetting, putSetting } from '../../../../lib/server/repo';
import { error, json, readBody } from '../../../../lib/server/http';
import { settingsSchemas } from '../../../../lib/shared/schemas';
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
  await putSetting(key, body.data as SettingsMap[typeof key]);
  return json({ value: await getSetting(key) });
};
