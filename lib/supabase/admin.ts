import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './config';

export function createAdminClient() {
  const { url, isConfigured } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

  if (!isConfigured || !serviceRoleKey) {
    return null;
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
