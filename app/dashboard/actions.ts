'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getComparablePhoneKey,
  getPhoneSearchSuffix,
  normalizePhoneToE164,
} from '@/lib/messaging/phone';
import {
  findPendingRequestsWithHistory,
  type PendingRequestDuplicateAlert,
  type RequestHistoryRecord,
} from '@/lib/messaging/request-history';
import {
  evaluateTrialStatus,
  MAX_PENDING_REQUESTS_ACTIVE,
  MAX_PENDING_REQUESTS_TRIAL,
  MAX_SCHEDULE_AHEAD_MS,
  normalizeGoogleReviewUrl,
  SCHEDULE_PAST_GRACE_MS,
} from '@/lib/subscription/trial';
import { checkSlidingWindowRateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { validateGoogleReviewUrl } from '@/lib/validation/google-review-url';
import { validateAndSanitizeTemplateName } from '@/lib/validation/messaging-safety';
import { isValidUuid } from '@/lib/validation/uuid';
import type {
  Business,
  ReviewRequest,
  ReviewRequestStatus,
} from '@/types/database';

export async function signOutAction(): Promise<{ error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    redirect('/login');
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      error: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
    };
  }

  redirect('/login');
}

export interface UpdateBusinessSettingsInput {
  businessName: string;
  googleReviewUrl: string;
  delayMinutes: number;
}

function mapDashboardDbError(
  rawMessage: string | null | undefined,
  fallback: string,
  context: string
): string {
  const msg = rawMessage?.trim() ?? '';
  if (!msg) {
    return fallback;
  }

  const isFriendlySpanishDomainError =
    msg.includes('Plan Trial') ||
    msg.includes('período de prueba') ||
    msg.includes('suscripción') ||
    msg.includes('correo electrónico') ||
    msg.includes('prueba gratuita') ||
    msg.includes('solicitudes');

  if (isFriendlySpanishDomainError) {
    return msg;
  }

  console.error(`[DashboardActions] ${context}:`, msg);
  return fallback;
}

