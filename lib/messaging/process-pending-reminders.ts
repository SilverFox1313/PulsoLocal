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

export interface ReminderExecutionResult {
  status: number;
  missingServiceRoleKey?: boolean;
  body: ReminderExecutionSuccess | { ok: false; error: string };
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

  // Rescatar solicitudes atascadas en 'processing' por más de 5 minutos (p. ej., timeout o caída del proceso)
  const { data: rescuedRows, error: rescueError } = await adminClient
    .from('review_requests')
    .update({ status: 'pending', processing_started_at: null })
    .eq('status', 'processing')
    .or(
      `processing_started_at.lte.${staleBeforeIso},processing_started_at.is.null`
    )
    .select('id');

  if (rescueError) {
    console.error('[Reminders] Error al rescatar solicitudes atascadas en processing', {
      source,
      error: rescueError.message,
    });
  } else if (rescuedRows && rescuedRows.length > 0) {
    console.warn('[Reminders] Solicitudes atascadas en processing rescatadas a pending', {
      source,
      rescuedCount: rescuedRows.length,
      staleBeforeIso,
    });
  }

  const { data: dueRequests, error: fetchError } = await adminClient
    .from('review_requests')
    .select(
      'id, business_id, customer_name, customer_phone, scheduled_for, businesses(business_name, message_template, subscription_status, created_at)'
    )
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
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
  console.info('[Reminders] Solicitudes pendientes vencidas encontradas', {
    source,
    count: rawCandidateRows.length,
    poolLimit: GLOBAL_CANDIDATE_POOL,
    batchLimit: BATCH_SIZE,
    nowIso,
  });

  if (rawCandidateRows.length === 0) {
    return {
      status: 200,
      body: {
        ok: true,
        mode: executionMode,
        processed: 0,
        failed: 0,
        pendingFutureCount: 0,
        items: [],
        errors: [],
        executedAt: nowIso,
      },
    };
  }

  // Verificar elegibilidad de plan/Trial por negocio sin permitir que cuentas bloqueadas detengan cuentas 'active'
  const businessAllowance = new Map<
    string,
    { remainingSends: number; blockError: string | null }
  >();
  const candidateRows: PendingRequestWithBusiness[] = [];
  const blockedErrors: Array<{ id: string; error: string }> = [];

  for (const row of rawCandidateRows) {
    if (candidateRows.length >= BATCH_SIZE) {
      break;
    }

    const biz = Array.isArray(row.businesses)
      ? row.businesses[0]
      : row.businesses;

    if (!biz) {
      blockedErrors.push({
        id: row.id,
        error: 'Negocio asociado no encontrado.',
      });
      continue;
    }

    if (biz.subscription_status === 'active') {
      candidateRows.push(row);
      continue;
    }

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
        const { count: dispatchedCount, error: countErr } = await adminClient
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
    candidateRows.push(row);
  }

