import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv } from '@/lib/supabase/config';
import {
  adaptCookieOptions,
  getPublicOrigin,
  isHttpsRequest,
} from '@/lib/supabase/cookie-options';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/dashboard';
  const safeNext = next.startsWith('/') ? next : '/dashboard';

  const publicOrigin = getPublicOrigin(request);
  const isHttps = isHttpsRequest(request.headers, publicOrigin);
  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    return NextResponse.redirect(`${publicOrigin}/login?error=auth_callback_failed`);
  }

  const successResponse = NextResponse.redirect(`${publicOrigin}${safeNext}`);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          successResponse.cookies.set(
            name,
            value,
            adaptCookieOptions(options, isHttps)
          )
        );
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return successResponse;
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return successResponse;
    }
  }

  return NextResponse.redirect(`${publicOrigin}/login?error=auth_callback_failed`);
}
