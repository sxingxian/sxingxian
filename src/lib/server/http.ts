// SERVER-ONLY request/response helpers for API routes.
import type { ZodType } from 'zod';

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(init.headers ?? {}) },
  });
}

export function error(status: number, message: string, details?: unknown): Response {
  return json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** Read a JSON body with a hard size cap and validate it. */
export async function readBody<T>(request: Request, schema: ZodType<T>, maxBytes = 1_200_000): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return { ok: false, res: error(415, 'Expected application/json') };
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > maxBytes) return { ok: false, res: error(413, 'Body too large') };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, res: error(400, 'Could not read body') };
  }
  if (raw.length > maxBytes) return { ok: false, res: error(413, 'Body too large') };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, res: error(400, 'Invalid JSON') };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, res: error(422, 'Validation failed', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))) };
  }
  return { ok: true, data: result.data };
}

/** Postgres unique-violation → friendly 409. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505';
}
