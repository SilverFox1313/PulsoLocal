import {
  buildReminderMessage,
  buildReviewLink,
  canSimulateWhatsAppInCurrentEnv,
  getWhatsAppEnvStatus,
  sendWhatsAppOrSimulate,
} from '@/lib/messaging/send-reminder';
import {
  evaluateTrialStatus,
  isTrialExpiredByDate,
  TRIAL_MAX_REQUESTS,
} from '@/lib/subscription/trial';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Business, SubscriptionStatus } from '@/types/database';

const BATCH_SIZE = 10;
const GLOBAL_CANDIDATE_POOL = BATCH_SIZE * 5;
const CONCURRENCY_LIMIT = 4;
const STALE_PROCESSING_MS = 5 * 60_000;
const UPDATE_RETRY_DELAYS_MS = [150, 400];

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
  business_name: string;
  message_template: string;
  subscription_status: SubscriptionStatus;
  business_created_at: string;
}

interface ClaimedUserRow {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_for: string;
}

interface PendingRequestWithBusiness {
  id: string;
  business_id: string;
  customer_name: string;
  customer_phone: string;
  scheduled_for: string;
  businesses:
    | {
        business_name: string;
        message_template: string;
        subscription_status: SubscriptionStatus;
        created_at: string;
      }
    | Array<{
        business_name: string;
        message_template: string;
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

export interface ReminderExecutionSuccess {
  ok: true;
  mode: 'whatsapp_cloud' | 'simulated';
  processed: number;
  failed: number;
  pendingFutureCount: number;
  items: ProcessedReminderItem[];
  errors: Array<{ id: string; error: string }>;
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
  errors?: Array<{ id: string; error: string }>;
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

  // 2. Rescatar únicamente filas atascadas sin confirmación de envío
  let rescueQuery = client
    .from('review_requests')
    .update({ status: 'pending', processing_started_at: null })
    .eq('status', 'processing')
    .is('whatsapp_message_id', null)
    .is('sent_at', null)
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

  let useMinimal = false;
  let lastErrorMessage = 'No se pudo actualizar el estado a sent.';

  for (let attempt = 0; attempt <= UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(UPDATE_RETRY_DELAYS_MS[attempt - 1]);
    }

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

  // Último respaldo: guardar al menos la marca de confirmación externa para evitar reenvío en rescates
  if (!useMinimal && (externalId || sentAtIso)) {
    let markerQuery = client
      .from('review_requests')
      .update({
        whatsapp_message_id: externalId ?? null,
        sent_at: sentAtIso,
      })
      .eq('id', requestId)
      .eq('status', 'processing');

    if (businessId) {
      markerQuery = markerQuery.eq('business_id', businessId);
    }
    await markerQuery;
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
  businessId?: string
): Promise<void> {
  const targetStatus = retryable ? 'pending' : 'failed';
  const truncatedError = errMsg.slice(0, 500);

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
    return;
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
      return;
    }

    if (!retryable && isCheckConstraintError(fallbackErr)) {
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
      await legacyRevert;
      return;
    }

    console.error('[Reminders] Error al actualizar estado tras fallo de envío', {
      source,
      requestId,
      targetStatus,
      error: fallbackErr.message,
    });
    return;
  }

  if (!retryable && isCheckConstraintError(error)) {
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
    await legacyRevert;
    return;
  }

  console.error('[Reminders] Error al actualizar estado tras fallo de envío', {
    source,
    requestId,
    targetStatus,
    error: error.message,
  });
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
  const blockedErrors: Array<{ id: string; error: string }> = [];

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
        'id, business_id, customer_name, customer_phone, scheduled_for, businesses!inner(business_name, message_template, subscription_status, created_at)'
      )
      .eq('status', 'pending')
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
          });
          continue;
        }

        allowance.remainingSends -= 1;
      }

      // Reserva por fila para que un bloqueo en un negocio no aborte a los demás
      const { data: claimedRow, error: claimErr } = await adminClient
        .from('review_requests')
        .update({ status: 'processing', processing_started_at: nowIso })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (claimErr) {
        blockedErrors.push({ id: row.id, error: claimErr.message });
        continue;
      }

      if (claimedRow) {
        rowsToSend.push({
          id: row.id,
          business_id: row.business_id,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          scheduled_for: row.scheduled_for,
          business_name: biz.business_name,
          message_template: biz.message_template,
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
  const failedItems: Array<{ id: string; error: string }> = [];

  await runInChunks(rowsToSend, CONCURRENCY_LIMIT, async (row) => {
    const businessName = row.business_name || 'Nuestro Negocio';
    const reviewLink = buildReviewLink(origin, row.id);
    const messageBody = buildReminderMessage(row.message_template ?? '', {
      customerName: row.customer_name,
      businessName,
      reviewLink,
    });

    const delivery = await sendWhatsAppOrSimulate(
      row.customer_phone,
      messageBody,
      {
        source,
        requestId: row.id,
        templateParams: {
          customerName: row.customer_name,
          businessName,
          reviewLink,
        },
      }
    );

    if (!delivery.ok) {
      const errMsg = delivery.error ?? 'Error al enviar mensaje.';
      const retryable = delivery.retryable !== false;
      console.error('[Reminders] Falló el envío en lote global', {
        source,
        requestId: row.id,
        retryable,
        error: errMsg,
      });

      await markRequestAsFailedOrPending(
        adminClient,
        row.id,
        retryable,
        errMsg,
        source
      );

      failedItems.push({
        id: row.id,
        error: errMsg,
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
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      reviewLink,
      messagePreview: messageBody,
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

  if (processedItems.length === 0 && failedItems.length > 0) {
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
  const failedItems: Array<{ id: string; error: string }> = [];

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
    const isTrialBlockMsg =
      rpcUserErr.message.includes('Plan Trial') ||
      rpcUserErr.message.includes('período de prueba') ||
      rpcUserErr.message.includes('suscripción');

    return {
      status: isTrialBlockMsg ? 403 : 500,
      body: {
        ok: false,
        error:
          rpcUserErr.message ||
          'No se pudieron reservar tus solicitudes pendientes.',
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
      .select('id, business_id, customer_name, customer_phone, scheduled_for')
      .eq('business_id', typedBusiness.id)
      .eq('status', 'pending')
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
      });
    }

    if (candidateRows.length > 0) {
      for (const row of candidateRows) {
        const { data: claimedRow, error: claimErr } = await supabase
          .from('review_requests')
          .update({ status: 'processing', processing_started_at: nowIso })
          .eq('id', row.id)
          .eq('business_id', typedBusiness.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();

        if (claimErr) {
          failedItems.push({ id: row.id, error: claimErr.message });
          break;
        }

        if (claimedRow) {
          rowsToSend.push(row);
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
    await runInChunks(rowsToSend, CONCURRENCY_LIMIT, async (row) => {
      const reviewLink = buildReviewLink(origin, row.id);
      const messageBody = buildReminderMessage(
        business.message_template ?? '',
        {
          customerName: row.customer_name,
          businessName: business.business_name,
          reviewLink,
        }
      );

      const delivery = await sendWhatsAppOrSimulate(
        row.customer_phone,
        messageBody,
        {
          source,
          requestId: row.id,
          templateParams: {
            customerName: row.customer_name,
            businessName: business.business_name,
            reviewLink,
          },
        }
      );

      if (!delivery.ok) {
        const errMsg = delivery.error ?? 'Error al enviar mensaje.';
        const retryable = delivery.retryable !== false;
        console.error('[Reminders] Falló el envío en lote manual', {
          source,
          requestId: row.id,
          retryable,
          error: errMsg,
        });

        await markRequestAsFailedOrPending(
          writeClient,
          row.id,
          retryable,
          errMsg,
          source,
          typedBusiness.id
        );

        failedItems.push({
          id: row.id,
          error: errMsg,
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
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        reviewLink,
        messagePreview: messageBody,
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
