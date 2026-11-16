'use client';

import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { updateBusinessSettingsAction } from '@/app/dashboard/actions';
import type { Business } from '@/types/database';

interface BusinessSettingsFormProps {
  business: Business;
  onUpdated: (updated: Business) => void;
}

const TEMPLATE_VARIABLES = [
  { token: '{nombre}', label: '+ {nombre}' },
  { token: '{negocio}', label: '+ {negocio}' },
  { token: '{enlace}', label: '+ {enlace}' },
];

export default function BusinessSettingsForm({
  business,
  onUpdated,
}: BusinessSettingsFormProps) {
  const [businessName, setBusinessName] = useState(business.business_name);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    business.google_review_url ?? ''
  );
  const [messageTemplate, setMessageTemplate] = useState(
    business.message_template
  );
  const [delayMinutes, setDelayMinutes] = useState(
    String(business.delay_minutes)
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  function insertVariable(token: string) {
    setSavedMessage(null);
    setMessageTemplate((prev) => {
      const separator =
        prev.length === 0 || prev.endsWith(' ') || prev.endsWith('\n')
          ? ''
          : ' ';
      return `${prev}${separator}${token}`;
    });
  }

  function renderPreview(): string {
    const sampleBusiness = businessName.trim() || 'Tu Negocio';
    return messageTemplate
      .replaceAll('{nombre}', 'María')
      .replaceAll('{{customer_name}}', 'María')
      .replaceAll('{negocio}', sampleBusiness)
      .replaceAll('{{business_name}}', sampleBusiness)
      .replaceAll('{enlace}', 'https://pulsolocal.app/r/ejemplo')
      .replaceAll('{{review_link}}', 'https://pulsolocal.app/r/ejemplo');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavedMessage(null);

    const parsedDelay = Number(delayMinutes);
    if (
      delayMinutes.trim() === '' ||
      !Number.isInteger(parsedDelay) ||
      parsedDelay < 0 ||
      parsedDelay > 10080
    ) {
      setError(
        'Ingresa un retraso válido en minutos (número entero entre 0 y 10080).'
      );
      return;
    }

    setSaving(true);

    const result = await updateBusinessSettingsAction({
      businessName,
      googleReviewUrl,
      messageTemplate,
      delayMinutes: parsedDelay,
    });

    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.business) {
      onUpdated(result.business);
      setBusinessName(result.business.business_name);
      setGoogleReviewUrl(result.business.google_review_url ?? '');
      setMessageTemplate(result.business.message_template);
      setDelayMinutes(String(result.business.delay_minutes));
      setSavedMessage('Cambios guardados correctamente.');
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#111114] p-6 sm:p-8">
      <div className="border-b border-zinc-800/80 pb-5">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
          Configuración del negocio
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Define el nombre visible, tu enlace de Google Maps y la plantilla de
          invitación para tus clientes.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {savedMessage && (
        <div
          role="status"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
            aria-hidden="true"
          />
          <span>{savedMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="settings-business-name"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Nombre del negocio
            </label>
            <input
              id="settings-business-name"
              name="businessName"
              type="text"
              required
              disabled={saving}
              value={businessName}
              onChange={(e) => {
                setSavedMessage(null);
                setBusinessName(e.target.value);
              }}
              placeholder="Ej. Clínica Dental Norte"
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="settings-delay-minutes"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Minutos de retraso antes de enviar
            </label>
            <input
              id="settings-delay-minutes"
              name="delayMinutes"
              type="number"
              min={0}
              max={10080}
              step={1}
              required
              disabled={saving}
              value={delayMinutes}
              onChange={(e) => {
                setSavedMessage(null);
                setDelayMinutes(e.target.value);
              }}
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 font-mono text-sm tabular-nums text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              Usa <span className="font-mono tabular-nums text-zinc-400">0</span>{' '}
              para programar el envío inmediato o define minutos de espera (ej.{' '}
              <span className="font-mono tabular-nums text-zinc-400">60</span>{' '}
              para 1 hora).
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-google-url"
            className="mb-1.5 block text-sm font-medium text-zinc-300"
          >
            Enlace directo de reseñas en Google Maps
          </label>
          <input
            id="settings-google-url"
            name="googleReviewUrl"
            type="url"
            disabled={saving}
            value={googleReviewUrl}
            onChange={(e) => {
              setSavedMessage(null);
              setGoogleReviewUrl(e.target.value);
            }}
            placeholder="https://g.page/r/tu-codigo-de-google/review"
            className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 font-mono text-sm text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Copia este enlace desde tu perfil de Google Business Profile en la
            opción &ldquo;Solicitar reseñas&rdquo;.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="settings-message-template"
              className="block text-sm font-medium text-zinc-300"
            >
              Plantilla del mensaje de texto
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {TEMPLATE_VARIABLES.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  disabled={saving}
                  onClick={() => insertVariable(item.token)}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            id="settings-message-template"
            name="messageTemplate"
            rows={4}
            required
            disabled={saving}
            value={messageTemplate}
            onChange={(e) => {
              setSavedMessage(null);
              setMessageTemplate(e.target.value);
            }}
            placeholder="Hola {nombre}, gracias por visitarnos en {negocio}. ¿Cómo calificarías tu experiencia? {enlace}"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="mt-4 border-t border-zinc-800/70 pt-3.5">
            <p className="text-xs font-medium text-zinc-400">
              Vista previa con datos de ejemplo
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
              {renderPreview() || 'Escribe un mensaje para previsualizarlo.'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-zinc-800/80 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>Guardar cambios</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
