import {
  buildReminderMessage,
  buildReviewLink,
  canSimulateWhatsAppInCurrentEnv,
  getWhatsAppEnvStatus,
  MAX_WHATSAPP_SEND_ATTEMPTS,
  sendWhatsAppOrSimulate,
} from '@/lib/messaging/send-reminder';
import { checkPersistentSlidingWindowRateLimit } from '@/lib/security/rate-limit';
import {
  evaluateTrialStatus,
  isTrialExpiredByDate,
  TRIAL_MAX_REQUESTS,
} from '@/lib/subscription/trial';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  MAX_TEMPLATE_NAME_LENGTH,
  sanitizeWhatsAppTemplateVariable,
} from '@/lib/validation/messaging-safety';
import type { Business, SubscriptionStatus } from '@/types/database';

const BATCH_SIZE = 10;
const GLOBAL_CANDIDATE_POOL = BATCH_SIZE * 5;
const CONCURRENCY_LIMIT = 4;
const STALE_PROCESSING_MS = 5 * 60_000;
const UPDATE_RETRY_DELAYS_MS = [150, 400];
const MAX_ATTEMPTS_REACHED_MSG = `Se alcanzó el límite máximo de ${MAX_WHATSAPP_SEND_ATTEMPTS} intentos de envío por WhatsApp.`;

interface SupabaseLikeError {
  code?: string | null;
  message?: string | null;
}

type AdminOrServerClient = NonNullable<ReturnType<typeof createAdminClient>>;

interface ClaimedGlobalRow {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_for: string;
  attempts?: number;
  business_name: string;
  message_template?: string;
  subscription_status: SubscriptionStatus;
  business_created_at: string;
}

interface ClaimedUserRow {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_for: string;
  attempts?: number;
}

interface PendingRequestWithBusiness {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_for: string;
  attempts?: number;
  businesses:
    | {
        business_name: string;
        subscription_status: SubscriptionStatus;
        created_at: string;
      }
    | Array<{
        business_name: string;
        subscription_status: SubscriptionStatus;
        created_at: string;
      }>
    | null;
}

export interface ProcessedReminderItem {
  id: string;
  customerName: string;
  customerPhone: string;
  reviewLink: string;
  messagePreview: string;
  deliveryMode: 'whatsapp_cloud' | 'simulated';
}

export interface FailedReminderItem {
  id: string;
  error: string;
  status?: 'failed' | 'pending';
}

export interface ReminderExecutionSuccess {
  ok: true;
  mode: 'whatsapp_cloud' | 'simulated';
  processed: number;
  failed: number;
  pendingFutureCount: number;
  items: ProcessedReminderItem[];
  errors: FailedReminderItem[];
  executedAt: string;
}

export interface ReminderExecutionFailure {
  ok: false;
  error: string;
  mode?: 'whatsapp_cloud' | 'simulated';
  processed?: number;
  failed?: number;
  pendingFutureCount?: number;
  items?: ProcessedReminderItem[];
  errors?: FailedReminderItem[];
  executedAt?: string;
}

export interface ReminderExecutionResult {
  status: number;
  missingServiceRoleKey?: boolean;
  body: ReminderExecutionSuccess | ReminderExecutionFailure;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingFunctionError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    Boolean(error.message?.includes('Could not find the function'))
  );
}

function isMissingColumnError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes('column'))
  );
}

function isCheckConstraintError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;
  return (
    error.code === '23514' ||
    Boolean(error.message?.toLowerCase().includes('check constraint'))
  );
}

async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    await Promise.all(slice.map((item) => worker(item)));
  }
}

