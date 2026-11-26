import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import {
  checkSlidingWindowRateLimit,
  getRequestClientIp,
} from '@/lib/security/rate-limit';
import {
  ALLOWED_EMAIL_PROVIDER_ERROR,
  analyzeEmailForTrialAbuse,
} from '@/lib/subscription/trial';
import { getSupabaseEnv } from '@/lib/supabase/config';
import {
  adaptCookieOptions,
  isHttpsRequest,
  isValidSameOriginPost,
} from '@/lib/supabase/cookie-options';

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Content-Type debe ser application/json.' },
      { status: 415 }
    );
  }

  if (!isValidSameOriginPost(request)) {
    return NextResponse.json(
      { error: 'Origen no autorizado.' },
      { status: 403 }
    );
  }

  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    return NextResponse.json(
      {
        error: 'El servicio de autenticación no está disponible en este momento.',
      },
      { status: 500 }
    );
  }

  const clientIp = getRequestClientIp(request.headers);
  const ipRateLimit = checkSlidingWindowRateLimit(`login:ip:${clientIp}`, {
    maxRequests: 12,
    windowMs: 10 * 60_000,
  });
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          'Demasiados intentos de inicio de sesión. Espera unos minutos e inténtalo de nuevo.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(ipRateLimit.retryAfterSeconds) },
      }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json(
      { error: 'Solicitud inválida.' },
      { status: 400 }
    );
  }

  const rawEmail = body.email?.trim() ?? '';
  const password = body.password ?? '';

  if (!rawEmail || !password) {
    return NextResponse.json(
      { error: 'Ingresa tu correo y contraseña.' },
      { status: 400 }
    );
  }

  const emailAnalysis = analyzeEmailForTrialAbuse(rawEmail);
  if (!emailAnalysis) {
    return NextResponse.json(
      { error: 'Ingresa un correo electrónico válido.' },
      { status: 400 }
    );
  }

  if (!emailAnalysis.isAllowedProvider) {
    return NextResponse.json(
      { error: ALLOWED_EMAIL_PROVIDER_ERROR },
      { status: 400 }
    );
  }

  const isHttps = isHttpsRequest(request.headers, request.url);
  const cookiesToApply: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach((cookie) => cookiesToApply.push(cookie));
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailAnalysis.normalizedEmail,
    password,
  });

  if (error || !data.session) {
    const rawMsg = (error?.message ?? '').toLowerCase();
    let friendlyError = 'No se pudo iniciar sesión. Verifica tus datos e inténtalo nuevamente.';
    if (rawMsg.includes('invalid login credentials')) {
      friendlyError = 'Correo electrónico o contraseña incorrectos.';
    } else if (rawMsg.includes('email not confirmed')) {
      friendlyError =
        'Tu cuenta aún no está confirmada. Revisa tu bandeja de entrada para verificar tu correo.';
    } else if (rawMsg.includes('rate limit') || rawMsg.includes('too many requests')) {
      friendlyError =
        'Demasiados intentos en poco tiempo. Espera un momento e inténtalo de nuevo.';
    }
    return NextResponse.json({ error: friendlyError }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, adaptCookieOptions(options, isHttps));
  });

  return response;
}
