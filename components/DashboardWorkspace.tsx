'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  MessageSquareWarning,
  Send,
  Settings,
  Users,
} from 'lucide-react';
import BusinessSettingsForm from '@/components/BusinessSettingsForm';
import PrivateFeedbackList from '@/components/PrivateFeedbackList';
import ReviewRequestForm from '@/components/ReviewRequestForm';
import ReviewRequestsTable from '@/components/ReviewRequestsTable';
import SubscriptionPanel from '@/components/SubscriptionPanel';
import type {
  Business,
  PrivateFeedbackItem,
  ReviewRequest,
} from '@/types/database';

interface DashboardWorkspaceProps {
  userEmail: string;
  initialBusiness: Business | null;
  initialRequests: ReviewRequest[];
  initialFeedback: PrivateFeedbackItem[];
  loadError?: string | null;
}

interface ProcessedReminderItem {
  id: string;
  customerName: string;
  customerPhone: string;
  reviewLink: string;
  messagePreview: string;
  deliveryMode: 'twilio' | 'simulated';
}

interface DispatchSummary {
  mode: 'twilio' | 'simulated';
  processed: number;
  failed: number;
  pendingFutureCount: number;
  items: ProcessedReminderItem[];
}

type DashboardTab = 'requests' | 'feedback' | 'settings' | 'subscription';

function getHeaderPlanLabel(business: Business): string {
  if (business.subscription_status === 'active') {
    return 'Plan Pro Activo';
  }
  if (business.subscription_status === 'trialing') {
    const createdMs = new Date(business.created_at).getTime();
    const elapsedDays = Number.isNaN(createdMs)
      ? 0
      : Math.floor(Math.max(0, Date.now() - createdMs) / 86_400_000);
    const remaining = Math.max(0, 14 - elapsedDays);
    return `Plan Trial (${remaining} d restantes)`;
  }
  if (business.subscription_status === 'past_due') {
    return 'Pago pendiente';
  }
  return 'Plan inactivo';
}

