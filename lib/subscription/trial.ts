import type { Business, SubscriptionStatus } from '@/types/database';

export const TRIAL_DURATION_DAYS = 7;
export const TRIAL_MAX_REQUESTS = 15;
export const MAX_PENDING_REQUESTS_TRIAL = 50;
export const MAX_PENDING_REQUESTS_ACTIVE = 500;
export const MAX_SCHEDULE_AHEAD_DAYS = 30;
export const MS_PER_DAY = 86_400_000;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * MS_PER_DAY;
export const MAX_SCHEDULE_AHEAD_MS = MAX_SCHEDULE_AHEAD_DAYS * MS_PER_DAY;
export const SCHEDULE_PAST_GRACE_MS = 5 * 60_000;

export const ALLOWED_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.es',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
]);

export const ALLOWED_EMAIL_PROVIDER_ERROR =
  'Usa un correo de Gmail, Outlook, Hotmail, Yahoo o iCloud.';

export const SUBADDRESSING_TRIAL_RESTRICTED_REASON =
  'El correo electrónico usa un alias con "+" y no califica para el Trial gratuito automático. Selecciona un plan para comenzar.';

export function isAllowedEmailProvider(domain: string): boolean {
  const cleanDomain = domain.trim().toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.has(cleanDomain);
}

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'hl',
  'gl',
  'source',
  'ved',
  'usg',
  'opi',
  'sca_esv',
]);

export interface TrialEvaluation {
  status: SubscriptionStatus;
  isActivePlan: boolean;
  isTrial: boolean;
  remainingDays: number;
  isExpired: boolean;
  totalRequestsCount: number;
  dispatchedRequestsCount: number;
  remainingRequests: number;
  isCreationBlocked: boolean;
  isSendingBlocked: boolean;
  blockReason:
    | 'trial_expired'
    | 'trial_limit_reached'
    | 'trial_restricted'
    | 'plan_inactive'
    | null;
  creationErrorMessage: string | null;
  sendingErrorMessage: string | null;
}

export function getRemainingTrialDays(
  createdAtIso: string,
  nowMs = Date.now()
): number {
  const createdMs = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdMs)) return TRIAL_DURATION_DAYS;
  const elapsedMs = Math.max(0, nowMs - createdMs);
  if (elapsedMs >= TRIAL_DURATION_MS) {
    return 0;
  }
  const elapsedDays = Math.floor(elapsedMs / MS_PER_DAY);
  return Math.max(0, TRIAL_DURATION_DAYS - elapsedDays);
}

export function isTrialExpiredByDate(
  createdAtIso: string,
  nowMs = Date.now()
): boolean {
  const createdMs = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs >= TRIAL_DURATION_MS;
}

