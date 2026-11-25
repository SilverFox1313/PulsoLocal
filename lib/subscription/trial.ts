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

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '10minmail.com',
  'armyspy.com',
  'burnermail.io',
  'cool.fr.nf',
  'courriel.fr.nf',
  'crazymailing.com',
  'cuvox.de',
  'dayrep.com',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'einrot.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemailgenerator.com',
  'fleckens.hu',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'gustr.com',
  'inboxbear.com',
  'incognitomail.org',
  'jetable.fr.nf',
  'jourrapide.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailexpire.com',
  'mailinator.com',
  'mailinator.net',
  'mailinator.org',
  'mailinator2.com',
  'mailnesia.com',
  'mailnull.com',
  'mega.zik.dj',
  'mintemail.com',
  'mohmal.com',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'mytemp.email',
  'nada.email',
  'nada.ltd',
  'nomail.xl.cx',
  'nospam.ze.tc',
  'rhyta.com',
  'sharklasers.com',
  'spamgourmet.com',
  'speed.1s.fr',
  'superrito.com',
  'teleworm.us',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tenminutemail.com',
  'throwaway.email',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trash-mail.com',
  'trashmail.com',
  'trashmail.me',
  'trashmail.net',
  'trashmail.org',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

export function isDisposableEmailDomain(domain: string): boolean {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(cleanDomain)) {
    return true;
  }
  for (const blocked of DISPOSABLE_EMAIL_DOMAINS) {
    if (cleanDomain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
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
  hasSubaddressing: boolean;
  isDisposable: boolean;
}

export function analyzeEmailForTrialAbuse(
  rawEmail: string
): EmailTrialAnalysis | null {
  const normalizedEmail = rawEmail.trim().toLowerCase();
  const atIndex = normalizedEmail.indexOf('@');
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return null;
  }

  const rawLocal = normalizedEmail.slice(0, atIndex);
  let domain = normalizedEmail.slice(atIndex + 1);
  if (
    !domain ||
    domain.includes('@') ||
    !domain.includes('.') ||
    domain.startsWith('.') ||
    domain.endsWith('.') ||
    domain.includes('..')
  ) {
    return null;
  }

  const plusIndex = rawLocal.indexOf('+');
  const hasSubaddressing = plusIndex !== -1;
  let canonicalLocal = hasSubaddressing ? rawLocal.slice(0, plusIndex) : rawLocal;

  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }
  if (domain === 'gmail.com') {
    canonicalLocal = canonicalLocal.replaceAll('.', '');
  }

  if (!canonicalLocal) {
    return null;
  }

  return {
    normalizedEmail,
    canonicalEmail: `${canonicalLocal}@${domain}`,
    hasSubaddressing,
    isDisposable: isDisposableEmailDomain(domain),
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
