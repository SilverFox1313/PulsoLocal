import { NextRequest, NextResponse } from 'next/server';
import {
  processGlobalPendingReminders,
  processUserPendingReminders,
  type ProcessedReminderItem,
} from '@/lib/messaging/process-pending-reminders';

export type { ProcessedReminderItem };

export const dynamic = 'force-dynamic';

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

async function handleSendReminders(
  request: NextRequest,
  options: { includeFuture?: boolean } = {}
) {
  const origin = new URL(request.url).origin;

  if (isAuthorizedCron(request)) {
    const result = await processGlobalPendingReminders(origin);
    return NextResponse.json(result.body, { status: result.status });
  }

  // Ejecución manual desde el Dashboard del usuario autenticado (protegida por sesión + RLS)
  const result = await processUserPendingReminders(origin, options);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: NextRequest) {
  return handleSendReminders(request, { includeFuture: false });
}

export async function POST(request: NextRequest) {
  let includeFuture = false;
  try {
    const body = (await request.json()) as { includeFuture?: boolean };
    includeFuture = Boolean(body?.includeFuture);
  } catch {
    includeFuture = false;
  }

  return handleSendReminders(request, { includeFuture });
}
