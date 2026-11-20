import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  processGlobalPendingReminders,
  processUserPendingReminders,
} from '@/lib/messaging/process-pending-reminders';
import { getPublicOrigin } from '@/lib/supabase/cookie-options';

export const dynamic = 'force-dynamic';

function safeCompareSecret(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

function isValidCronRequest(request: NextRequest, cronSecret: string): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const bearerToken = authHeader.slice(7).trim();
  if (!bearerToken) {
    return false;
  }

  return safeCompareSecret(bearerToken, cronSecret);
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request);
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV);

  if (!cronSecret) {
    if (isProduction) {
      console.error(
        '[Cron /api/cron/enviar-pendientes] Error crítico: CRON_SECRET no está configurado en producción.'
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            'Configuración incompleta: CRON_SECRET es obligatorio en producción.',
        },
        { status: 500 }
      );
    }

    // En desarrollo local sin CRON_SECRET, jamás ejecutar el envío global:
    // únicamente permitir el procesamiento acotado al usuario autenticado si existe sesión.
    const userResult = await processUserPendingReminders(origin, {
      includeFuture: false,
      source: 'GET:/api/cron/enviar-pendientes(dev-session-only)',
    });

    if (userResult.status === 401) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No autorizado. Define CRON_SECRET o inicia sesión para pruebas locales.',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(userResult.body, { status: userResult.status });
  }

  if (!isValidCronRequest(request, cronSecret)) {
    console.warn(
      '[Cron /api/cron/enviar-pendientes] Solicitud rechazada: header Authorization Bearer ausente o inválido.'
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          'No autorizado. Proporciona un header Authorization Bearer válido.',
      },
      { status: 401 }
    );
  }

  console.info('[Cron /api/cron/enviar-pendientes] Ejecución iniciada', {
    origin,
    hasCronSecret: true,
    isProduction,
  });

  const globalResult = await processGlobalPendingReminders(
    origin,
    'GET:/api/cron/enviar-pendientes'
  );

  return NextResponse.json(globalResult.body, { status: globalResult.status });
}