export async function updateBusinessSettingsAction(
  input: UpdateBusinessSettingsInput
): Promise<{ business?: Business; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const businessNameCheck = validateAndSanitizeTemplateName(
    input.businessName ?? '',
    'nombre del negocio'
  );
  if (!businessNameCheck.ok) {
    return { error: businessNameCheck.error };
  }

  const businessName = businessNameCheck.value;
  const rawGoogleReviewUrl = input.googleReviewUrl.trim();
  let googleReviewUrl: string | null = null;
  const delayMinutes = Number(input.delayMinutes);

  if (rawGoogleReviewUrl.length > 0) {
    const googleUrlCheck = validateGoogleReviewUrl(rawGoogleReviewUrl);
    if (!googleUrlCheck.ok) {
      return { error: googleUrlCheck.error };
    }
    googleReviewUrl = googleUrlCheck.value;
  }

  if (
    !Number.isInteger(delayMinutes) ||
    delayMinutes < 0 ||
    delayMinutes > 10080
  ) {
    return {
      error:
        'El retraso en minutos debe ser un número entero entre 0 y 10080 (7 días).',
    };
  }

  const { data: currentBusiness } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  const previousStatus = currentBusiness?.subscription_status ?? 'trialing';
  const normalizedUrl = googleReviewUrl
    ? normalizeGoogleReviewUrl(googleReviewUrl)
    : null;

  const { data, error } = await supabase
    .from('businesses')
    .update({
      business_name: businessName,
      google_review_url: googleReviewUrl,
      delay_minutes: delayMinutes,
    })
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error || !data) {
    return {
      error: mapDashboardDbError(
        error?.message,
        'No se pudo actualizar la configuración del negocio.',
        'updateBusinessSettingsAction'
      ),
    };
  }

  let finalBusiness = data as Business;
  let duplicateUrlRestrictionMsg: string | null = null;

  // Caso 1: El trigger de PostgreSQL restringió el Trial automáticamente al detectar URL reutilizada
  if (
    previousStatus === 'trialing' &&
    finalBusiness.subscription_status === 'inactive'
  ) {
    duplicateUrlRestrictionMsg =
      finalBusiness.trial_restricted_reason ||
      'Este enlace de Google Reviews ya utilizó una prueba gratuita anteriormente. Activa un plan de pago para continuar.';
  }

  // Caso 2: Refuerzo en backend con adminClient (útil también antes de ejecutar la migración SQL)
  if (
    previousStatus !== 'active' &&
    finalBusiness.subscription_status === 'trialing' &&
    normalizedUrl
  ) {
    const adminClient = createAdminClient();
    if (adminClient) {
      let hasDuplicateUrl = false;

      const { data: claimMatches, error: claimErr } = await adminClient
        .from('trial_claims')
        .select('id, business_id')
        .eq('claim_type', 'google_review_url')
        .eq('claim_value', normalizedUrl)
        .neq('business_id', finalBusiness.id)
        .limit(1);

      if (!claimErr && claimMatches && claimMatches.length > 0) {
        hasDuplicateUrl = true;
      } else {
        const { data: bizMatches } = await adminClient
          .from('businesses')
          .select('id')
          .eq('normalized_google_review_url', normalizedUrl)
          .neq('id', finalBusiness.id)
          .limit(1);

        if (bizMatches && bizMatches.length > 0) {
          hasDuplicateUrl = true;
        }
      }

      if (hasDuplicateUrl) {
        const restrictionReason =
          'Este enlace de Google Reviews ya utilizó una prueba gratuita anteriormente. Activa un plan de pago para continuar.';

        const { data: restrictedBiz, error: restrictErr } = await adminClient
          .from('businesses')
          .update({
            subscription_status: 'inactive',
            trial_restricted_reason: restrictionReason,
            normalized_google_review_url: normalizedUrl,
          })
          .eq('id', finalBusiness.id)
          .select('*')
          .single();

        if (!restrictErr && restrictedBiz) {
          finalBusiness = restrictedBiz as Business;
        } else {
          const { data: fallbackRestricted } = await adminClient
            .from('businesses')
            .update({ subscription_status: 'inactive' })
            .eq('id', finalBusiness.id)
            .select('*')
            .single();

          if (fallbackRestricted) {
            finalBusiness = {
              ...(fallbackRestricted as Business),
              trial_restricted_reason: restrictionReason,
            };
          }
        }

        duplicateUrlRestrictionMsg = restrictionReason;
      }
    }
  }

  revalidatePath('/dashboard');

  if (duplicateUrlRestrictionMsg) {
    return {
      business: finalBusiness,
      error: duplicateUrlRestrictionMsg,
    };
  }

  return { business: finalBusiness };
}

export interface CheckCustomerPhoneHistoryInput {
  businessId?: string;
  phone: string;
  dialCode?: string;
}

export interface CustomerPhoneHistoryResult {
  hasPreviousRequests: boolean;
  totalCount: number;
  latestStatus: ReviewRequestStatus | null;
  latestCreatedAt: string | null;
  latestScheduledFor: string | null;
  error?: string;
}

