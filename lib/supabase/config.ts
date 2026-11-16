export function getSupabaseEnv() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

  // Limpiar /rest/v1 o barras finales si se proporcionó la URL de la API REST
  if (url.endsWith('/rest/v1/')) {
    url = url.slice(0, -9);
  } else if (url.endsWith('/rest/v1')) {
    url = url.slice(0, -8);
  } else {
    url = url.replace(/\/+$/, '');
  }

  const hasValidUrl =
    url.startsWith('https://') || url.startsWith('http://');
  const isPlaceholder =
    url.includes('your-project-id') ||
    anonKey.includes('your-supabase-anon-key') ||
    url === '' ||
    anonKey === '';

  return {
    url,
    anonKey,
    isConfigured: Boolean(hasValidUrl && anonKey.length > 0 && !isPlaceholder),
  };
}
