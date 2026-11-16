import { NextRequest, NextResponse } from 'next/server';
import {
  buildReminderMessage,
  buildReviewLink,
  isTwilioConfigured,
  sendSmsOrSimulate,
} from '@/lib/messaging/send-reminder';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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
  deliveryMode: 'twilio' | 'simulated';
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return false;
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const customHeader = request.headers.get('x-cron-secret')?.trim() ?? '';

  return bearerToken === cronSecret || customHeader === cronSecret;
}

async function processPendingReminders(
  request: NextRequest,
  options: { includeFuture?: boolean } = {}
) {
  const origin = new URL(request.url).origin;
  const nowIso = new Date().toISOString();
  const isCron = isAuthorizedCron(request);

  if (isCron) {
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        {
          error:
            'SUPABASE_SERVICE_ROLE_KEY es requerida para ejecuciones cron globales.',
        },
        { status: 500 }
      );
    }

    const { data: dueRequests, error: fetchError } = await adminClient
      .from('review_requests')
      .select(
        'id, business_id, customer_name, customer_phone, scheduled_for, businesses(business_name, message_template)'
      )
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(50);

    if (fetchError) {
      return NextResponse.json(
        { error: 'No se pudieron consultar las solicitudes pendientes.' },
        { status: 500 }
      );
    }

    const rows = (dueRequests ?? []) as PendingRequestWithBusiness[];
    const processedItems: ProcessedReminderItem[] = [];
    const failedItems: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      const biz = Array.isArray(row.businesses)
        ? row.businesses[0]
        : row.businesses;

      const reviewLink = buildReviewLink(origin, row.id);
      const messageBody = buildReminderMessage(biz?.message_template ?? '', {
        customerName: row.customer_name,
        businessName: biz?.business_name ?? 'Nuestro Negocio',
        reviewLink,
      });

      const delivery = await sendSmsOrSimulate(row.customer_phone, messageBody);
      if (!delivery.ok) {
        failedItems.push({
          id: row.id,
          error: delivery.error ?? 'Error al enviar mensaje.',
        });
        continue;
      }

      const { error: updateError } = await adminClient
        .from('review_requests')
        .update({ status: 'sent' })
        .eq('id', row.id)
        .eq('status', 'pending');

      if (updateError) {
        failedItems.push({
          id: row.id,
          error: 'No se pudo actualizar el estado en la base de datos.',
        });
        continue;
      }

      processedItems.push({
        id: row.id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        reviewLink,
        messagePreview: messageBody,
        deliveryMode: delivery.mode,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: isTwilioConfigured() ? 'twilio' : 'simulated',
      processed: processedItems.length,
      failed: failedItems.length,
      pendingFutureCount: 0,
      items: processedItems,
      errors: failedItems,
    });
  }

  // Ejecución manual desde el Dashboard del usuario autenticado (protegida por sesión + RLS)
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'La conexión con Supabase no está configurada.' },
      { status: 500 }
    );
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'No autorizado. Inicia sesión o proporciona un CRON_SECRET válido.' },
      { status: 401 }
    );
  }

  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('id, business_name, message_template')
    .eq('user_id', user.id)
    .single();

  if (bizError || !business) {
    return NextResponse.json(
      { error: 'No se encontró el negocio asociado a tu cuenta.' },
      { status: 404 }
    );
  }

  let query = supabase
    .from('review_requests')
    .select('id, business_id, customer_name, customer_phone, scheduled_for')
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (!options.includeFuture) {
    query = query.lte('scheduled_for', nowIso);
  }

  const { data: pendingRows, error: pendingError } = await query;

  if (pendingError) {
    return NextResponse.json(
      { error: 'No se pudieron consultar tus solicitudes pendientes.' },
      { status: 500 }
    );
  }

  const rows = pendingRows ?? [];
  const processedItems: ProcessedReminderItem[] = [];
  const failedItems: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const reviewLink = buildReviewLink(origin, row.id);
    const messageBody = buildReminderMessage(business.message_template ?? '', {
      customerName: row.customer_name,
      businessName: business.business_name,
      reviewLink,
    });

    const delivery = await sendSmsOrSimulate(row.customer_phone, messageBody);
    if (!delivery.ok) {
      failedItems.push({
        id: row.id,
        error: delivery.error ?? 'Error al enviar mensaje.',
      });
      continue;
    }

    const { error: updateError } = await supabase
      .from('review_requests')
      .update({ status: 'sent' })
      .eq('id', row.id)
      .eq('business_id', business.id)
      .eq('status', 'pending');

    if (updateError) {
      failedItems.push({
        id: row.id,
        error: 'No se pudo actualizar el estado de la solicitud.',
      });
      continue;
    }

    processedItems.push({
      id: row.id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      reviewLink,
      messagePreview: messageBody,
      deliveryMode: delivery.mode,
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

  return NextResponse.json({
    ok: true,
    mode: isTwilioConfigured() ? 'twilio' : 'simulated',
    processed: processedItems.length,
    failed: failedItems.length,
    pendingFutureCount,
    items: processedItems,
    errors: failedItems,
  });
}

export async function GET(request: NextRequest) {
  return processPendingReminders(request, { includeFuture: false });
}

export async function POST(request: NextRequest) {
  let includeFuture = false;
  try {
    const body = (await request.json()) as { includeFuture?: boolean };
    includeFuture = Boolean(body?.includeFuture);
  } catch {
    includeFuture = false;
  }

  return processPendingReminders(request, { includeFuture });
}
