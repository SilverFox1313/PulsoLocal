import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { getSupabaseEnv } from './config';
import { adaptCookieOptions, isHttpsRequest } from './cookie-options';

export async function createClient() {
  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    return null;
  }

  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const isHttps = isHttpsRequest(headerList);

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, adaptCookieOptions(options, isHttps))
          );
        } catch {
          // El método setAll fue llamado desde un Server Component.
          // El middleware se encarga de refrescar las cookies de sesión.
        }
      },
    },
  });
}
