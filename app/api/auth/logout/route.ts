import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/config';
import {
  adaptCookieOptions,
  isHttpsRequest,
  isValidSameOriginPost,
} from '@/lib/supabase/cookie-options';

export async function POST(request: NextRequest) {
  if (!isValidSameOriginPost(request)) {
    return NextResponse.json(
      { error: 'Origen no autorizado.' },
      { status: 403 }
    );
  }

  const { url, anonKey, isConfigured } = getSupabaseEnv();
  const isHttps = isHttpsRequest(request.headers, request.url);
  const cookiesToApply: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  if (isConfigured) {
    try {
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

      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('[auth/logout] Supabase signOut warning:', error.message);
      }
    } catch (err) {
      console.warn(
        '[auth/logout] Unexpected signOut error:',
        err instanceof Error ? err.message : 'unknown'
      );
    }
  }

  const response = NextResponse.json({ ok: true });

  cookiesToApply.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, adaptCookieOptions(options, isHttps));
  });

  // Garantiza la limpieza local de cualquier cookie sb-* restante si el servidor remoto falló
  const appliedNames = new Set(cookiesToApply.map((cookie) => cookie.name));
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-') && !appliedNames.has(cookie.name)) {
      response.cookies.set(
        cookie.name,
        '',
        adaptCookieOptions({ maxAge: 0 }, isHttps)
      );
    }
  }

  return response;
}
