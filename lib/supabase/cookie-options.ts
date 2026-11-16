import type { CookieOptions } from '@supabase/ssr';

export function adaptCookieOptions(
  options: CookieOptions | undefined,
  isHttps: boolean
): CookieOptions {
  if (!isHttps) {
    return {
      path: '/',
      ...options,
    };
  }

  return {
    path: '/',
    ...options,
    sameSite: 'none',
    secure: true,
  };
}

export function isHttpsRequest(headers: Headers, urlString?: string): boolean {
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) {
    return forwardedProto === 'https';
  }
  if (urlString?.startsWith('https://')) {
    return true;
  }
  if (process.env.APP_URL?.trim().startsWith('https://')) {
    return true;
  }
  return false;
}

export function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get('host')?.trim();
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.0.0.1')) {
    const proto = host.includes('localhost') ? 'http' : forwardedProto;
    return `${proto}://${host}`;
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && appUrl.startsWith('http')) {
    return appUrl.replace(/\/+$/, '');
  }

  return new URL(request.url).origin;
}
