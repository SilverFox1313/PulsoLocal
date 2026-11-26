const SPANISH_ERROR_HINTS =
  /[áéíóúñü¿¡]|\b(no|se|pudo|pudimos|usa|ingresa|espera|inténtalo|intentalo|solicitud|correo|contraseña|negocio|cuenta|sesión|servidor|conexión|momento|autorizado|inválida|caracteres|coinciden|disponible|pausa|seguidos|bandeja)\b/i;

export function mapSupabaseAuthError(
  message: string | null | undefined,
  fallback = 'No pudimos completar la solicitud en este momento. Inténtalo de nuevo.'
): string {
  const raw = (message ?? '').trim();
  if (!raw) {
    return fallback;
  }

  const normalized = raw.toLowerCase();

  if (
    normalized.includes('invalid path specified in request url') ||
    normalized.includes('supabase_url') ||
    normalized.includes('invalid api key') ||
    normalized.includes('apikey')
  ) {
    return 'El servicio de autenticación no está disponible temporalmente. Inténtalo más tarde.';
  }

  if (normalized.includes('invalid login credentials')) {
    return 'Correo electrónico o contraseña incorrectos.';
  }

  if (normalized.includes('email not confirmed')) {
    return 'Tu cuenta aún no está confirmada. Revisa tu bandeja de entrada para verificar tu correo.';
  }

  if (
    normalized.includes('user already registered') ||
    normalized.includes('already been registered') ||
    normalized.includes('user_already_exists') ||
    normalized.includes('already exists')
  ) {
    return 'Ya existe una cuenta registrada con ese correo electrónico.';
  }

  if (
    normalized.includes('password should be at least') ||
    normalized.includes('weak_password') ||
    normalized.includes('valid password') ||
    normalized.includes('password is too short') ||
    normalized.includes('password length')
  ) {
    return 'La contraseña debe tener al menos 6 caracteres válidos.';
  }

  if (
    normalized.includes('unable to validate email address') ||
    normalized.includes('email_address_invalid') ||
    normalized.includes('invalid email')
  ) {
    return 'Ingresa un correo electrónico válido.';
  }

  if (
    normalized.includes('email_address_not_authorized') ||
    normalized.includes('not authorized')
  ) {
    return 'Este correo electrónico no está autorizado para registrarse en este momento.';
  }

  if (
    normalized.includes('signup is disabled') ||
    normalized.includes('signups not allowed') ||
    normalized.includes('signup_disabled')
  ) {
    return 'El registro de nuevas cuentas está deshabilitado temporalmente.';
  }

  if (
    normalized.includes('over_email_send_rate_limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('only request this after')
  ) {
    return 'Hicimos una breve pausa por varios intentos seguidos. Espera un momento e inténtalo de nuevo.';
  }

  if (
    normalized.includes('error sending confirmation') ||
    normalized.includes('confirmation mail') ||
    normalized.includes('sending recovery') ||
    normalized.includes('smtp')
  ) {
    return 'No pudimos enviar el correo de confirmación en este momento. Inténtalo de nuevo en unos minutos.';
  }

  if (
    normalized.includes('database error saving new user') ||
    normalized.includes('unexpected_failure')
  ) {
    return 'No pudimos completar el registro en este momento. Inténtalo nuevamente.';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network request failed')
  ) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.';
  }

  return fallback;
}

export function ensureSpanishAuthError(
  message: string | null | undefined,
  fallback = 'No pudimos completar la solicitud en este momento. Inténtalo de nuevo.'
): string {
  const raw = (message ?? '').trim();
  if (!raw) {
    return fallback;
  }

  const mapped = mapSupabaseAuthError(raw, '');
  if (mapped) {
    return mapped;
  }

  if (SPANISH_ERROR_HINTS.test(raw)) {
    return raw;
  }

  return fallback;
}