export function evaluateTrialStatus(
  business: Pick<
    Business,
    'subscription_status' | 'created_at' | 'trial_restricted_reason'
  >,
  counts: {
    totalRequestsCount: number;
    dispatchedRequestsCount?: number;
  },
  nowMs = Date.now()
): TrialEvaluation {
  const status = business.subscription_status;
  const totalRequestsCount = Math.max(0, counts.totalRequestsCount);
  const dispatchedRequestsCount = Math.max(
    0,
    counts.dispatchedRequestsCount ?? totalRequestsCount
  );

  if (status === 'active') {
    return {
      status,
      isActivePlan: true,
      isTrial: false,
      remainingDays: 0,
      isExpired: false,
      totalRequestsCount,
      dispatchedRequestsCount,
      remainingRequests: Number.POSITIVE_INFINITY,
      isCreationBlocked: false,
      isSendingBlocked: false,
      blockReason: null,
      creationErrorMessage: null,
      sendingErrorMessage: null,
    };
  }

  if (status !== 'trialing') {
    const isRestricted = Boolean(business.trial_restricted_reason);
    const baseMsg = isRestricted
      ? business.trial_restricted_reason!
      : status === 'past_due'
        ? 'Tu suscripción tiene un pago pendiente. Actualiza tu método de pago para crear solicitudes y enviar mensajes por WhatsApp.'
        : 'Tu suscripción no está activa. Selecciona un plan de pago para crear solicitudes y enviar mensajes por WhatsApp.';

    return {
      status,
      isActivePlan: false,
      isTrial: false,
      remainingDays: 0,
      isExpired: false,
      totalRequestsCount,
      dispatchedRequestsCount,
      remainingRequests: 0,
      isCreationBlocked: true,
      isSendingBlocked: true,
      blockReason: isRestricted ? 'trial_restricted' : 'plan_inactive',
      creationErrorMessage: baseMsg,
      sendingErrorMessage: baseMsg,
    };
  }

  const remainingDays = getRemainingTrialDays(business.created_at, nowMs);
  const isExpired = isTrialExpiredByDate(business.created_at, nowMs);
  const remainingRequests = Math.max(0, TRIAL_MAX_REQUESTS - totalRequestsCount);

  if (isExpired) {
    return {
      status,
      isActivePlan: false,
      isTrial: true,
      remainingDays: 0,
      isExpired: true,
      totalRequestsCount,
      dispatchedRequestsCount,
      remainingRequests,
      isCreationBlocked: true,
      isSendingBlocked: true,
      blockReason: 'trial_expired',
      creationErrorMessage:
        'Tu período de prueba de 7 días ha finalizado. Activa un plan para seguir creando solicitudes de reseña.',
      sendingErrorMessage:
        'Tu período de prueba de 7 días ha finalizado. Activa un plan para seguir enviando mensajes por WhatsApp.',
    };
  }

  const creationLimitReached = totalRequestsCount >= TRIAL_MAX_REQUESTS;
  const sendingLimitReached = dispatchedRequestsCount >= TRIAL_MAX_REQUESTS;

  return {
    status,
    isActivePlan: false,
    isTrial: true,
    remainingDays,
    isExpired: false,
    totalRequestsCount,
    dispatchedRequestsCount,
    remainingRequests,
    isCreationBlocked: creationLimitReached,
    isSendingBlocked: sendingLimitReached,
    blockReason:
      creationLimitReached || sendingLimitReached ? 'trial_limit_reached' : null,
    creationErrorMessage: creationLimitReached
      ? `Has alcanzado el límite de ${TRIAL_MAX_REQUESTS} solicitudes del Plan Trial. Activa un plan para continuar.`
      : null,
    sendingErrorMessage: sendingLimitReached
      ? `Has alcanzado el límite de ${TRIAL_MAX_REQUESTS} envíos por WhatsApp del Plan Trial. Activa un plan para continuar.`
      : null,
  };
}

export interface EmailTrialAnalysis {
  normalizedEmail: string;
  canonicalEmail: string;
  domain: string;
  hasSubaddressing: boolean;
  isAllowedProvider: boolean;
}

export function analyzeEmailForTrialAbuse(
  rawEmail: string
): EmailTrialAnalysis | null {
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (!normalizedEmail || /\s/.test(normalizedEmail)) {
    return null;
  }

  const atIndex = normalizedEmail.indexOf('@');
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return null;
  }

  const rawLocal = normalizedEmail.slice(0, atIndex);
  const rawDomain = normalizedEmail.slice(atIndex + 1);
  if (
    !rawDomain ||
    rawDomain.includes('@') ||
    !rawDomain.includes('.') ||
    rawDomain.startsWith('.') ||
    rawDomain.endsWith('.') ||
    rawDomain.includes('..') ||
    rawLocal.startsWith('.') ||
    rawLocal.endsWith('.') ||
    rawLocal.includes('..')
  ) {
    return null;
  }

  const plusIndex = rawLocal.indexOf('+');
  const hasSubaddressing = plusIndex !== -1;
  let canonicalLocal = hasSubaddressing ? rawLocal.slice(0, plusIndex) : rawLocal;

  const isAllowedProvider = isAllowedEmailProvider(rawDomain);
  let canonicalDomain = rawDomain;
  if (canonicalDomain === 'googlemail.com') {
    canonicalDomain = 'gmail.com';
  }
  if (canonicalDomain === 'gmail.com') {
    canonicalLocal = canonicalLocal.replaceAll('.', '');
  }

  if (!canonicalLocal) {
    return null;
  }

  return {
    normalizedEmail,
    canonicalEmail: `${canonicalLocal}@${canonicalDomain}`,
    domain: rawDomain,
    hasSubaddressing,
    isAllowedProvider,
  };
}

export function normalizeGoogleReviewUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const cleanPath = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');

    const filteredParams: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lowerKey)) {
        return;
      }
      filteredParams.push([key, value]);
    });

    filteredParams.sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
    );

    const queryString =
      filteredParams.length > 0
        ? `?${filteredParams
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')}`
        : '';

    return `${hostname}${cleanPath}${queryString}`;
  } catch {
    return null;
  }
}
