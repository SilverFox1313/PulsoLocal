import { NextRequest, NextResponse } from 'next/server';
import {
  processGlobalPendingReminders,
  processUserPendingReminders,
} from '@/lib/messaging/process-pending-reminders';

export const dynamic = 'force-dynamic';

function isValidCronRequest(request: NextRequest, cronSecret: string): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const customHeader = request.headers.get('x-cron-secret')?.trim() ?? '';

  return bearerToken === cronSecret || customHeader === cronSecret;
}

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret) {
    if (!isValidCronRequest(request, cronSecret)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No autorizado. Proporciona un header Authorization Bearer válido.',
        },
        { status: 401 }
      );
    }
  } else {
    console.warn(
      '[Cron /api/cron/enviar-pendientes] Advertencia: CRON_SECRET no está definido. Ejecutando sin validación Bearer para facilitar pruebas locales.'
    );
  }

  console.info('[Cron /api/cron/enviar-pendientes] Ejecución iniciada', {
    origin,
    hasCronSecret: Boolean(cronSecret),
  });

  const globalResult = await processGlobalPendingReminders(
    origin,
    'GET:/api/cron/enviar-pendientes'
  );

  // En desarrollo local sin SUPABASE_SERVICE_ROLE_KEY ni CRON_SECRET,
  // permite usar la sesión autenticada del navegador si existe.
  if (globalResult.missingServiceRoleKey && !cronSecret) {
    const userResult = await processUserPendingReminders(origin, {
      includeFuture: false,
      source: 'GET:/api/cron/enviar-pendientes(fallback-user)',
    });
    if (userResult.status !== 401) {
      return NextResponse.json(userResult.body, { status: userResult.status });
    }
  }

  return NextResponse.json(globalResult.body, { status: globalResult.status });
}