async function rescueStuckProcessingFallback(
  client: AdminOrServerClient,
  staleBeforeIso: string,
  nowIso: string,
  source: string,
  businessId?: string
): Promise<void> {
  // 1. Reconciliar filas en 'processing' que ya obtuvieron confirmación externa de Meta
  let reconcileQuery = client
    .from('review_requests')
    .update({ status: 'sent', processing_started_at: null })
    .eq('status', 'processing')
    .or('whatsapp_message_id.not.is.null,sent_at.not.is.null');

  if (businessId) {
    reconcileQuery = reconcileQuery.eq('business_id', businessId);
  }

  const { data: reconciledRows, error: reconcileError } =
    await reconcileQuery.select('id');

  if (reconcileError && !isMissingColumnError(reconcileError)) {
    console.error('[Reminders] Error al reconciliar envíos confirmados en processing', {
      source,
      businessId: businessId ?? null,
      error: reconcileError.message,
    });
  } else if (reconciledRows && reconciledRows.length > 0) {
    console.info('[Reminders] Filas confirmadas por Meta reconciliadas a sent', {
      source,
      businessId: businessId ?? null,
      reconciledCount: reconciledRows.length,
    });
  }

  // 2a. Marcar como failed las filas atascadas que ya agotaron el máximo de intentos
  let exhaustedStaleQuery = client
    .from('review_requests')
    .update({
      status: 'failed',
      processing_started_at: null,
      last_error: MAX_ATTEMPTS_REACHED_MSG,
    })
    .eq('status', 'processing')
    .is('whatsapp_message_id', null)
    .is('sent_at', null)
    .gte('attempts', MAX_WHATSAPP_SEND_ATTEMPTS)
    .or(
      `processing_started_at.lte.${staleBeforeIso},processing_started_at.is.null`
    );

  if (businessId) {
    exhaustedStaleQuery = exhaustedStaleQuery.eq('business_id', businessId);
  }

  const { data: exhaustedRows, error: exhaustedError } =
    await exhaustedStaleQuery.select('id');

  if (exhaustedError && !isMissingColumnError(exhaustedError)) {
    console.error('[Reminders] Error al cerrar solicitudes atascadas sin reintentos', {
      source,
      businessId: businessId ?? null,
      error: exhaustedError.message,
    });
  } else if (exhaustedRows && exhaustedRows.length > 0) {
    console.warn('[Reminders] Solicitudes atascadas cerradas como failed por límite de intentos', {
      source,
      businessId: businessId ?? null,
      failedCount: exhaustedRows.length,
    });
  }

  // 2b. Rescatar únicamente filas atascadas sin confirmación de envío y con intentos disponibles
  let rescueQuery = client
    .from('review_requests')
    .update({ status: 'pending', processing_started_at: null })
    .eq('status', 'processing')
    .is('whatsapp_message_id', null)
    .is('sent_at', null)
    .lt('attempts', MAX_WHATSAPP_SEND_ATTEMPTS)
    .or(
      `processing_started_at.lte.${staleBeforeIso},processing_started_at.is.null`
    );

  if (businessId) {
    rescueQuery = rescueQuery.eq('business_id', businessId);
  }

  const { data: rescuedRows, error: rescueError } =
    await rescueQuery.select('id');

  if (rescueError && isMissingColumnError(rescueError)) {
    let legacyRescue = client
      .from('review_requests')
      .update({ status: 'pending', processing_started_at: null })
      .eq('status', 'processing')
      .or(
        `processing_started_at.lte.${staleBeforeIso},processing_started_at.is.null`
      );

    if (businessId) {
      legacyRescue = legacyRescue.eq('business_id', businessId);
    }

    const { data: legacyRows, error: legacyErr } =
      await legacyRescue.select('id');

    if (legacyErr) {
      console.error('[Reminders] Error al rescatar solicitudes atascadas (fallback)', {
        source,
        businessId: businessId ?? null,
        error: legacyErr.message,
      });
    } else if (legacyRows && legacyRows.length > 0) {
      console.warn('[Reminders] Solicitudes atascadas rescatadas a pending (fallback)', {
        source,
        businessId: businessId ?? null,
        rescuedCount: legacyRows.length,
        nowIso,
      });
    }
    return;
  }

  if (rescueError) {
    console.error('[Reminders] Error al rescatar solicitudes atascadas en processing', {
      source,
      businessId: businessId ?? null,
      error: rescueError.message,
    });
  } else if (rescuedRows && rescuedRows.length > 0) {
    console.warn('[Reminders] Solicitudes atascadas sin confirmación rescatadas a pending', {
      source,
      businessId: businessId ?? null,
      rescuedCount: rescuedRows.length,
      staleBeforeIso,
    });
  }
}

function formatTerminalAttemptError(
  errMsg: string,
  retryable: boolean,
  maxAttemptsReached: boolean
): string {
  const cleanMsg = errMsg.trim();
  if (!retryable || !maxAttemptsReached) {
    return cleanMsg.slice(0, 500);
  }

  const strippedRetryHint = cleanMsg
    .replace(/\s*Se reintentará automáticamente(?:\s+en unos minutos)?\.?$/i, '')
    .trim();

  const base = strippedRetryHint
    ? strippedRetryHint.endsWith('.')
      ? strippedRetryHint
      : `${strippedRetryHint}.`
    : '';

  return `${base ? `${base} ` : ''}${MAX_ATTEMPTS_REACHED_MSG}`.slice(0, 500);
}

