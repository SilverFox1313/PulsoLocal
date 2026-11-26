'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import ActionLink from '@/components/ActionLink';
import { emitNavDone, emitNavStart } from '@/components/NavigationProgress';
import { emitAuthBusy } from '@/lib/auth/auth-busy';
import {
  ALLOWED_EMAIL_PROVIDER_ERROR,
  analyzeEmailForTrialAbuse,
} from '@/lib/subscription/trial';

interface AuthFormProps {
  mode: 'login' | 'signup';
  isSupabaseConfigured: boolean;
  initialError?: string | null;
}

function mapSupabaseError(message: string): string {
  const normalized = message.toLowerCase();

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
  if (normalized.includes('user already registered')) {
    return 'Ya existe una cuenta registrada con ese correo electrónico.';
  }
  if (normalized.includes('password should be at least') || normalized.includes('weak_password')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (
    normalized.includes('unable to validate email address') ||
    normalized.includes('email_address_invalid')
  ) {
    return 'Ingresa un correo electrónico válido.';
  }
  if (normalized.includes('signup is disabled') || normalized.includes('signups not allowed')) {
    return 'El registro de nuevas cuentas está deshabilitado temporalmente.';
  }
  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('only request this after')
  ) {
    return 'Hicimos una breve pausa por varios intentos seguidos. Espera un momento e inténtalo de nuevo.';
  }
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed') ||
    normalized.includes('fetch failed')
  ) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.';
  }

  return message;
}

