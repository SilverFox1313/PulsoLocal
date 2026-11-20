import {
  buildReminderMessage,
  buildReviewLink,
  canSimulateWhatsAppInCurrentEnv,
  getWhatsAppEnvStatus,
  sendWhatsAppOrSimulate,
} from '@/lib/messaging/send-reminder';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const BATCH_SIZE = 10;
const CONCURRENCY_LIMIT = 4;

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
      }
    | Array<{
        business_name: string;
        message_template: string;
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
          'SUPABASE_SERVICE_ROLE_KEY es requerida para ejecuciones cron globales.',
      },
    };
  }

  const nowIso = new Date().toISOString();

  const { data: dueRequests, error: fetchError } = await adminClient
    .from('review_requests')
    .select(
      'id, business_id, customer_name, customer_phone, scheduled_for, businesses(business_name, message_template)'
    )
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE);

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

  const candidateRows = (dueRequests ?? []) as PendingRequestWithBusiness[];
  console.info('[Reminders] Solicitudes pendientes vencidas encontradas', {
    source,
    count: candidateRows.length,
    batchLimit: BATCH_SIZE,
    nowIso,
  });

  if (candidateRows.length === 0) {
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

  // Reserva atómica antes de llamar a Meta para evitar envíos duplicados entre cron y clic manual
  const candidateIds = candidateRows.map((r) => r.id);
  const { data: claimedRows, error: claimError } = await adminClient
    .from('review_requests')
    .update({ status: 'processing' })
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
        error:
          claimError.code === '23514'
            ? 'Falta actualizar la restricción de estado en Supabase (ejecuta supabase/migration_production_block2.sql).'
            : 'No se pudo reservar el lote de solicitudes pendientes.',
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
        .update({ status: 'pending' })
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
      .update({ status: 'sent' })
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

  console.info('[Reminders] Finalizó procesamiento global de pendientes', {
    source,
    mode: executionMode,
    processed: processedItems.length,
    failed: failedItems.length,
    errors: failedItems,
  });

  return {
    status: 200,
    body: {
      ok: true,
      mode: executionMode,
      processed: processedItems.length,
      failed: failedItems.length,
      pendingFutureCount: 0,
      items: processedItems,
      errors: failedItems,
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
        error: 'La conexión con Supabase no está configurada.',
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
        error:
          'No autorizado. Inicia sesión o proporciona un CRON_SECRET válido.',
      },
    };
  }

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('id, business_name, message_template')
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

  const nowIso = new Date().toISOString();

  let query = supabase
    .from('review_requests')
    .select('id, business_id, customer_name, customer_phone, scheduled_for')
    .eq('business_id', business.id)
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
      businessId: business.id,
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

  const candidateRows = pendingRows ?? [];
  console.info('[Reminders] Solicitudes pendientes del usuario encontradas', {
    source,
    businessId: business.id,
    count: candidateRows.length,
    batchLimit: BATCH_SIZE,
    nowIso,
  });

  const processedItems: ProcessedReminderItem[] = [];
  const failedItems: Array<{ id: string; error: string }> = [];

  if (candidateRows.length > 0) {
    // Reserva atómica antes de llamar a Meta
    const candidateIds = candidateRows.map((r) => r.id);
    const { data: claimedRows, error: claimError } = await supabase
      .from('review_requests')
      .update({ status: 'processing' })
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
          error:
            claimError.code === '23514'
              ? 'Falta actualizar la restricción de estado en Supabase (ejecuta supabase/migration_production_block2.sql).'
              : 'No se pudo reservar el lote de solicitudes pendientes.',
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
          .update({ status: 'pending' })
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
        .update({ status: 'sent' })
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
