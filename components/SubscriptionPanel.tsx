'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { updateSubscriptionStatusAction } from '@/app/dashboard/actions';
import type { Business, SubscriptionStatus } from '@/types/database';

interface SubscriptionPanelProps {
  business: Business;
  userEmail: string;
  totalRequestsCount: number;
  onUpdated: (updated: Business) => void;
}

const TRIAL_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function getRemainingTrialDays(createdAtIso: string): number {
  const createdMs = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdMs)) return TRIAL_DAYS;
  const elapsedDays = Math.floor(Math.max(0, Date.now() - createdMs) / MS_PER_DAY);
  return Math.max(0, TRIAL_DAYS - elapsedDays);
}

function getStatusSummary(
  status: SubscriptionStatus,
  remainingDays: number
): { label: string; detail: string; isActive: boolean } {
  switch (status) {
    case 'active':
      return {
        label: 'Plan Pro Activo',
        detail:
          'Todas las funciones de automatización, envío y gestión transparente de reseñas están habilitadas sin límite de solicitudes.',
        isActive: true,
      };
    case 'trialing':
      return {
        label: `Plan Trial — ${remainingDays} ${
          remainingDays === 1 ? 'día restante' : 'días restantes'
        }`,
        detail:
          remainingDays > 0
            ? 'Estás utilizando el periodo de prueba gratuito de 14 días. Activa el Plan Pro en cualquier momento para mantener el servicio sin interrupciones.'
            : 'Tu periodo de prueba de 14 días ha finalizado. Activa el Plan Pro para continuar enviando solicitudes automáticas.',
        isActive: false,
      };
    case 'past_due':
      return {
        label: 'Pago pendiente',
        detail:
          'Detectamos un inconveniente con tu último cobro. Actualiza tu método de pago para reactivar el Plan Pro.',
        isActive: false,
      };
    case 'canceled':
    case 'inactive':
    default:
      return {
        label: 'Plan Inactivo',
        detail:
          'Tu suscripción no se encuentra activa en este momento. Activa el Plan Pro para reanudar los envíos automáticos.',
        isActive: false,
      };
  }
}

export default function SubscriptionPanel({
  business,
  userEmail,
  totalRequestsCount,
  onUpdated,
}: SubscriptionPanelProps) {
  const [loadingAction, setLoadingAction] = useState<'activate' | 'reset' | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const remainingDays = getRemainingTrialDays(business.created_at);
  const summary = getStatusSummary(business.subscription_status, remainingDays);

  const rawStripeLink = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK?.trim() ?? '';
  const hasExternalPaymentLink =
    rawStripeLink.startsWith('https://') || rawStripeLink.startsWith('http://');

  const stripeCheckoutUrl = hasExternalPaymentLink
    ? `${rawStripeLink}${
        rawStripeLink.includes('?') ? '&' : '?'
      }prefilled_email=${encodeURIComponent(userEmail)}`
    : null;

  async function handleSimulatedActivation() {
    setError(null);
    setSuccessMessage(null);
    setLoadingAction('activate');

    const result = await updateSubscriptionStatusAction('active');
    setLoadingAction(null);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.business) {
      onUpdated(result.business);
      setSuccessMessage(
        'Plan Pro activado correctamente en modo demostración.'
      );
    }
  }

  async function handleResetToTrial() {
    setError(null);
    setSuccessMessage(null);
    setLoadingAction('reset');

    const result = await updateSubscriptionStatusAction('trialing');
    setLoadingAction(null);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.business) {
      onUpdated(result.business);
      setSuccessMessage('Estado restablecido a Plan Trial para pruebas.');
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
        <div className="flex flex-col gap-6 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-700">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-300">
              Estado actual de tu suscripción
            </p>
            <h2 className="mt-1.5 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl tabular-nums dark:text-zinc-50">
              {summary.isActive ? (
                <CheckCircle2
                  className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <Clock
                  className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              )}
              <span>{summary.label}</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
              {summary.detail}
            </p>
          </div>

          {business.subscription_status === 'active' && (
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={handleResetToTrial}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              {loadingAction === 'reset' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Volver a Plan Trial (prueba)</span>
            </button>
          )}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">Negocio</p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-zinc-100">
              {business.business_name}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Solicitudes registradas
            </p>
            <p className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-900 dark:text-zinc-100">
              {totalRequestsCount}{' '}
              {business.subscription_status === 'active'
                ? '/ Ilimitadas'
                : '/ 25 incluidas en Trial'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Titular de facturación
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-zinc-100">
              {userEmail}
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-6 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <span>{successMessage}</span>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
          <div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-5 dark:border-zinc-700">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-50">
                  Plan Trial
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-300">
                  Para negocios que prueban el flujo completo
                </p>
              </div>
              <p className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                $0{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-400">
                  / 14 días
                </span>
              </p>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Solicitudes de reseña
                </dt>
                <dd className="font-mono text-xs tabular-nums text-slate-800 dark:text-zinc-200">
                  Hasta 25 envíos
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Encuesta de satisfacción (1–5)
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluida
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Acceso directo a Google Maps
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Canal interno de mejora
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-8 text-xs text-slate-500 dark:text-zinc-400">
            {business.subscription_status === 'trialing'
              ? 'Este es tu plan actual.'
              : 'Periodo inicial de evaluación.'}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-amber-500/40 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-amber-500/60 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
          <div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-5 dark:border-zinc-700">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-50">
                  Plan Pro
                </h3>
                <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  Para negocios locales en crecimiento continuo
                </p>
              </div>
              <p className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-zinc-50">
                $29{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-zinc-300">
                  USD / mes
                </span>
              </p>
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Solicitudes de reseña
                </dt>
                <dd className="text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  Ilimitadas
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Automatización Cron y SMS
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Twilio / Programación
                </dd>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-zinc-700/70">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Flujo transparente a Google Maps
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Incluido
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-600 dark:text-zinc-300">
                  Soporte prioritario
                </dt>
                <dd className="text-xs font-medium text-slate-800 dark:text-zinc-200">
                  Respuesta &lt; 24 h
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-8 space-y-3">
            {business.subscription_status === 'active' ? (
              <div className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Plan Pro activo</span>
              </div>
            ) : stripeCheckoutUrl ? (
              <a
                href={stripeCheckoutUrl}
                rel="noopener noreferrer"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                <span>Suscribirse / Activar Plan Pro</span>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                disabled={loadingAction !== null}
                onClick={handleSimulatedActivation}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingAction === 'activate' ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Activando Plan Pro...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" aria-hidden="true" />
                    <span>Suscribirse / Activar Plan Pro</span>
                  </>
                )}
              </button>
            )}

            <p className="text-center text-xs text-slate-500 dark:text-zinc-400">
              {stripeCheckoutUrl
                ? 'Pago seguro procesado a través de Stripe Checkout.'
                : 'Modo de activación instantánea para pruebas (configura NEXT_PUBLIC_STRIPE_PAYMENT_LINK para enlazar tu checkout real de Stripe).'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
