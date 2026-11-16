'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import { createClient } from '@/lib/supabase/client';

interface AuthFormProps {
  mode: 'login' | 'signup';
  isSupabaseConfigured: boolean;
  initialError?: string | null;
}

function mapSupabaseError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('invalid path specified in request url') ||
    normalized.includes('url') ||
    normalized.includes('apikey')
  ) {
    return 'Error de configuración de Supabase. Asegúrate de configurar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY con valores válidos en .env.local.';
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
  if (normalized.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (normalized.includes('unable to validate email address')) {
    return 'Ingresa un correo electrónico válido.';
  }
  if (normalized.includes('rate limit')) {
    return 'Demasiados intentos en poco tiempo. Espera un momento e inténtalo de nuevo.';
  }

  return message;
}

export default function AuthForm({
  mode,
  isSupabaseConfigured,
  initialError = null,
}: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === 'signup';

  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(
    null
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isSupabaseConfigured) {
      setError(
        'Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local para habilitar la autenticación.'
      );
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedBusiness = businessName.trim();

    if (isSignup && trimmedBusiness.length < 2) {
      setError('Ingresa el nombre de tu negocio (mínimo 2 caracteres).');
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Ingresa un correo electrónico válido.');
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

    setLoading(true);

    try {
      if (isSignup) {
        const supabase = createClient();
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              business_name: trimmedBusiness,
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (signUpError) {
          setError(mapSupabaseError(signUpError.message));
          setLoading(false);
          return;
        }

        if (data.session) {
          router.refresh();
          window.location.assign('/dashboard');
          return;
        }

        setVerificationSentTo(trimmedEmail);
        setLoading(false);
        return;
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmedEmail,
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
        setLoading(false);
        return;
      }

      router.refresh();
      window.location.assign('/dashboard');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Ocurrió un error inesperado. Inténtalo nuevamente.';
      setError(mapSupabaseError(message));
      setLoading(false);
    }
  }

  if (verificationSentTo) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#111114] p-8"
      >
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
          Revisa tu correo electrónico
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Enviamos un enlace de confirmación a{' '}
          <span className="font-medium text-zinc-200">{verificationSentTo}</span>.
          Una vez confirmado, tu espacio de negocio estará listo automáticamente.
        </p>

        <div className="mt-6 border-t border-zinc-800/80 pt-5">
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            Ir a iniciar sesión
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#111114] p-7 sm:p-8"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          {isSignup ? 'Crea tu cuenta' : 'Inicia sesión'}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          {isSignup
            ? 'Configura tu negocio y comienza a automatizar tus reseñas.'
            : 'Accede al panel de control de tu reputación local.'}
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-amber-100">
              Variables de Supabase pendientes
            </p>
            <p className="mt-0.5 text-amber-200/80">
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
          className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {isSignup && (
          <div>
            <label
              htmlFor="businessName"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Nombre del negocio
            </label>
            <input
              id="businessName"
              name="businessName"
              type="text"
              autoComplete="organization"
              required
              disabled={loading}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Ej. Clínica Dental Norte"
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-zinc-300"
          >
            Correo electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={loading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@negocio.com"
            className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-zinc-300"
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
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? 'Mínimo 6 caracteres' : '••••••••'}
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-3.5 pr-11 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={
                showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
              }
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:text-amber-400"
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
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Confirmar contraseña
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              disabled={loading}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite tu contraseña"
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{isSignup ? 'Creando cuenta...' : 'Iniciando sesión...'}</span>
            </>
          ) : (
            <span>{isSignup ? 'Crear cuenta' : 'Iniciar sesión'}</span>
          )}
        </button>
      </form>

      <div className="mt-6 border-t border-zinc-800/80 pt-5 text-center text-sm text-zinc-400">
        {isSignup ? (
          <>
            ¿Ya tienes una cuenta?{' '}
            <Link
              href="/login"
              className="font-medium text-amber-400 transition-colors hover:text-amber-300"
            >
              Inicia sesión
            </Link>
          </>
        ) : (
          <>
            ¿Aún no tienes cuenta?{' '}
            <Link
              href="/signup"
              className="font-medium text-amber-400 transition-colors hover:text-amber-300"
            >
              Regístrate gratis
            </Link>
          </>
        )}
      </div>
    </motion.div>
  );
}
