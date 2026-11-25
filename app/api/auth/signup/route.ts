import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { analyzeEmailForTrialAbuse } from '@/lib/subscription/trial';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSupabaseEnv } from '@/lib/supabase/config';
import {
  adaptCookieOptions,
  getPublicOrigin,
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

  let body: { businessName?: string; email?: string; password?: string };
  try {
    body = (await request.json()) as {
      businessName?: string;
      email?: string;
      password?: string;
    };
  } catch {
    return NextResponse.json(
      { error: 'Solicitud inválida.' },
      { status: 400 }
    );
  }

  const businessName = body.businessName?.trim() ?? '';
  const rawEmail = body.email?.trim() ?? '';
  const password = body.password ?? '';

  if (businessName.length < 2 || businessName.length > 120) {
    return NextResponse.json(
      {
        error:
          'El nombre del negocio debe tener entre 2 y 120 caracteres.',
      },
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

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  let duplicateCanonicalEmail = false;

  if (adminClient && !emailAnalysis.hasSubaddressing) {
    const { data: claimData, error: claimError } = await adminClient
      .from('trial_claims')
      .select('id')
      .eq('claim_type', 'canonical_email')
      .eq('claim_value', emailAnalysis.canonicalEmail)
      .limit(1);

    if (!claimError && claimData && claimData.length > 0) {
      duplicateCanonicalEmail = true;
    } else if (claimError) {
      const { data: bizMatch } = await adminClient
        .from('businesses')
        .select('id')
        .eq('canonical_email', emailAnalysis.canonicalEmail)
        .limit(1);

      if (bizMatch && bizMatch.length > 0) {
        duplicateCanonicalEmail = true;
      }
    }
  }

  const trialRestrictedReason = emailAnalysis.hasSubaddressing
    ? 'El correo electrónico usa un alias con "+" y no califica para el Trial gratuito automático. Selecciona un plan para comenzar.'
    : duplicateCanonicalEmail
      ? 'Este correo ya utilizó una prueba gratuita anteriormente. Selecciona un plan de pago para continuar.'
      : null;

  const publicOrigin = getPublicOrigin(request);
  const isHttps = isHttpsRequest(request.headers, publicOrigin);
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

  const { data, error } = await supabase.auth.signUp({
    email: emailAnalysis.normalizedEmail,
    password,
    options: {
      data: {
        business_name: businessName,
      },
      emailRedirectTo: `${publicOrigin}/auth/callback`,
    },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || 'No se pudo crear la cuenta.' },
      { status: 400 }
    );
  }

  const isNewUser =
    Array.isArray(data.user?.identities) && data.user.identities.length > 0;

  // Refuerzo en backend con adminClient en caso de que el trigger de BD aún no haya sido migrado
  if (isNewUser && data.user && trialRestrictedReason && adminClient) {
    const { error: restrictError } = await adminClient
      .from('businesses')
      .update({
        subscription_status: 'inactive',
        trial_restricted_reason: trialRestrictedReason,
        canonical_email: emailAnalysis.canonicalEmail,
      })
      .eq('user_id', data.user.id)
      .eq('subscription_status', 'trialing');

    if (restrictError) {
      await adminClient
        .from('businesses')
        .update({ subscription_status: 'inactive' })
        .eq('user_id', data.user.id)
        .eq('subscription_status', 'trialing');
    }
  }

  const response = NextResponse.json({
    ok: true,
    hasSession: Boolean(data.session),
    trialRestricted: isNewUser ? Boolean(trialRestrictedReason) : false,
    trialRestrictedReason: isNewUser ? trialRestrictedReason : null,
  });

  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, adaptCookieOptions(options, isHttps));
  });

  return response;
}
