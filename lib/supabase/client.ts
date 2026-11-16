import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from './config';

export function createClient() {
  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    throw new Error(
      'Faltan o son inválidas las variables de entorno NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. Configúralas en tu archivo .env.local.'
    );
  }

  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:';

  return createBrowserClient(url, anonKey, {
    cookieOptions: isHttps
      ? {
          path: '/',
          sameSite: 'none',
          secure: true,
        }
      : {
          path: '/',
          sameSite: 'lax',
        },
  });
}
