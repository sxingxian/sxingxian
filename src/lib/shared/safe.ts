// Small, dependency-free safety helpers shared by server and admin.

/**
 * Links we are willing to render: https URLs, mailto:, and site-relative paths.
 * Rejects javascript:, data:, vbscript:, protocol-relative (//evil.com) and
 * anything with control characters or whitespace tricks.
 */
export function isSafeHref(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const url = raw.trim();
  if (url.length === 0 || url.length > 2048) return false;
  if (/[\u0000-\u001F\u007F\s]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\');
  if (url.startsWith('#')) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

/** URL-safe slug from any title. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

// Linear-time in practice (each repetition starts with a literal '-'); callers
// also cap input length via isSlug() before matching.
// eslint-disable-next-line security/detect-unsafe-regex
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (s: string): boolean => s.length > 0 && s.length <= 80 && SLUG_RE.test(s);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only these embed providers/IDs are ever rendered as iframes. */
export function parseVideoUrl(raw: string): { provider: 'youtube' | 'vimeo'; id: string } | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : u.searchParams.get('v');
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'youtube', id } : null;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'youtube', id } : null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean).pop() ?? '';
      return /^\d{6,12}$/.test(id) ? { provider: 'vimeo', id } : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function embedSrc(provider: 'youtube' | 'vimeo', id: string): string | null {
  if (provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === 'vimeo' && /^\d{6,12}$/.test(id)) return `https://player.vimeo.com/video/${id}?dnt=1`;
  return null;
}