export async function checkCustomerPhoneHistoryAction(
  input: CheckCustomerPhoneHistoryInput
): Promise<CustomerPhoneHistoryResult> {
  const emptyResult: CustomerPhoneHistoryResult = {
    hasPreviousRequests: false,
    totalCount: 0,
    latestStatus: null,
    latestCreatedAt: null,
    latestScheduledFor: null,
  };

  const rawPhone = input.phone?.trim() ?? '';
  const dialCode = input.dialCode?.trim() || '+1';
  const targetPhoneKey = getComparablePhoneKey(rawPhone, dialCode);
  if (!targetPhoneKey) {
    return emptyResult;
  }

  const supabase = await createClient();
  if (!supabase) {
    return {
      ...emptyResult,
      error: 'La conexión con Supabase no está configurada.',
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ...emptyResult,
      error: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return emptyResult;
  }

  if (input.businessId && input.businessId !== business.id) {
    return emptyResult;
  }

  const phoneSuffix = getPhoneSearchSuffix(targetPhoneKey);
  let historyQuery = supabase
    .from('review_requests')
    .select('customer_phone, status, created_at, scheduled_for')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (phoneSuffix) {
    historyQuery = historyQuery.ilike('customer_phone', `%${phoneSuffix}%`);
  }

  const { data: rows, error: queryError } = await historyQuery;

  if (queryError || !rows || rows.length === 0) {
    return emptyResult;
  }

  const matchingRows = rows.filter((row) => {
    const storedKey = getComparablePhoneKey(row.customer_phone ?? '');
    return Boolean(storedKey && storedKey === targetPhoneKey);
  });

  if (matchingRows.length === 0) {
    return emptyResult;
  }

  const latest = matchingRows[0];
  return {
    hasPreviousRequests: true,
    totalCount: matchingRows.length,
    latestStatus: latest.status as ReviewRequestStatus,
    latestCreatedAt: latest.created_at ?? null,
    latestScheduledFor: latest.scheduled_for ?? null,
  };
}

export interface CheckPendingBatchDuplicatesInput {
  businessId?: string;
  includeFuture?: boolean;
}

const PENDING_BATCH_CHECK_LIMIT = 10;

export async function checkPendingRequestsDuplicateHistoryAction(
  input: CheckPendingBatchDuplicatesInput = {}
): Promise<{ alerts: PendingRequestDuplicateAlert[]; error?: string }> {
  const supabase = await createClient();
  if (!supabase) {
    return {
      alerts: [],
      error: 'La conexión con Supabase no está configurada.',
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      alerts: [],
      error: 'Tu sesión expiró. Vuelve a iniciar sesión.',
    };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      alerts: [],
      error: 'No se encontró el perfil de tu negocio.',
    };
  }

  if (input.businessId && input.businessId !== business.id) {
    return {
      alerts: [],
      error: 'No autorizado para consultar otro negocio.',
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const includeFuture = Boolean(input.includeFuture);

  let pendingBatchQuery = supabase
    .from('review_requests')
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(PENDING_BATCH_CHECK_LIMIT);

  if (!includeFuture) {
    pendingBatchQuery = pendingBatchQuery.lte('scheduled_for', nowIso);
  }

  const { data: pendingBatchRows, error: probeError } =
    await pendingBatchQuery;
  if (probeError) {
    return {
      alerts: [],
      error: 'No se pudo verificar el historial de solicitudes pendientes.',
    };
  }

  if (!pendingBatchRows || pendingBatchRows.length === 0) {
    return { alerts: [] };
  }

  const suffixSet = new Set<string>();
  for (const row of pendingBatchRows) {
    const comparableKey = getComparablePhoneKey(row.customer_phone ?? '');
    const suffix = comparableKey ? getPhoneSearchSuffix(comparableKey) : null;
    if (suffix) {
      suffixSet.add(suffix);
    }
  }

  if (suffixSet.size === 0) {
    return { alerts: [] };
  }

  const orFilters = Array.from(suffixSet)
    .map((suffix) => `customer_phone.ilike.%${suffix}%`)
    .join(',');

  const { data: historyRows, error: historyError } = await supabase
    .from('review_requests')
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .eq('business_id', business.id)
    .or(orFilters)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (historyError) {
    return {
      alerts: [],
      error: 'No se pudo consultar el historial de envíos del negocio.',
    };
  }

  const mergedById = new Map<string, RequestHistoryRecord>();
  for (const row of pendingBatchRows as RequestHistoryRecord[]) {
    mergedById.set(row.id, row);
  }
  for (const row of (historyRows ?? []) as RequestHistoryRecord[]) {
    mergedById.set(row.id, row);
  }

  const alerts = findPendingRequestsWithHistory(
    Array.from(mergedById.values()),
    {
      businessId: business.id,
      onlyDueAsOfMs: includeFuture ? undefined : nowMs,
      limitPending: PENDING_BATCH_CHECK_LIMIT,
    }
  );

  return { alerts };
}

export interface CreateReviewRequestInput {
  customerName: string;
  customerPhone: string;
}

export async function createReviewRequestAction(
  input: CreateReviewRequestInput
): Promise<{ request?: ReviewRequest; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  if (!user.email_confirmed_at) {
    return {
      error:
        'Debes confirmar tu correo electrónico antes de programar o enviar solicitudes de reseña.',
    };
  }

  const customerNameCheck = validateAndSanitizeTemplateName(
    input.customerName ?? '',
    'nombre del cliente'
  );
  if (!customerNameCheck.ok) {
    return { error: customerNameCheck.error };
  }

  const customerName = customerNameCheck.value;
  const customerPhone = normalizePhoneToE164(input.customerPhone);

  if (!customerPhone) {
    return {
      error:
        'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).',
    };
  }

  const userCreationRate = checkSlidingWindowRateLimit(
    `create-request:user:${user.id}`,
    {
      maxRequests: 10,
      windowMs: 60_000,
    }
  );
  if (!userCreationRate.allowed) {
    return {
      error:
        'Has creado demasiadas solicitudes en un minuto. Espera unos segundos antes de agregar otra.',
    };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error:
        'No se encontró el perfil de tu negocio. Recarga la página o guarda tu configuración primero.',
    };
  }

  const typedBusiness = business as Business;

  // Límite de tasa respaldado en BD (último minuto y última hora) por negocio
  const oneMinuteAgoIso = new Date(Date.now() - 60_000).toISOString();
  const oneHourAgoIso = new Date(Date.now() - 3_600_000).toISOString();
  const [recentMinuteRes, recentHourRes] = await Promise.all([
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id)
      .gte('created_at', oneMinuteAgoIso),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id)
      .gte('created_at', oneHourAgoIso),
  ]);

  if ((recentMinuteRes.count ?? 0) >= 10 || (recentHourRes.count ?? 0) >= 60) {
    return {
      error:
        'Has alcanzado el límite temporal de creación de solicitudes. Espera un momento antes de continuar.',
    };
  }

  // Los negocios con subscription_status === 'active' operan sin restricciones de Trial
  if (typedBusiness.subscription_status !== 'active') {
    const { count: existingRequestsCount, error: countError } = await supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id);

    if (countError) {
      return {
        error:
          'No se pudo verificar el límite de solicitudes de tu plan. Inténtalo nuevamente.',
      };
    }

    const trialEval = evaluateTrialStatus(typedBusiness, {
      totalRequestsCount: existingRequestsCount ?? 0,
    });

    if (trialEval.isCreationBlocked) {
      return {
        error:
          trialEval.creationErrorMessage ??
          'Tu plan actual no permite crear más solicitudes en este momento.',
      };
    }
  }

  // Tope máximo de solicitudes pendientes simultáneas en cola (50 Trial / 500 Activo)
  const maxPendingLimit =
    typedBusiness.subscription_status === 'active'
      ? MAX_PENDING_REQUESTS_ACTIVE
      : MAX_PENDING_REQUESTS_TRIAL;

  const { count: pendingRequestsCount, error: pendingCountError } =
    await supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id)
      .eq('status', 'pending');

  if (pendingCountError) {
    return {
      error:
        'No se pudo verificar el límite de solicitudes pendientes en cola. Inténtalo nuevamente.',
    };
  }

  if ((pendingRequestsCount ?? 0) >= maxPendingLimit) {
    return {
      error: `Has alcanzado el máximo de ${maxPendingLimit} solicitudes pendientes simultáneas en cola. Envía o elimina solicitudes pendientes antes de agregar más.`,
    };
  }

  const nowMs = Date.now();
  const delayMinutes = Math.max(0, Number(typedBusiness.delay_minutes ?? 60));
  const scheduledForMs =
    delayMinutes === 0 ? nowMs - 1000 : nowMs + delayMinutes * 60_000;

  if (
    scheduledForMs < nowMs - SCHEDULE_PAST_GRACE_MS ||
    scheduledForMs > nowMs + MAX_SCHEDULE_AHEAD_MS
  ) {
    return {
      error:
        'La fecha de envío programada debe estar dentro de los próximos 30 días.',
    };
  }

  const scheduledFor = new Date(scheduledForMs).toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from('review_requests')
    .insert({
      business_id: business.id,
      customer_name: customerName,
      customer_phone: customerPhone,
      status: 'pending',
      scheduled_for: scheduledFor,
    })
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .single();

  if (insertError || !inserted) {
    return {
      error: mapDashboardDbError(
        insertError?.message,
        'No se pudo registrar la solicitud de reseña.',
        'createReviewRequestAction'
      ),
    };
  }

  revalidatePath('/dashboard');
  return { request: inserted as ReviewRequest };
}