export default function DashboardWorkspace({
  userEmail,
  initialBusiness,
  initialRequests,
  initialFeedback,
  loadError = null,
}: DashboardWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>('requests');
  const [business, setBusiness] = useState<Business | null>(initialBusiness);
  const [requests, setRequests] = useState<ReviewRequest[]>(initialRequests);

  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] =
    useState<DispatchSummary | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const negativeFeedbackCount = initialFeedback.filter(
    (item) => item.rating <= 3
  ).length;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  function handleRequestCreated(newRequest: ReviewRequest) {
    setRequests((prev) => [newRequest, ...prev]);
    setDispatchSummary(null);
  }

  function handleBusinessUpdated(updated: Business) {
    setBusiness(updated);
  }

  async function handleCopyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      // Silencioso si el portapapeles no está disponible
    }
  }

  async function runSendReminders(includeFuture = false) {
    setDispatchError(null);
    setDispatching(true);

    try {
      const response = await fetch('/api/cron/send-reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeFuture }),
      });

      const payload = (await response.json().catch(() => ({}))) as
        | (DispatchSummary & { ok?: boolean; error?: string })
        | undefined;

      if (!response.ok || !payload?.ok) {
        setDispatchError(
          payload?.error ||
            'No se pudo ejecutar la verificación de envíos pendientes.'
        );
        setDispatching(false);
        return;
      }

      const sentIds = new Set(payload.items.map((item) => item.id));
      if (sentIds.size > 0) {
        setRequests((prev) =>
          prev.map((req) =>
            sentIds.has(req.id) ? { ...req, status: 'sent' } : req
          )
        );
      }

      setDispatchSummary({
        mode: payload.mode,
        processed: payload.processed,
        failed: payload.failed,
        pendingFutureCount: payload.pendingFutureCount,
        items: payload.items,
      });

      router.refresh();
    } catch {
      setDispatchError(
        'Error de conexión al ejecutar la verificación de envíos.'
      );
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="border-b border-slate-200 pb-8 dark:border-zinc-700">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 bg-clip-text text-transparent dark:from-orange-400 dark:via-amber-400 dark:to-orange-500">
              Bienvenido
            </span>
            <span className="ml-2 inline-block">👋</span>
          </h1>

          <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-800 sm:text-3xl dark:text-zinc-100">
            {business?.business_name || 'Mi Negocio'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            <span className="font-medium text-slate-900 dark:text-zinc-100">
              {userEmail}
            </span>
            {business && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Retraso: {business.delay_minutes} min
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {business.google_review_url
                    ? 'Enlace de Google configurado'
                    : 'Falta configurar enlace de Google'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-medium tabular-nums text-slate-800 dark:text-zinc-200">
                  {getHeaderPlanLabel(business)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="mt-5">
          <div
            role="tablist"
            aria-label="Secciones del panel"
            className="grid w-full grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-xs transition-colors duration-300 ease-in-out md:inline-flex md:w-auto md:flex-nowrap md:items-center md:gap-1 shrink-0 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'requests'}
              onClick={() => setActiveTab('requests')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'requests'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Solicitudes</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'feedback'}
              onClick={() => setActiveTab('feedback')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'feedback'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              <MessageSquareWarning className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                Opiniones Privadas
                {negativeFeedbackCount > 0 ? ` (${negativeFeedbackCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Configuración</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'subscription'}
              onClick={() => setActiveTab('subscription')}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:px-3.5 sm:text-sm ${
                activeTab === 'subscription'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-900 font-semibold shadow-xs dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Suscripción</span>
            </button>
          </div>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{loadError}</span>
        </div>
      )}

      {business && !business.google_review_url && activeTab === 'requests' && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/50 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
          <p className="text-sm text-amber-900 dark:text-amber-100">
            Aún no has agregado tu enlace directo de reseñas de Google Maps.
            Configúralo antes de enviar tus primeras invitaciones.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-500/40 bg-white px-3.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/50 dark:bg-zinc-800 dark:text-amber-300 dark:hover:bg-zinc-700 whitespace-nowrap shrink-0"
          >
            Configurar enlace
          </button>
        </div>
      )}

      {!business ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-lg dark:shadow-black/30">
          No se encontró el perfil del negocio en Supabase. Verifica que hayas
          ejecutado el script SQL de creación de tablas y políticas RLS en tu
          proyecto.
        </section>
      ) : activeTab === 'requests' ? (
        <div className="space-y-8">
          <ReviewRequestForm
            delayMinutes={business.delay_minutes}
            onCreated={handleRequestCreated}
          />

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-lg dark:shadow-black/30">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
                  Automatización de envíos
                </h2>
                <p className="mt-1 text-sm text-slate-600 tabular-nums dark:text-zinc-300">
                  {pendingCount === 0
                    ? 'No hay solicitudes en estado pendiente en este momento.'
                    : `${pendingCount} ${
                        pendingCount === 1
                          ? 'solicitud pendiente'
                          : 'solicitudes pendientes'
                      } esperando su hora programada.`}
                </p>
              </div>

              <button
                type="button"
                disabled={dispatching}
                onClick={() => runSendReminders(false)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 text-sm font-semibold text-zinc-900 shadow-md shadow-amber-500/20 transition-all hover:from-amber-400 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {dispatching ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Verificando envíos...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>Verificar y Enviar Pendientes</span>
                  </>
                )}
              </button>
            </div>

            {dispatchError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                  aria-hidden="true"
                />
                <span>{dispatchError}</span>
              </div>
            )}

            {dispatchSummary && (
              <div className="mt-5 border-t border-slate-200 pt-5 dark:border-zinc-700">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-slate-900 tabular-nums dark:text-zinc-100">
                        {dispatchSummary.processed}{' '}
                        {dispatchSummary.processed === 1
                          ? 'solicitud procesada'
                          : 'solicitudes procesadas'}{' '}
                        ·{' '}
                        <span className="text-slate-600 dark:text-zinc-300">
                          {dispatchSummary.mode === 'twilio'
                            ? 'Enviado por Twilio SMS'
                            : 'Modo simulado (sin Twilio)'}
                        </span>
                      </p>
                      {dispatchSummary.processed === 0 &&
                        dispatchSummary.pendingFutureCount > 0 && (
                          <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-zinc-300">
                            Tienes {dispatchSummary.pendingFutureCount}{' '}
                            {dispatchSummary.pendingFutureCount === 1
                              ? 'solicitud cuya hora programada aún no se cumple'
                              : 'solicitudes cuya hora programada aún no se cumple'}
                            .
                          </p>
                        )}
                    </div>
                  </div>

                  {dispatchSummary.processed === 0 &&
                    dispatchSummary.pendingFutureCount > 0 && (
                      <button
                        type="button"
                        disabled={dispatching}
                        onClick={() => runSendReminders(true)}
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-3.5 text-xs font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-200 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 whitespace-nowrap shrink-0"
                      >
                        Forzar envío ahora (prueba)
                      </button>
                    )}
                </div>

                {dispatchSummary.items.length > 0 && (
                  <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200 dark:divide-zinc-700 dark:border-zinc-700">
                    {dispatchSummary.items.map((item) => {
                      const linkKey = `link-${item.id}`;
                      const msgKey = `msg-${item.id}`;
                      return (
                        <li
                          key={item.id}
                          className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                              {item.customerName}{' '}
                              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-zinc-300">
                                · {item.customerPhone}
                              </span>
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-zinc-300">
                              {item.reviewLink}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(linkKey, item.reviewLink)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-white whitespace-nowrap shrink-0"
                            >
                              {copiedKey === linkKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-700 dark:text-emerald-300">
                                    Enlace copiado
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Copiar enlace</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(msgKey, item.messagePreview)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-white whitespace-nowrap shrink-0"
                            >
                              {copiedKey === msgKey ? (
                                <>
                                  <Check
                                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden="true"
                                  />
                                  <span className="text-emerald-700 dark:text-emerald-300">
                                    Mensaje copiado
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Copiar mensaje</span>
                                </>
                              )}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          <ReviewRequestsTable requests={requests} />
        </div>
      ) : activeTab === 'feedback' ? (
        <PrivateFeedbackList items={initialFeedback} />
      ) : activeTab === 'settings' ? (
        <BusinessSettingsForm
          business={business}
          onUpdated={handleBusinessUpdated}
        />
      ) : (
        <SubscriptionPanel
          business={business}
          userEmail={userEmail}
          totalRequestsCount={requests.length}
          onUpdated={handleBusinessUpdated}
        />
      )}
    </div>
  );
}
