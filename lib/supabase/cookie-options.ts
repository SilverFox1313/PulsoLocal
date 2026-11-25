import type { CookieOptions } from '@supabase/ssr';

const VALID_HOST_REGEX = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

function cleanEnv(value: string | undefined): string {
  return value?.trim().replace(/^['"]+|['"]+$/g, '').trim() ?? '';
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV)
  );
}

function isLocalHostname(hostOrHostname: string): boolean {
  const hostname = hostOrHostname.split(':')[0]?.toLowerCase() ?? '';
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  );
}

function parseOriginFromEnvUrl(rawUrl: string | undefined): string | null {
  const cleaned = cleanEnv(rawUrl);
  if (!cleaned || !/^https?:\/\//i.test(cleaned)) {
    return null;
  }
  try {
    const parsed = new URL(cleaned);
    if (isProductionRuntime() && isLocalHostname(parsed.hostname)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseHttpsOriginFromHost(rawHost: string | undefined): string | null {
  const cleaned = cleanEnv(rawHost)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  if (!cleaned || !VALID_HOST_REGEX.test(cleaned)) {
    return null;
  }
  if (isProductionRuntime() && isLocalHostname(cleaned)) {
    return null;
  }
  return `https://${cleaned}`;
}

function sanitizeHeaderHost(rawHeader: string | null): string | null {
  const candidate = rawHeader?.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!candidate || !VALID_HOST_REGEX.test(candidate)) {
    return null;
  }
  return candidate;
}

export function getAllowedPublicHosts(request?: Request): Set<string> {
  const allowed = new Set<string>();

  const envOrigins = [
    parseOriginFromEnvUrl(process.env.APP_URL),
    parseOriginFromEnvUrl(process.env.NEXT_PUBLIC_APP_URL),
    parseHttpsOriginFromHost(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    parseHttpsOriginFromHost(process.env.VERCEL_URL),
    parseHttpsOriginFromHost(process.env.VERCEL_BRANCH_URL),
  ];

  for (const origin of envOrigins) {
    if (origin) {
      allowed.add(new URL(origin).host.toLowerCase());
    }
  }

  const extraHosts = cleanEnv(process.env.ALLOWED_HOSTS);
  if (extraHosts) {
    for (const entry of extraHosts.split(',')) {
      const normalized = entry
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
      if (normalized && VALID_HOST_REGEX.test(normalized)) {
        allowed.add(normalized);
      }
    }
  }

  if (request) {
    try {
      const reqHost = new URL(request.url).host.toLowerCase();
      if (reqHost && !reqHost.startsWith('0.0.0.0')) {
        if (!isProductionRuntime() || !isLocalHostname(reqHost)) {
          allowed.add(reqHost);
        }
      }
    } catch {
      // Ignorar URL inválida
    }
  }

  return allowed;
}

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
  const isProd = isProductionRuntime();
  const appOrigin =
    parseOriginFromEnvUrl(process.env.APP_URL) ??
    parseOriginFromEnvUrl(process.env.NEXT_PUBLIC_APP_URL);
  const prodHostOrigin = parseHttpsOriginFromHost(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  );
  const vercelOrigin = parseHttpsOriginFromHost(process.env.VERCEL_URL);
  const allowedHosts = getAllowedPublicHosts(request);

  const forwardedHost = sanitizeHeaderHost(
    request.headers.get('x-forwarded-host')
  );
  const headerHost = sanitizeHeaderHost(request.headers.get('host'));
  const rawForwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const safeProto = rawForwardedProto === 'http' ? 'http' : 'https';

  if (isProd) {
    if (appOrigin) {
      return appOrigin;
    }
    if (process.env.VERCEL_ENV === 'production' && prodHostOrigin) {
      return prodHostOrigin;
    }

    const candidateHost = forwardedHost ?? headerHost;
    if (candidateHost && allowedHosts.has(candidateHost)) {
      const proto = isLocalHostname(candidateHost) ? 'http' : safeProto;
      return `${proto}://${candidateHost}`;
    }

    if (prodHostOrigin) {
      return prodHostOrigin;
    }
    if (vercelOrigin) {
      return vercelOrigin;
    }
    return new URL(request.url).origin;
  }

  const candidateHost = forwardedHost ?? headerHost;
  if (
    candidateHost &&
    !candidateHost.startsWith('0.0.0.0') &&
    (allowedHosts.has(candidateHost) ||
      isLocalHostname(candidateHost) ||
      allowedHosts.size === 0)
  ) {
    const proto = isLocalHostname(candidateHost)
      ? rawForwardedProto === 'https'
        ? 'https'
        : 'http'
      : safeProto;
    return `${proto}://${candidateHost}`;
  }

  if (appOrigin) {
    return appOrigin;
  }

  return new URL(request.url).origin;
}

export function isValidSameOriginPost(request: Request): boolean {
  const originHeader = request.headers.get('origin')?.trim();
  const refererHeader = request.headers.get('referer')?.trim();

  let requestSourceOrigin: string | null = null;
  if (originHeader && originHeader !== 'null') {
    try {
      requestSourceOrigin = new URL(originHeader).origin;
    } catch {
      return false;
    }
  } else if (refererHeader) {
    try {
      requestSourceOrigin = new URL(refererHeader).origin;
    } catch {
      return false;
    }
  } else {
    return false;
  }

  const publicOrigin = getPublicOrigin(request);
  if (requestSourceOrigin === publicOrigin) {
    return true;
  }

  const sourceHost = new URL(requestSourceOrigin).host.toLowerCase();
  const allowedHosts = getAllowedPublicHosts(request);
  if (allowedHosts.has(sourceHost)) {
    return true;
  }

  const headerHost =
    sanitizeHeaderHost(request.headers.get('x-forwarded-host')) ??
    sanitizeHeaderHost(request.headers.get('host'));

  if (headerHost && sourceHost === headerHost && !isProductionRuntime()) {
    return true;
  }

  return false;
}