export interface UpdateReviewRequestInput {
  requestId: string;
  customerName: string;
  customerPhone: string;
  scheduledForIso?: string;
  sendNow?: boolean;
}

export async function updateReviewRequestAction(
  input: UpdateReviewRequestInput
): Promise<{ request?: ReviewRequest; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  if (!user.email_confirmed_at) {
    return {
      error:
        'Debes confirmar tu correo electrónico antes de modificar o enviar solicitudes.',
    };
  }

  const requestId = input.requestId.trim();
  if (!isValidUuid(requestId)) {
    return { error: 'Identificador de solicitud inválido.' };
  }

  const customerNameCheck = validateAndSanitizeTemplateName(
    input.customerName ?? '',
    'nombre del cliente'
  );
  if (!customerNameCheck.ok) {
    return { error: customerNameCheck.error };
  }

  const customerName = customerNameCheck.value;
  const customerPhone = normalizePhoneToE164(input.customerPhone);

  if (!customerPhone) {
    return {
      error:
        'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).',
    };
  }

  let nextScheduledFor: string;
  if (input.sendNow) {
    nextScheduledFor = new Date(Date.now() - 1000).toISOString();
  } else {
    const rawDate = input.scheduledForIso?.trim() ?? '';
    const parsedDate = new Date(rawDate);
    if (!rawDate || Number.isNaN(parsedDate.getTime())) {
      return { error: 'Selecciona una fecha y hora programada válida.' };
    }

    const nowMs = Date.now();
    const targetMs = parsedDate.getTime();
    if (targetMs < nowMs - SCHEDULE_PAST_GRACE_MS) {
      return {
        error:
          'La fecha programada no puede estar en el pasado. Selecciona una hora actual o futura (o usa "Enviar ahora").',
      };
    }
    if (targetMs > nowMs + MAX_SCHEDULE_AHEAD_MS) {
      return {
        error:
          'La fecha programada no puede superar los 30 días hacia adelante.',
      };
    }

    nextScheduledFor = parsedDate.toISOString();
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error: 'No se encontró el perfil de tu negocio.',
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from('review_requests')
    .update({
      customer_name: customerName,
      customer_phone: customerPhone,
      scheduled_for: nextScheduledFor,
    })
    .eq('id', requestId)
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .maybeSingle();

  if (updateError) {
    return {
      error: mapDashboardDbError(
        updateError.message,
        'No se pudo actualizar la solicitud de reseña.',
        'updateReviewRequestAction'
      ),
    };
  }

  if (!updated) {
    return {
      error:
        'No se encontró la solicitud o ya fue procesada (solo se pueden editar solicitudes pendientes).',
    };
  }

  revalidatePath('/dashboard');
  return { request: updated as ReviewRequest };
}

export async function deleteReviewRequestAction(
  requestIdInput: string
): Promise<{ deletedId?: string; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const requestId = requestIdInput.trim();
  if (!isValidUuid(requestId)) {
    return { error: 'Identificador de solicitud inválido.' };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error: 'No se encontró el perfil de tu negocio.',
    };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('review_requests')
    .delete()
    .eq('id', requestId)
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (deleteError) {
    return {
      error: mapDashboardDbError(
        deleteError.message,
        'No se pudo eliminar la solicitud pendiente.',
        'deleteReviewRequestAction'
      ),
    };
  }

  if (!deleted) {
    return {
      error:
        'No se encontró la solicitud o ya fue procesada (solo se pueden eliminar solicitudes pendientes).',
    };
  }

  revalidatePath('/dashboard');
  return { deletedId: deleted.id };
}

export async function updateSubscriptionStatusAction(
  nextStatus: 'active' | 'trialing'
): Promise<{ business?: Business; error?: string }> {
  void nextStatus;
  return {
    error:
      'El estado de la suscripción solo puede actualizarse tras verificar un pago válido.',
  };
}
