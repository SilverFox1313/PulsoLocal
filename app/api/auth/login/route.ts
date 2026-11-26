import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { mapSupabaseAuthError } from '@/lib/auth/error-messages';
import {
  checkPersistentSlidingWindowRateLimit,
  formatRateLimitWaitEs,
  getRequestClientIp,
  resetPersistentRateLimit,
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
  const ipRateLimit = await checkPersistentSlidingWindowRateLimit(
    `login:ip:${clientIp}`,
    {
      maxRequests: 15,
      windowMs: 2 * 60_000,
    }
  );
  if (!ipRateLimit.allowed) {
    const waitText = formatRateLimitWaitEs(ipRateLimit.retryAfterSeconds);
    return NextResponse.json(
      {
        error: `Hicimos una breve pausa por varios intentos seguidos. Espera ${waitText} e inténtalo de nuevo.`,
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

  const emailRateLimitKey = `login:email:${emailAnalysis.canonicalEmail}`;
  const emailRateLimit = await checkPersistentSlidingWindowRateLimit(
    emailRateLimitKey,
    {
      maxRequests: 8,
      windowMs: 2 * 60_000,
    }
  );
  if (!emailRateLimit.allowed) {
    const waitText = formatRateLimitWaitEs(emailRateLimit.retryAfterSeconds);
    return NextResponse.json(
      {
        error: `Hicimos una breve pausa tras varios intentos con este correo. Espera ${waitText} e inténtalo de nuevo.`,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(emailRateLimit.retryAfterSeconds) },
      }
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

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailAnalysis.normalizedEmail,
      password,
    });

    if (error || !data.session) {
      const friendlyError = mapSupabaseAuthError(
        error?.message,
        'No se pudo iniciar sesión. Verifica tus datos e inténtalo nuevamente.'
      );
      return NextResponse.json({ error: friendlyError }, { status: 401 });
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : '';
    return NextResponse.json(
      {
        error: mapSupabaseAuthError(
          rawMsg,
          'No se pudo iniciar sesión en este momento. Inténtalo nuevamente.'
        ),
      },
      { status: 500 }
    );
  }

  await resetPersistentRateLimit(emailRateLimitKey);

  const response = NextResponse.json({ ok: true });
  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, adaptCookieOptions(options, isHttps));
  });

  return response;
}