  if (candidateRows.length === 0) {
    console.warn('[Reminders] Lote global omitido por restricciones de Trial/plan', {
      source,
      blockedCount: blockedErrors.length,
    });
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

  // Reserva atómica antes de llamar a Meta para evitar envíos duplicados entre cron y clic manual
  const candidateIds = candidateRows.map((r) => r.id);
  const { data: claimedRows, error: claimError } = await adminClient
    .from('review_requests')
    .update({ status: 'processing', processing_started_at: nowIso })
    .in('id', candidateIds)
    .eq('status', 'pending')
    .select('id');

  if (claimError) {
    console.error('[Reminders] Error al reservar lote en estado processing', {
      source,
      code: claimError.code ?? null,
      error: claimError.message,
    });
    return {
      status: 500,
      body: {
        ok: false,
        error: 'No se pudo reservar el lote de solicitudes pendientes.',
      },
    };
  }

  const claimedIds = new Set((claimedRows ?? []).map((r) => r.id));
  const rowsToSend = candidateRows.filter((row) => claimedIds.has(row.id));

  console.info('[Reminders] Lote reservado atómicamente para envío global', {
    source,
    candidates: candidateRows.length,
    claimed: rowsToSend.length,
  });

  const processedItems: ProcessedReminderItem[] = [];
  const failedItems: Array<{ id: string; error: string }> = [];

  await runInChunks(rowsToSend, CONCURRENCY_LIMIT, async (row) => {
    const biz = Array.isArray(row.businesses)
      ? row.businesses[0]
      : row.businesses;

    const businessName = biz?.business_name ?? 'Nuestro Negocio';
    const reviewLink = buildReviewLink(origin, row.id);
    const messageBody = buildReminderMessage(biz?.message_template ?? '', {
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
      console.error('[Reminders] Falló el envío en lote global; liberando reserva a pending', {
        source,
        requestId: row.id,
        retryable: delivery.retryable ?? true,
        error: errMsg,
      });

      const { error: revertError } = await adminClient
        .from('review_requests')
        .update({ status: 'pending', processing_started_at: null })
        .eq('id', row.id)
        .eq('status', 'processing');

      if (revertError) {
        console.error('[Reminders] No se pudo revertir estado processing a pending', {
          source,
          requestId: row.id,
          error: revertError.message,
        });
      }

      failedItems.push({
        id: row.id,
        error: errMsg,
      });
      return;
    }

    const { error: updateError } = await adminClient
      .from('review_requests')
      .update({ status: 'sent', processing_started_at: null })
      .eq('id', row.id)
      .eq('status', 'processing');

    if (updateError) {
      console.error('[Reminders] Error al actualizar estado a sent en Supabase', {
        source,
        requestId: row.id,
        error: updateError.message,
      });
      failedItems.push({
        id: row.id,
        error: 'El mensaje se envió, pero no se pudo actualizar el estado en la base de datos.',
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
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleBeforeIso = new Date(nowMs - STALE_PROCESSING_MS).toISOString();

  // Validación estricta de límites del Plan Trial (sin restricciones para subscription_status === 'active')
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

  // Rescatar solicitudes del negocio atascadas en 'processing' por más de 5 minutos
  const { data: rescuedUserRows, error: rescueUserError } = await supabase
    .from('review_requests')
    .update({ status: 'pending', processing_started_at: null })
    .eq('business_id', typedBusiness.id)
    .eq('status', 'processing')
    .or(
      `processing_started_at.lte.${staleBeforeIso},processing_started_at.is.null`
    )
    .select('id');

  if (rescueUserError) {
    console.error('[Reminders] Error al rescatar solicitudes manuales atascadas en processing', {
      source,
      businessId: typedBusiness.id,
      error: rescueUserError.message,
    });
  } else if (rescuedUserRows && rescuedUserRows.length > 0) {
    console.warn('[Reminders] Solicitudes manuales atascadas en processing rescatadas a pending', {
      source,
      businessId: typedBusiness.id,
      rescuedCount: rescuedUserRows.length,
      staleBeforeIso,
    });
  }

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

  console.info('[Reminders] Solicitudes pendientes del usuario encontradas', {
    source,
    businessId: typedBusiness.id,
    count: candidateRows.length,
    blockedByTrialCap: blockedOverflowRows.length,
    batchLimit: BATCH_SIZE,
    nowIso,
  });

  const processedItems: ProcessedReminderItem[] = [];
  const failedItems: Array<{ id: string; error: string }> = blockedOverflowRows.map(
    (row) => ({
      id: row.id,
      error: `Has alcanzado el límite de ${TRIAL_MAX_REQUESTS} envíos por WhatsApp del Plan Trial.`,
    })
  );

  if (candidateRows.length > 0) {
    // Reserva atómica antes de llamar a Meta
    const candidateIds = candidateRows.map((r) => r.id);
    const { data: claimedRows, error: claimError } = await supabase
      .from('review_requests')
      .update({ status: 'processing', processing_started_at: nowIso })
      .in('id', candidateIds)
      .eq('business_id', business.id)
      .eq('status', 'pending')
      .select('id');

    if (claimError) {
      console.error('[Reminders] Error al reservar lote manual en processing', {
        source,
        businessId: business.id,
        code: claimError.code ?? null,
        error: claimError.message,
      });
      return {
        status: 500,
        body: {
          ok: false,
          error: 'No se pudo reservar el lote de solicitudes pendientes.',
        },
      };
    }

    const claimedIds = new Set((claimedRows ?? []).map((r) => r.id));
    const rowsToSend = candidateRows.filter((row) => claimedIds.has(row.id));

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
        console.error('[Reminders] Falló el envío en lote manual; liberando reserva a pending', {
          source,
          requestId: row.id,
          retryable: delivery.retryable ?? true,
          error: errMsg,
        });

        const { error: revertError } = await supabase
          .from('review_requests')
          .update({ status: 'pending', processing_started_at: null })
          .eq('id', row.id)
          .eq('business_id', business.id)
          .eq('status', 'processing');

        if (revertError) {
          console.error('[Reminders] No se pudo revertir estado processing a pending', {
            source,
            requestId: row.id,
            error: revertError.message,
          });
        }

        failedItems.push({
          id: row.id,
          error: errMsg,
        });
        return;
      }

      const { error: updateError } = await supabase
        .from('review_requests')
        .update({ status: 'sent', processing_started_at: null })
        .eq('id', row.id)
        .eq('business_id', business.id)
        .eq('status', 'processing');

      if (updateError) {
        console.error('[Reminders] Error al actualizar estado a sent en Supabase', {
          source,
          requestId: row.id,
          error: updateError.message,
        });
        failedItems.push({
          id: row.id,
          error: 'No se pudo actualizar el estado de la solicitud.',
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
      .eq('business_id', business.id)
      .eq('status', 'pending')
      .gt('scheduled_for', nowIso);

    pendingFutureCount = count ?? 0;
  }

  console.info('[Reminders] Finalizó procesamiento manual por usuario', {
    source,
    businessId: business.id,
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