async function markRequestAsSent(
  client: AdminOrServerClient,
  requestId: string,
  externalId: string | undefined,
  source: string,
  businessId?: string
): Promise<{ ok: boolean; error?: string }> {
  const sentAtIso = new Date().toISOString();
  const fullPayload = {
    status: 'sent' as const,
    processing_started_at: null,
    whatsapp_message_id: externalId ?? null,
    sent_at: sentAtIso,
    last_error: null,
  };
  const minimalPayload = {
    status: 'sent' as const,
    processing_started_at: null,
  };

  let useDirectFallback = false;
  let useMinimal = false;
  let lastErrorMessage = 'No se pudo actualizar el estado a sent.';

  // 1. Ruta atómica preferida vía RPC SECURITY DEFINER (funciona con service_role o usuario autenticado)
  for (let attempt = 0; attempt <= UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(UPDATE_RETRY_DELAYS_MS[attempt - 1]);
    }

    if (!useDirectFallback) {
      const { data: rpcData, error: rpcErr } = await client.rpc(
        'complete_review_request_delivery',
        {
          p_request_id: requestId,
          p_external_id: externalId ?? null,
          p_sent_at: sentAtIso,
          p_business_id: businessId ?? null,
        }
      );

      if (!rpcErr) {
        const rpcPayload = rpcData as { ok?: boolean; error?: string } | null;
        if (rpcPayload?.ok) {
          return { ok: true };
        }
        lastErrorMessage =
          rpcPayload?.error ?? 'La solicitud ya no estaba en procesamiento.';
      } else if (isMissingFunctionError(rpcErr)) {
        useDirectFallback = true;
      } else {
        lastErrorMessage = rpcErr.message;
        continue;
      }
    }

    if (useDirectFallback) {
      let query = client
        .from('review_requests')
        .update(useMinimal ? minimalPayload : fullPayload)
        .eq('id', requestId)
        .eq('status', 'processing');

      if (businessId) {
        query = query.eq('business_id', businessId);
      }

      const { error } = await query;
      if (!error) {
        return { ok: true };
      }

      lastErrorMessage = error.message;
      if (!useMinimal && isMissingColumnError(error)) {
        useMinimal = true;
        let retryMinimal = client
          .from('review_requests')
          .update(minimalPayload)
          .eq('id', requestId)
          .eq('status', 'processing');
        if (businessId) {
          retryMinimal = retryMinimal.eq('business_id', businessId);
        }
        const { error: minErr } = await retryMinimal;
        if (!minErr) {
          return { ok: true };
        }
        lastErrorMessage = minErr.message;
      }
    }
  }

  // 2. Respaldo crítico: guardar al menos marca externa de envío + sent_at y verificar error explícitamente
  if (!useMinimal) {
    let markerQuery = client
      .from('review_requests')
      .update({
        whatsapp_message_id: externalId ?? null,
        sent_at: sentAtIso,
        last_error:
          'Mensaje aceptado por WhatsApp; falló la transición final de estado en base de datos.',
      })
      .eq('id', requestId)
      .eq('status', 'processing');

    if (businessId) {
      markerQuery = markerQuery.eq('business_id', businessId);
    }

    const { error: markerError } = await markerQuery;
    if (markerError) {
      console.error('[Reminders] Falló también el respaldo de marca externa tras envío en Meta', {
        source,
        requestId,
        externalId: externalId ?? null,
        markerError: markerError.message,
      });
    } else {
      console.warn('[Reminders] Marca externa de envío guardada tras fallo en transición a sent', {
        source,
        requestId,
        externalId: externalId ?? null,
      });
    }
  }

  console.error('[Reminders] Error crítico al persistir estado sent tras envío en Meta', {
    source,
    requestId,
    externalId: externalId ?? null,
    error: lastErrorMessage,
  });

  return { ok: false, error: lastErrorMessage };
}

async function markRequestAsFailedOrPending(
  client: AdminOrServerClient,
  requestId: string,
  retryable: boolean,
  errMsg: string,
  source: string,
  options: {
    businessId?: string;
    attemptCount?: number;
  } = {}
): Promise<'failed' | 'pending' | undefined> {
  const { businessId, attemptCount } = options;

  let resolvedAttempts = attemptCount;
  if (typeof resolvedAttempts !== 'number') {
    let attemptLookup = client
      .from('review_requests')
      .select('attempts')
      .eq('id', requestId);
    if (businessId) {
      attemptLookup = attemptLookup.eq('business_id', businessId);
    }
    const { data: attemptRow } = await attemptLookup.maybeSingle();
    resolvedAttempts =
      typeof attemptRow?.attempts === 'number' ? attemptRow.attempts : 1;
  }

  const maxAttemptsReached = resolvedAttempts >= MAX_WHATSAPP_SEND_ATTEMPTS;
  const effectiveRetryable = retryable && !maxAttemptsReached;
  const targetStatus: 'failed' | 'pending' = effectiveRetryable
    ? 'pending'
    : 'failed';
  const truncatedError = formatTerminalAttemptError(
    errMsg,
    retryable,
    maxAttemptsReached
  );

  // 1. Ruta atómica vía RPC SECURITY DEFINER
  const { data: rpcData, error: rpcErr } = await client.rpc(
    'fail_or_requeue_review_request',
    {
      p_request_id: requestId,
      p_retryable: effectiveRetryable,
      p_error: truncatedError,
      p_max_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
      p_business_id: businessId ?? null,
    }
  );

  if (!rpcErr) {
    const rpcPayload = rpcData as {
      ok?: boolean;
      status?: 'failed' | 'pending';
      error?: string;
    } | null;

    if (rpcPayload?.ok && rpcPayload.status) {
      return rpcPayload.status;
    }

    console.error('[Reminders] RPC fail_or_requeue_review_request devolvió error', {
      source,
      requestId,
      targetStatus,
      error: rpcPayload?.error ?? 'Respuesta inesperada',
    });
    return undefined;
  }

  if (!isMissingFunctionError(rpcErr)) {
    console.error('[Reminders] Error en RPC fail_or_requeue_review_request', {
      source,
      requestId,
      targetStatus,
      error: rpcErr.message,
    });
    return undefined;
  }

  // 2. Fallback directo si la RPC aún no ha sido migrada
  let query = client
    .from('review_requests')
    .update({
      status: targetStatus,
      processing_started_at: null,
      last_error: truncatedError,
    })
    .eq('id', requestId)
    .eq('status', 'processing');

  if (businessId) {
    query = query.eq('business_id', businessId);
  }

  const { error } = await query;
  if (!error) {
    return targetStatus;
  }

  if (isMissingColumnError(error)) {
    let withoutLastErr = client
      .from('review_requests')
      .update({
        status: targetStatus,
        processing_started_at: null,
      })
      .eq('id', requestId)
      .eq('status', 'processing');

    if (businessId) {
      withoutLastErr = withoutLastErr.eq('business_id', businessId);
    }

    const { error: fallbackErr } = await withoutLastErr;
    if (!fallbackErr) {
      return targetStatus;
    }

    if (!effectiveRetryable && isCheckConstraintError(fallbackErr)) {
      console.warn('[Reminders] BD sin estado failed migrado; revirtiendo a pending temporalmente', {
        source,
        requestId,
      });
      let legacyRevert = client
        .from('review_requests')
        .update({ status: 'pending', processing_started_at: null })
        .eq('id', requestId)
        .eq('status', 'processing');
      if (businessId) {
        legacyRevert = legacyRevert.eq('business_id', businessId);
      }
      const { error: revertErr } = await legacyRevert;
      if (revertErr) {
        console.error('[Reminders] Error al revertir a pending (fallback)', {
          source,
          requestId,
          error: revertErr.message,
        });
        return undefined;
      }
      return 'pending';
    }

    console.error('[Reminders] Error al actualizar estado tras fallo de envío', {
      source,
      requestId,
      targetStatus,
      error: fallbackErr.message,
    });
    return undefined;
  }

  if (!effectiveRetryable && isCheckConstraintError(error)) {
    console.warn('[Reminders] BD sin estado failed migrado; revirtiendo a pending temporalmente', {
      source,
      requestId,
    });
    let legacyRevert = client
      .from('review_requests')
      .update({ status: 'pending', processing_started_at: null })
      .eq('id', requestId)
      .eq('status', 'processing');
    if (businessId) {
      legacyRevert = legacyRevert.eq('business_id', businessId);
    }
    const { error: revertErr } = await legacyRevert;
    if (revertErr) {
      console.error('[Reminders] Error al revertir a pending (fallback)', {
        source,
        requestId,
        error: revertErr.message,
      });
      return undefined;
    }
    return 'pending';
  }

  console.error('[Reminders] Error al actualizar estado tras fallo de envío', {
    source,
    requestId,
    targetStatus,
    error: error.message,
  });
  return undefined;
}

