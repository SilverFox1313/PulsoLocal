import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/config';
import {
  adaptCookieOptions,
  isHttpsRequest,
} from '@/lib/supabase/cookie-options';

export async function POST(request: NextRequest) {
  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    return NextResponse.json(
      {
        error:
          'Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local.',
      },
      { status: 500 }
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

  const email = body.email?.trim() ?? '';
  const password = body.password ?? '';

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Ingresa tu correo y contraseña.' },
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
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(
      { error: error?.message || 'No se pudo iniciar sesión.' },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, adaptCookieOptions(options, isHttps));
  });

  return response;
}
