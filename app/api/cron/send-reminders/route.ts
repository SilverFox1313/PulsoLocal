import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  processGlobalPendingReminders,
  processUserPendingReminders,
  type ProcessedReminderItem,
} from '@/lib/messaging/process-pending-reminders';
import {
  getPublicOrigin,
  isValidSameOriginPost,
} from '@/lib/supabase/cookie-options';
import {
  checkSlidingWindowRateLimit,
  getRequestClientIp,
} from '@/lib/security/rate-limit';

export type { ProcessedReminderItem };

export const dynamic = 'force-dynamic';

function safeCompareSecret(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

function hasCronCredentialAttempt(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')?.trim() ?? '';
  const customHeader = request.headers.get('x-cron-secret')?.trim() ?? '';
  return authHeader.length > 0 || customHeader.length > 0;
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

  return (
    (Boolean(bearerToken) && safeCompareSecret(bearerToken, cronSecret)) ||
    (Boolean(customHeader) && safeCompareSecret(customHeader, cronSecret))
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No autorizado. Proporciona un CRON_SECRET válido.',
      },
      { status: 401 }
    );
  }

  const origin = getPublicOrigin(request);
  const result = await processGlobalPendingReminders(
    origin,
    'GET:/api/cron/send-reminders(cron)'
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  const origin = getPublicOrigin(request);

  if (hasCronCredentialAttempt(request)) {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No autorizado. Credenciales de cron inválidas.',
        },
        { status: 401 }
      );
    }

    const result = await processGlobalPendingReminders(
      origin,
      'POST:/api/cron/send-reminders(cron)'
    );
    return NextResponse.json(result.body, { status: result.status });
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Content-Type debe ser application/json.',
      },
      { status: 415 }
    );
  }

  if (!isValidSameOriginPost(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Origen de solicitud no permitido.',
      },
      { status: 403 }
    );
  }

  const clientIp = getRequestClientIp(request.headers);
  const ipRateLimit = checkSlidingWindowRateLimit(
    `manual-send:ip:${clientIp}`,
    {
      maxRequests: 15,
      windowMs: 60_000,
    }
  );
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Demasiadas solicitudes de envío en poco tiempo. Espera unos segundos e inténtalo nuevamente.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(ipRateLimit.retryAfterSeconds) },
      }
    );
  }

  let includeFuture = false;
  try {
    const body = (await request.json()) as { includeFuture?: boolean };
    includeFuture = Boolean(body?.includeFuture);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'Cuerpo JSON inválido.',
      },
      { status: 400 }
    );
  }

  // Ejecución manual desde el Dashboard del usuario autenticado (protegida por sesión + RLS + Origin)
  const result = await processUserPendingReminders(origin, {
    includeFuture,
    source: 'POST:/api/cron/send-reminders(manual)',
  });
  return NextResponse.json(result.body, { status: result.status });
}
