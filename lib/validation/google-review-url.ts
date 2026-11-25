import { containsControlOrNewlineChars } from '@/lib/validation/messaging-safety';

const MAX_GOOGLE_REVIEW_URL_LENGTH = 2048;

const GOOGLE_OFFICIAL_TLDS = new Set([
  'com',
  'ad',
  'ae',
  'al',
  'am',
  'as',
  'at',
  'az',
  'ba',
  'be',
  'bg',
  'bi',
  'bj',
  'bs',
  'bt',
  'by',
  'ca',
  'cat',
  'cd',
  'cf',
  'cg',
  'ch',
  'ci',
  'cl',
  'cm',
  'cn',
  'co.ao',
  'co.bw',
  'co.ck',
  'co.cr',
  'co.id',
  'co.il',
  'co.in',
  'co.jp',
  'co.ke',
  'co.kr',
  'co.ls',
  'co.ma',
  'co.mz',
  'co.nz',
  'co.th',
  'co.tz',
  'co.ug',
  'co.uk',
  'co.uz',
  'co.ve',
  'co.vi',
  'co.za',
  'co.zm',
  'co.zw',
  'com.af',
  'com.ag',
  'com.ai',
  'com.ar',
  'com.au',
  'com.bd',
  'com.bh',
  'com.bn',
  'com.bo',
  'com.br',
  'com.bz',
  'com.co',
  'com.cu',
  'com.cy',
  'com.do',
  'com.ec',
  'com.eg',
  'com.et',
  'com.fj',
  'com.gh',
  'com.gi',
  'com.gt',
  'com.hk',
  'com.jm',
  'com.kh',
  'com.kw',
  'com.lb',
  'com.lc',
  'com.ly',
  'com.mm',
  'com.mt',
  'com.mx',
  'com.my',
  'com.na',
  'com.nf',
  'com.ng',
  'com.ni',
  'com.np',
  'com.om',
  'com.pa',
  'com.pe',
  'com.pg',
  'com.ph',
  'com.pk',
  'com.pr',
  'com.py',
  'com.qa',
  'com.sa',
  'com.sb',
  'com.sg',
  'com.sl',
  'com.sv',
  'com.tj',
  'com.tr',
  'com.tw',
  'com.ua',
  'com.uy',
  'com.vc',
  'com.vn',
  'cv',
  'cz',
  'de',
  'dj',
  'dk',
  'dm',
  'dz',
  'ee',
  'es',
  'fi',
  'fm',
  'fr',
  'ga',
  'ge',
  'gg',
  'gl',
  'gm',
  'gp',
  'gr',
  'gy',
  'hn',
  'hr',
  'ht',
  'hu',
  'ie',
  'im',
  'iq',
  'is',
  'it',
  'je',
  'jo',
  'kg',
  'ki',
  'kz',
  'la',
  'li',
  'lk',
  'lt',
  'lu',
  'lv',
  'md',
  'me',
  'mg',
  'mk',
  'ml',
  'mn',
  'ms',
  'mu',
  'mv',
  'mw',
  'ne',
  'nl',
  'no',
  'nr',
  'nu',
  'pl',
  'pn',
  'ps',
  'pt',
  'ro',
  'rs',
  'ru',
  'rw',
  'sc',
  'se',
  'sh',
  'si',
  'sk',
  'sm',
  'sn',
  'so',
  'sr',
  'st',
  'td',
  'tg',
  'tk',
  'tl',
  'tm',
  'tn',
  'to',
  'tt',
  'vg',
  'vu',
  'ws',
]);

export const GOOGLE_REVIEW_URL_INVALID_ERROR =
  'Ingresa un enlace https:// válido perteneciente a un dominio oficial de Google Maps o Google Business Profile (por ejemplo: g.page, maps.app.goo.gl, maps.google.com, google.com/maps o search.google.com/local/writereview).';

function isOfficialGoogleTld(tld: string): boolean {
  return GOOGLE_OFFICIAL_TLDS.has(tld);
}

function isDisallowedGoogleRedirectPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    lower === '/url' ||
    lower.startsWith('/url/') ||
    lower === '/aclk' ||
    lower.startsWith('/aclk/') ||
    lower === '/amp' ||
    lower.startsWith('/amp/')
  );
}

function isMapsOrReviewPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    lower === '/maps' ||
    lower.startsWith('/maps/') ||
    lower === '/local/writereview' ||
    lower.startsWith('/local/writereview/') ||
    lower === '/local/reviews' ||
    lower.startsWith('/local/reviews/')
  );
}

export function validateGoogleReviewUrl(
  rawUrl: string | null | undefined
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = rawUrl?.trim() ?? '';

  if (
    !trimmed ||
    trimmed.length > MAX_GOOGLE_REVIEW_URL_LENGTH ||
    containsControlOrNewlineChars(trimmed)
  ) {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.endsWith('.')) {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  const pathname = parsed.pathname || '/';

  if (isDisallowedGoogleRedirectPath(pathname)) {
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  // 1. Google Business Profile short links: https://g.page/r/.../review o https://g.page/slug
  if (hostname === 'g.page' || hostname === 'www.g.page') {
    if (pathname.length <= 1) {
      return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
    }
    return { ok: true, value: parsed.toString() };
  }

  // 2. Google Maps short links: https://maps.app.goo.gl/...
  if (hostname === 'maps.app.goo.gl') {
    if (pathname.length <= 1) {
      return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
    }
    return { ok: true, value: parsed.toString() };
  }

  // 3. Legacy Google Maps short links: https://goo.gl/maps/...
  if (hostname === 'goo.gl' || hostname === 'www.goo.gl') {
    if (!pathname.toLowerCase().startsWith('/maps/') || pathname.length <= 6) {
      return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
    }
    return { ok: true, value: parsed.toString() };
  }

  // 4. Google Maps / Google Search Review official domains
  if (hostname.startsWith('maps.google.')) {
    const tld = hostname.slice('maps.google.'.length);
    if (isOfficialGoogleTld(tld)) {
      return { ok: true, value: parsed.toString() };
    }
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  if (hostname.startsWith('search.google.')) {
    const tld = hostname.slice('search.google.'.length);
    const lowerPath = pathname.toLowerCase();
    if (
      isOfficialGoogleTld(tld) &&
      (lowerPath === '/local/writereview' ||
        lowerPath.startsWith('/local/writereview/') ||
        lowerPath === '/local/reviews' ||
        lowerPath.startsWith('/local/reviews/'))
    ) {
      return { ok: true, value: parsed.toString() };
    }
    return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
  }

  const googlePrefix = hostname.startsWith('www.google.')
    ? 'www.google.'
    : hostname.startsWith('google.')
      ? 'google.'
      : null;

  if (googlePrefix) {
    const tld = hostname.slice(googlePrefix.length);
    if (isOfficialGoogleTld(tld) && isMapsOrReviewPath(pathname)) {
      return { ok: true, value: parsed.toString() };
    }
  }

  return { ok: false, error: GOOGLE_REVIEW_URL_INVALID_ERROR };
}

export function sanitizeGoogleReviewUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;
  const result = validateGoogleReviewUrl(rawUrl);
  return result.ok ? result.value : null;
}
