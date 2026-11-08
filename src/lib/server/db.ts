// SERVER-ONLY. Neon over HTTP. All queries use the tagged template, which sends
// values as bound parameters — never string-concatenated into SQL.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { env } from 'cloudflare:workers';

let client: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL secret is not configured');
    client = neon(env.DATABASE_URL);
  }
  return client;
}