async function isBusinessOwnerEmailConfirmed(
  adminClient: AdminOrServerClient,
  businessId: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  const cached = cache.get(businessId);
  if (typeof cached === 'boolean') {
    return cached;
  }

  const { data: bizRow, error: bizError } = await adminClient
    .from('businesses')
    .select('user_id')
    .eq('id', businessId)
    .maybeSingle();

  if (bizError || !bizRow?.user_id) {
    return false;
  }

  const { data: userRes, error: userErr } =
    await adminClient.auth.admin.getUserById(bizRow.user_id);

  if (userErr || !userRes?.user) {
    return false;
  }

  const confirmed = Boolean(userRes.user.email_confirmed_at);
  cache.set(businessId, confirmed);
  return confirmed;
}

export async function processGlobalPendingReminders(
  origin: string,
  source = 'cron:global'
): Promise<ReminderExecutionResult> {
  const whatsAppStatus = getWhatsAppEnvStatus();
  const isSimulatedMode =
    !whatsAppStatus.isConfigured && canSimulateWhatsAppInCurrentEnv();
  const executionMode: 'whatsapp_cloud' | 'simulated' = isSimulatedMode
    ? 'simulated'
    : 'whatsapp_cloud';

  console.info('[Reminders] Iniciando procesamiento global de pendientes', {
    source,
    origin,
    mode: executionMode,
    hasAccessToken: whatsAppStatus.hasAccessToken,
    hasPhoneNumberId: whatsAppStatus.hasPhoneNumberId,
    isConfigured: whatsAppStatus.isConfigured,
  });

  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error(
      '[Reminders] Falta SUPABASE_SERVICE_ROLE_KEY para procesamiento global.',
      { source }
    );
    return {
      status: 500,
      missingServiceRoleKey: true,
      body: {
        ok: false,
        error:
          'Configuración de servidor incompleta para ejecutar el envío automático global.',
      },
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleBeforeIso = new Date(nowMs - STALE_PROCESSING_MS).toISOString();

  let rowsToSend: ClaimedGlobalRow[] = [];
  const blockedErrors: FailedReminderItem[] = [];

  // 1. Intentar reserva atómica en PostgreSQL (evita TOCTOU, inanición de cola y reenvíos duplicados)
  const { data: rpcClaimed, error: rpcError } = await adminClient.rpc(
    'claim_global_pending_review_requests',
    {
      p_limit: BATCH_SIZE,
      p_now: nowIso,
      p_stale_before: staleBeforeIso,
    }
  );

  if (!rpcError) {
    rowsToSend = (rpcClaimed ?? []) as ClaimedGlobalRow[];
    console.info('[Reminders] Lote global reclamado atómicamente vía RPC', {
      source,
      claimed: rowsToSend.length,
    });
  } else if (!isMissingFunctionError(rpcError)) {
    console.error('[Reminders] Error en RPC claim_global_pending_review_requests', {
      source,
      code: rpcError.code ?? null,
      error: rpcError.message,
    });
    return {
      status: 500,
      body: {
        ok: false,
        error: 'No se pudieron consultar o reservar las solicitudes pendientes.',
      },
    };
  } else {
    // Fallback compatible si la migración Bloque 6 aún no fue aplicada en Supabase
    await rescueStuckProcessingFallback(
      adminClient,
      staleBeforeIso,
      nowIso,
      source
    );

    const { data: dueRequests, error: fetchError } = await adminClient
      .from('review_requests')
      .select(
        'id, business_id, customer_name, customer_phone, scheduled_for, attempts, businesses!inner(business_name, subscription_status, created_at)'
      )
      .eq('status', 'pending')
      .lt('attempts', MAX_WHATSAPP_SEND_ATTEMPTS)
      .lte('scheduled_for', nowIso)
      .in('businesses.subscription_status', ['active', 'trialing'])
      .order('scheduled_for', { ascending: true })
      .limit(GLOBAL_CANDIDATE_POOL);

    if (fetchError) {
      console.error('[Reminders] Error al consultar solicitudes pendientes globales', {
        source,
        error: fetchError.message,
      });
      return {
        status: 500,
        body: {
          ok: false,
          error: 'No se pudieron consultar las solicitudes pendientes.',
        },
      };
    }

    const rawCandidateRows = (dueRequests ?? []) as PendingRequestWithBusiness[];
    const businessAllowance = new Map<
      string,
      { remainingSends: number; blockError: string | null }
    >();

    for (const row of rawCandidateRows) {
      if (rowsToSend.length >= BATCH_SIZE) {
        break;
      }

      const biz = Array.isArray(row.businesses)
        ? row.businesses[0]
        : row.businesses;

      if (!biz) {
        continue;
      }

      if (biz.subscription_status !== 'active') {
        let allowance = businessAllowance.get(row.business_id);
        if (!allowance) {
          if (biz.subscription_status !== 'trialing') {
            allowance = {
              remainingSends: 0,
              blockError:
                'Suscripción inactiva o restringida. Activa un plan para enviar mensajes por WhatsApp.',
            };
          } else if (isTrialExpiredByDate(biz.created_at, nowMs)) {
            allowance = {
              remainingSends: 0,
              blockError:
                'Tu período de prueba de 7 días ha finalizado. Activa un plan para continuar enviando por WhatsApp.',
            };
          } else {
            const { count: dispatchedCount, error: countErr } =
              await adminClient
                .from('review_requests')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', row.business_id)
                .in('status', ['processing', 'sent', 'clicked', 'completed']);

            if (countErr) {
              allowance = {
                remainingSends: 0,
                blockError:
                  'No se pudo validar el límite de envíos del Plan Trial.',
              };
            } else {
              const remaining = Math.max(
                0,
                TRIAL_MAX_REQUESTS - (dispatchedCount ?? 0)
              );
              allowance = {
                remainingSends: remaining,
                blockError:
                  remaining === 0
                    ? `Has alcanzado el límite de ${TRIAL_MAX_REQUESTS} envíos del Plan Trial. Activa un plan para continuar.`
                    : null,
              };
            }
          }
          businessAllowance.set(row.business_id, allowance);
        }

        if (allowance.remainingSends <= 0) {
          blockedErrors.push({
            id: row.id,
            error:
              allowance.blockError ??
              'Límite del Plan Trial alcanzado. Activa un plan para continuar.',
            status: 'pending',
          });
          continue;
        }

        allowance.remainingSends -= 1;
      }

      // Reserva por fila para que un bloqueo en un negocio no aborte a los demás
      const nextAttempts = (row.attempts ?? 0) + 1;
      const { data: claimedRow, error: claimErr } = await adminClient
        .from('review_requests')
        .update({
          status: 'processing',
          processing_started_at: nowIso,
          attempts: nextAttempts,
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (claimErr) {
        console.error('[Reminders] Error al reservar fila en lote global:', {
          source,
          requestId: row.id,
          error: claimErr.message,
        });
        blockedErrors.push({
          id: row.id,
          error: 'No se pudo reservar la solicitud para envío en este momento.',
          status: 'pending',
        });
        continue;
      }

      if (claimedRow) {
        rowsToSend.push({
          id: row.id,
          business_id: row.business_id,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          scheduled_for: row.scheduled_for,
          attempts: nextAttempts,
          business_name: biz.business_name,
          subscription_status: biz.subscription_status,
          business_created_at: biz.created_at,
        });
      }
    }
  }

  if (rowsToSend.length === 0) {
    return {
      status: 200,
      body: {
        ok: true,
        mode: executionMode,
        processed: 0,
        failed: blockedErrors.length,
        pendingFutureCount: 0,
        items: [],
        errors: blockedErrors,
        executedAt: nowIso,
      },
    };
  }

  const processedItems: ProcessedReminderItem[] = [];
  const failedItems: FailedReminderItem[] = [];
  const ownerConfirmedCache = new Map<string, boolean>();

  await runInChunks(rowsToSend, CONCURRENCY_LIMIT, async (row) => {
    const isOwnerConfirmed = await isBusinessOwnerEmailConfirmed(
      adminClient,
      row.business_id,
      ownerConfirmedCache
    );

    if (!isOwnerConfirmed) {
      const unconfirmedMsg =
        'La cuenta propietaria aún no ha confirmado su correo electrónico.';
      const resultingStatus = await markRequestAsFailedOrPending(
        adminClient,
        row.id,
        true,
        unconfirmedMsg,
        source,
        { attemptCount: row.attempts }
      );
      failedItems.push({
        id: row.id,
        error: unconfirmedMsg,
        ...(resultingStatus ? { status: resultingStatus } : {}),
      });
      return;
    }

    const safeBusinessName = sanitizeWhatsAppTemplateVariable(
      row.business_name ?? '',
      'Nuestro Negocio',
      MAX_TEMPLATE_NAME_LENGTH
    );
    const safeCustomerName = sanitizeWhatsAppTemplateVariable(
      row.customer_name ?? '',
      'Cliente',
      MAX_TEMPLATE_NAME_LENGTH
    );
    const reviewLink = buildReviewLink(origin, row.id);
    const messagePreview = buildReminderMessage('', {
      customerName: safeCustomerName,
      businessName: safeBusinessName,
      reviewLink,
    });

    const delivery = await sendWhatsAppOrSimulate(row.customer_phone, {
      source,
      requestId: row.id,
      templateParams: {
        customerName: safeCustomerName,
        businessName: safeBusinessName,
        reviewLink,
      },
    });

    if (!delivery.ok) {
      const errMsg = delivery.error ?? 'Error al enviar mensaje.';
      const retryable = delivery.retryable !== false && !delivery.ambiguous;
      console.error('[Reminders] Falló el envío en lote global', {
        source,
        requestId: row.id,
        retryable,
        ambiguous: Boolean(delivery.ambiguous),
        attempts: row.attempts ?? null,
        error: errMsg,
      });

      const resultingStatus = await markRequestAsFailedOrPending(
        adminClient,
        row.id,
        retryable,
        errMsg,
        source,
        { attemptCount: row.attempts }
      );

      failedItems.push({
        id: row.id,
        error: errMsg,
        ...(resultingStatus ? { status: resultingStatus } : {}),
      });
      return;
    }

    const persistResult = await markRequestAsSent(
      adminClient,
      row.id,
      delivery.externalId,
      source
    );

    if (!persistResult.ok) {
      failedItems.push({
        id: row.id,
        error:
          'El mensaje se envió por WhatsApp, pero falló la actualización de estado en la base de datos.',
      });
      return;
    }

    processedItems.push({
      id: row.id,
      customerName: safeCustomerName,
      customerPhone: row.customer_phone,
      reviewLink,
      messagePreview,
      deliveryMode: delivery.mode,
    });
  });

  const allErrors = [...failedItems, ...blockedErrors];

  console.info('[Reminders] Finalizó procesamiento global de pendientes', {
    source,
    mode: executionMode,
    processed: processedItems.length,
    failed: allErrors.length,
    errors: allErrors,
  });

  const hasTransientOrPersistenceFailure = failedItems.some(
    (item) => item.status !== 'failed'
  );

  if (processedItems.length === 0 && hasTransientOrPersistenceFailure) {
    return {
      status: 502,
      body: {
        ok: false,
        error:
          failedItems[0]?.error ??
          'Fallaron todos los envíos automáticos por error de proveedor o base de datos.',
        mode: executionMode,
        processed: 0,
        failed: allErrors.length,
        pendingFutureCount: 0,
        items: [],
        errors: allErrors,
        executedAt: nowIso,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: executionMode,
      processed: processedItems.length,
      failed: allErrors.length,
      pendingFutureCount: 0,
      items: processedItems,
      errors: allErrors,
      executedAt: nowIso,
    },
  };
}

export async function processUserPendingReminders(
  origin: string,
  options: { includeFuture?: boolean; source?: string } = {}
): Promise<ReminderExecutionResult> {
  const source = options.source ?? 'manual:user';
  const whatsAppStatus = getWhatsAppEnvStatus();
  const isSimulatedMode =
    !whatsAppStatus.isConfigured && canSimulateWhatsAppInCurrentEnv();
  const executionMode: 'whatsapp_cloud' | 'simulated' = isSimulatedMode
    ? 'simulated'
    : 'whatsapp_cloud';

  console.info('[Reminders] Iniciando procesamiento manual por usuario', {
    source,
    origin,
    mode: executionMode,
    includeFuture: Boolean(options.includeFuture),
    hasAccessToken: whatsAppStatus.hasAccessToken,
    hasPhoneNumberId: whatsAppStatus.hasPhoneNumberId,
    isConfigured: whatsAppStatus.isConfigured,
  });

  const supabase = await createClient();
  if (!supabase) {
    return {
      status: 500,
      body: {
        ok: false,
        error: 'El servicio de base de datos no está disponible en este momento.',
      },
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      status: 401,
      body: {
        ok: false,
        error: 'No autorizado. Inicia sesión nuevamente para continuar.',
      },
    };
  }

  if (!user.email_confirmed_at) {
    return {
      status: 403,
      body: {
        ok: false,
        error:
          'Debes confirmar tu correo electrónico antes de enviar solicitudes por WhatsApp.',
      },
    };
  }

  const sendRateLimit = await checkPersistentSlidingWindowRateLimit(
    `manual-send:user:${user.id}`,
    {
      maxRequests: 6,
      windowMs: 60_000,
    }
  );
  if (!sendRateLimit.allowed) {
    return {
      status: 429,
      body: {
        ok: false,
        error:
          'Has realizado demasiados envíos seguidos. Espera unos segundos antes de volver a intentarlo.',
      },
    };
  }

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (bizError || !business) {
    return {
      status: 404,
      body: {
        ok: false,
        error: 'No se encontró el negocio asociado a tu cuenta.',
      },
    };
  }

  const typedBusiness = business as Business;
  const writeClient: AdminOrServerClient =
    createAdminClient() ?? (supabase as unknown as AdminOrServerClient);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleBeforeIso = new Date(nowMs - STALE_PROCESSING_MS).toISOString();

  // Validación previa de límites del Plan Trial (sin restricciones para subscription_status === 'active')
  let maxTrialSendsAllowed = BATCH_SIZE;
  if (typedBusiness.subscription_status !== 'active') {
    const [totalRes, dispatchedRes] = await Promise.all([
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', typedBusiness.id),
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', typedBusiness.id)
        .in('status', ['processing', 'sent', 'clicked', 'completed']),
    ]);

    if (totalRes.error || dispatchedRes.error) {
      return {
        status: 500,
        body: {
          ok: false,
          error: 'No se pudo verificar el límite de envíos de tu plan.',
        },
      };
    }

    const trialEval = evaluateTrialStatus(
      typedBusiness,
      {
        totalRequestsCount: totalRes.count ?? 0,
        dispatchedRequestsCount: dispatchedRes.count ?? 0,
      },
      nowMs
    );

    if (trialEval.isSendingBlocked) {
      console.warn('[Reminders] Envío manual bloqueado por límite/estado de Trial', {
        source,
        businessId: typedBusiness.id,
        blockReason: trialEval.blockReason,
        status: typedBusiness.subscription_status,
      });
      return {
        status: 403,
        body: {
          ok: false,
          error:
            trialEval.sendingErrorMessage ??
            'Tu plan actual no permite enviar mensajes por WhatsApp.',
        },
      };
    }

    maxTrialSendsAllowed = Math.max(
      0,
      TRIAL_MAX_REQUESTS - (dispatchedRes.count ?? 0)
    );
  }

  let rowsToSend: ClaimedUserRow[] = [];
  const failedItems: FailedReminderItem[] = [];

  // Reserva atómica vía RPC con FOR UPDATE sobre el negocio (evita TOCTOU con el cron)
  const { data: rpcUserClaimed, error: rpcUserErr } = await supabase.rpc(
    'claim_user_pending_review_requests',
    {
      p_business_id: typedBusiness.id,
      p_include_future: Boolean(options.includeFuture),
      p_limit: BATCH_SIZE,
      p_now: nowIso,
      p_stale_before: staleBeforeIso,
    }
  );

  if (!rpcUserErr) {
    rowsToSend = (rpcUserClaimed ?? []) as ClaimedUserRow[];
  } else if (!isMissingFunctionError(rpcUserErr)) {
    const rawMsg = rpcUserErr.message ?? '';
    const isDomainBlockMsg =
      rawMsg.includes('Plan Trial') ||
      rawMsg.includes('período de prueba') ||
      rawMsg.includes('suscripción') ||
      rawMsg.includes('correo electrónico');

    if (!isDomainBlockMsg) {
      console.error('[Reminders] Error en RPC claim_user_pending_review_requests:', {
        source,
        businessId: typedBusiness.id,
        code: rpcUserErr.code ?? null,
        error: rawMsg,
      });
    }

    return {
      status: isDomainBlockMsg ? 403 : 500,
      body: {
        ok: false,
        error: isDomainBlockMsg
          ? rawMsg
          : 'No se pudieron preparar tus solicitudes pendientes. Intenta nuevamente.',
      },
    };
  } else {
    // Fallback si la migración SQL Bloque 6 aún no fue ejecutada
    await rescueStuckProcessingFallback(
      writeClient,
      staleBeforeIso,
      nowIso,
      source,
      typedBusiness.id
    );

    let query = supabase
      .from('review_requests')
      .select('id, business_id, customer_name, customer_phone, scheduled_for, attempts')
      .eq('business_id', typedBusiness.id)
      .eq('status', 'pending')
      .lt('attempts', MAX_WHATSAPP_SEND_ATTEMPTS)
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_SIZE);

    if (!options.includeFuture) {
      query = query.lte('scheduled_for', nowIso);
    }

    const { data: pendingRows, error: pendingError } = await query;

    if (pendingError) {
      console.error('[Reminders] Error al consultar solicitudes pendientes del usuario', {
        source,
        businessId: typedBusiness.id,
        error: pendingError.message,
      });
      return {
        status: 500,
        body: {
          ok: false,
          error: 'No se pudieron consultar tus solicitudes pendientes.',
        },
      };
    }

    const allPendingRows = pendingRows ?? [];
    const candidateRows =
      typedBusiness.subscription_status === 'active'
        ? allPendingRows
        : allPendingRows.slice(0, maxTrialSendsAllowed);
    const blockedOverflowRows =
      typedBusiness.subscription_status === 'active'
        ? []
        : allPendingRows.slice(maxTrialSendsAllowed);

    for (const overflowRow of blockedOverflowRows) {
      failedItems.push({
        id: overflowRow.id,
        error: `Has alcanzado el límite de ${TRIAL_MAX_REQUESTS} envíos por WhatsApp del Plan Trial.`,
        status: 'pending',
      });
    }

    if (candidateRows.length > 0) {
      for (const row of candidateRows) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const { data: claimedRow, error: claimErr } = await supabase
          .from('review_requests')
          .update({
            status: 'processing',
            processing_started_at: nowIso,
            attempts: nextAttempts,
          })
          .eq('id', row.id)
          .eq('business_id', typedBusiness.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();

        if (claimErr) {
          console.error('[Reminders] Error al reservar fila manual:', {
            source,
            businessId: typedBusiness.id,
            requestId: row.id,
            error: claimErr.message,
          });
          failedItems.push({
            id: row.id,
            error:
              'No se pudo reservar la solicitud para envío. Intenta nuevamente.',
            status: 'pending',
          });
          break;
        }

        if (claimedRow) {
          rowsToSend.push({ ...row, attempts: nextAttempts });
        }
      }
    }
  }

  console.info('[Reminders] Solicitudes del usuario reclamadas para envío', {
    source,
    businessId: typedBusiness.id,
    claimed: rowsToSend.length,
    batchLimit: BATCH_SIZE,
    nowIso,
  });

  const processedItems: ProcessedReminderItem[] = [];

  if (rowsToSend.length > 0) {
    const safeBusinessName = sanitizeWhatsAppTemplateVariable(
      business.business_name ?? '',
      'Nuestro Negocio',
      MAX_TEMPLATE_NAME_LENGTH
    );

    await runInChunks(rowsToSend, CONCURRENCY_LIMIT, async (row) => {
      const safeCustomerName = sanitizeWhatsAppTemplateVariable(
        row.customer_name ?? '',
        'Cliente',
        MAX_TEMPLATE_NAME_LENGTH
      );
      const reviewLink = buildReviewLink(origin, row.id);
      const messagePreview = buildReminderMessage('', {
        customerName: safeCustomerName,
        businessName: safeBusinessName,
        reviewLink,
      });

      const delivery = await sendWhatsAppOrSimulate(row.customer_phone, {
        source,
        requestId: row.id,
        templateParams: {
          customerName: safeCustomerName,
          businessName: safeBusinessName,
          reviewLink,
        },
      });

      if (!delivery.ok) {
        const errMsg = delivery.error ?? 'Error al enviar mensaje.';
        const retryable = delivery.retryable !== false && !delivery.ambiguous;
        console.error('[Reminders] Falló el envío en lote manual', {
          source,
          requestId: row.id,
          retryable,
          ambiguous: Boolean(delivery.ambiguous),
          attempts: row.attempts ?? null,
          error: errMsg,
        });

        const resultingStatus = await markRequestAsFailedOrPending(
          writeClient,
          row.id,
          retryable,
          errMsg,
          source,
          {
            businessId: typedBusiness.id,
            attemptCount: row.attempts,
          }
        );

        failedItems.push({
          id: row.id,
          error: errMsg,
          ...(resultingStatus ? { status: resultingStatus } : {}),
        });
        return;
      }

      const persistResult = await markRequestAsSent(
        writeClient,
        row.id,
        delivery.externalId,
        source,
        typedBusiness.id
      );

      if (!persistResult.ok) {
        failedItems.push({
          id: row.id,
          error:
            'El mensaje se envió por WhatsApp, pero no se pudo actualizar el estado de la solicitud.',
        });
        return;
      }

      processedItems.push({
        id: row.id,
        customerName: safeCustomerName,
        customerPhone: row.customer_phone,
        reviewLink,
        messagePreview,
        deliveryMode: delivery.mode,
      });
    });
  }

  let pendingFutureCount = 0;
  if (!options.includeFuture) {
    const { count } = await supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id)
      .eq('status', 'pending')
      .gt('scheduled_for', nowIso);

    pendingFutureCount = count ?? 0;
  }

  console.info('[Reminders] Finalizó procesamiento manual por usuario', {
    source,
    businessId: typedBusiness.id,
    mode: executionMode,
    processed: processedItems.length,
    failed: failedItems.length,
    pendingFutureCount,
    errors: failedItems,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: executionMode,
      processed: processedItems.length,
      failed: failedItems.length,
      pendingFutureCount,
      items: processedItems,
      errors: failedItems,
      executedAt: nowIso,
    },
  };
}