export default function AuthForm({
  mode,
  isSupabaseConfigured,
  initialError = null,
}: AuthFormProps) {
  const isSignup = mode === 'signup';

  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(initialError);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(
    null
  );
  const [signupTrialNotice, setSignupTrialNotice] = useState<string | null>(
    null
  );

  const emailAnalysis = isSignup ? analyzeEmailForTrialAbuse(email) : null;
  const showsSubaddressingNotice = Boolean(emailAnalysis?.hasSubaddressing);

  useEffect(() => {
    return () => {
      emitAuthBusy(false);
    };
  }, []);

  function unlockSubmission() {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
    emitAuthBusy(false);
    emitNavDone();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;

    setError(null);

    if (!isSupabaseConfigured) {
      setError(
        'Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local para habilitar la autenticación.'
      );
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedBusiness = businessName.trim();

    if (isSignup && (trimmedBusiness.length < 2 || trimmedBusiness.length > 50)) {
      setError('El nombre del negocio debe tener entre 2 y 50 caracteres.');
      return;
    }

    const submittedEmailAnalysis = analyzeEmailForTrialAbuse(trimmedEmail);
    if (!submittedEmailAnalysis) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }

    if (!submittedEmailAnalysis.isAllowedProvider) {
      setError(ALLOWED_EMAIL_PROVIDER_ERROR);
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    emitAuthBusy(true);
    emitNavStart();

    try {
      if (isSignup) {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            businessName: trimmedBusiness,
            email: submittedEmailAnalysis.normalizedEmail,
            password,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          hasSession?: boolean;
          trialRestricted?: boolean;
          trialRestrictedReason?: string | null;
          error?: string;
        };

        if (!response.ok || !payload.ok) {
          setError(
            mapSupabaseError(
              payload.error || 'No se pudo crear la cuenta. Inténtalo de nuevo.'
            )
          );
          unlockSubmission();
          return;
        }

        if (payload.hasSession) {
          window.location.assign('/dashboard');
          return;
        }

        emitNavDone();
        emitAuthBusy(false);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setSignupTrialNotice(
          payload.trialRestricted
            ? (payload.trialRestrictedReason ??
                'El acceso automático al Trial gratuito está restringido para este correo.')
            : null
        );
        setVerificationSentTo(trimmedEmail);
        return;
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: submittedEmailAnalysis.normalizedEmail,
          password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(
          mapSupabaseError(
            payload.error || 'Correo electrónico o contraseña incorrectos.'
          )
        );
        unlockSubmission();
        return;
      }

      window.location.assign('/dashboard');
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '';
      const mapped = rawMessage ? mapSupabaseError(rawMessage) : '';
      setError(
        mapped && mapped !== rawMessage
          ? mapped
          : 'No pudimos completar la solicitud por un problema de conexión. Inténtalo nuevamente.'
      );
      unlockSubmission();
    }
  }

  if (verificationSentTo) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-colors duration-300 ease-in-out dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
      >
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Revisa tu correo electrónico
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          Enviamos un enlace de confirmación a{' '}
          <span className="font-medium text-slate-900 dark:text-zinc-200">
            {verificationSentTo}
          </span>
          . Una vez confirmado, tu espacio de negocio estará listo automáticamente.
        </p>

        {signupTrialNotice && (
          <div
            role="status"
            className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
          >
            {signupTrialNotice}
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-5 dark:border-white/[0.04]">
          <ActionLink
            href="/login"
            loadingText="Cargando..."
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/25 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-white"
          >
            Ir a iniciar sesión
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ActionLink>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition-colors duration-300 ease-in-out sm:p-8 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          {isSignup ? 'Crea tu cuenta' : 'Inicia sesión'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-zinc-300">
          {isSignup
            ? 'Configura tu negocio y comienza a automatizar tus reseñas.'
            : 'Accede al panel de control de tu reputación local.'}
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">
              Variables de Supabase pendientes
            </p>
            <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/80">
              Agrega <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code> y{' '}
              <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> en tu archivo{' '}
              <code className="font-mono text-[11px]">.env.local</code>.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <fieldset disabled={isSubmitting} className="space-y-4">
          {isSignup && (
            <div>
              <label
                htmlFor="businessName"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
              >
                Nombre del negocio
              </label>
              <input
                id="businessName"
                name="businessName"
                type="text"
                autoComplete="organization"
                required
                maxLength={50}
                disabled={isSubmitting}
                value={businessName}
                onChange={(e) => {
                  setError(null);
                  setBusinessName(e.target.value);
                }}
                placeholder="Ej. Clínica Dental Norte"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isSubmitting}
              value={email}
              onChange={(e) => {
                setError(null);
                setEmail(e.target.value);
              }}
              placeholder="tu@gmail.com"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
            {showsSubaddressingNotice ? (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                Los correos con alias (&ldquo;+&rdquo;) pueden registrarse, pero no reciben el Plan Trial gratuito automático. Usa tu correo principal si es tu primer negocio.
              </p>
            ) : (
              isSignup && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
                  Aceptamos Gmail, Outlook, Hotmail, Yahoo o iCloud.
                </p>
              )
            )}
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                required
                disabled={isSubmitting}
                value={password}
                onChange={(e) => {
                  setError(null);
                  setPassword(e.target.value);
                }}
                placeholder={isSignup ? 'Mínimo 6 caracteres' : '••••••••'}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
              />
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:text-amber-600 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200 dark:focus-visible:text-amber-400"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {isSignup && (
            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
              >
                Confirmar contraseña
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                disabled={isSubmitting}
                value={confirmPassword}
                onChange={(e) => {
                  setError(null);
                  setConfirmPassword(e.target.value);
                }}
                placeholder="Repite tu contraseña"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/25 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              isSubmitting
                ? 'pointer-events-none cursor-not-allowed opacity-50'
                : 'hover:from-amber-400 hover:to-orange-500 active:scale-[0.99]'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                <span>
                  {isSignup ? 'Creando cuenta...' : 'Iniciando sesión...'}
                </span>
              </>
            ) : (
              <span>{isSignup ? 'Crear cuenta' : 'Iniciar sesión'}</span>
            )}
          </button>
        </fieldset>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600 dark:border-white/[0.04] dark:text-zinc-300">
        {isSignup ? (
          <>
            ¿Ya tienes una cuenta?{' '}
            <ActionLink
              href="/login"
              loadingText="Cargando..."
              disabled={isSubmitting}
              className="font-medium text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
            >
              Inicia sesión
            </ActionLink>
          </>
        ) : (
          <>
            ¿Aún no tienes cuenta?{' '}
            <ActionLink
              href="/signup"
              loadingText="Cargando..."
              disabled={isSubmitting}
              className="font-medium text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
            >
              Regístrate gratis
            </ActionLink>
          </>
        )}
      </div>
    </motion.div>
  );
}
