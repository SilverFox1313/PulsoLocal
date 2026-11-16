export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

  const hasValidUrl =
    url.startsWith('https://') || url.startsWith('http://');
  const isPlaceholder =
    url.includes('your-project-id') || anonKey.includes('your-supabase-anon-key');

  return {
    url,
    anonKey,
    isConfigured: Boolean(hasValidUrl && anonKey.length > 0 && !isPlaceholder),
  };
}
