'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { updateBusinessSettingsAction } from '@/app/dashboard/actions';
import { validateGoogleReviewUrl } from '@/lib/validation/google-review-url';
import type { Business } from '@/types/database';

interface BusinessSettingsFormProps {
  business: Business;
  onUpdated: (updated: Business) => void;
}

export default function BusinessSettingsForm({
  business,
  onUpdated,
}: BusinessSettingsFormProps) {
  const [businessName, setBusinessName] = useState(business.business_name);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    business.google_review_url ?? ''
  );
  const [delayMinutes, setDelayMinutes] = useState(
    String(business.delay_minutes)
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedDelay = Number(delayMinutes);
    if (
      delayMinutes.trim() === '' ||
      !Number.isInteger(parsedDelay) ||
      parsedDelay < 0 ||
      parsedDelay > 10080
    ) {
      toast.error(
        'Ingresa un tiempo de espera válido en minutos (número entero entre 0 y 10080).'
      );
      return;
    }

    const trimmedGoogleUrl = googleReviewUrl.trim();
    if (trimmedGoogleUrl.length > 0) {
      const urlCheck = validateGoogleReviewUrl(trimmedGoogleUrl);
      if (!urlCheck.ok) {
        toast.error(urlCheck.error);
        return;
      }
    }

    setSaving(true);

    const result = await updateBusinessSettingsAction({
      businessName,
      googleReviewUrl,
      delayMinutes: parsedDelay,
    });

    setSaving(false);

    if (result.business) {
      onUpdated(result.business);
      setBusinessName(result.business.business_name);
      setGoogleReviewUrl(result.business.google_review_url ?? '');
      setDelayMinutes(String(result.business.delay_minutes));
    }

    if (result.error) {
      toast.error(result.error);
      return;
    }

    if (result.business) {
      toast.success('Configuración del negocio guardada');
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors duration-300 ease-in-out sm:p-8 dark:border-transparent dark:bg-[#1E1E24] dark:shadow-2xl dark:shadow-black/60">
      <div className="border-b border-slate-200 pb-5 dark:border-white/[0.04]">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-zinc-50">
          Configuración del negocio
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">
          Define el nombre visible, el tiempo de espera y tu enlace directo de
          Google Maps.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="settings-business-name"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Nombre del negocio
            </label>
            <input
              id="settings-business-name"
              name="businessName"
              type="text"
              required
              maxLength={50}
              disabled={saving}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Ej. Clínica Dental Norte"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
          </div>

          <div>
            <label
              htmlFor="settings-delay-minutes"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
            >
              Minutos de espera antes de enviar
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
              onChange={(e) => setDelayMinutes(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm tabular-nums text-slate-900 placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
              Usa{' '}
              <span className="font-mono tabular-nums text-slate-700 dark:text-zinc-300">
                0
              </span>{' '}
              para programar el envío inmediato o define minutos de espera (ej.{' '}
              <span className="font-mono tabular-nums text-slate-700 dark:text-zinc-300">
                60
              </span>{' '}
              para 1 hora).
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-google-url"
            className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-zinc-300"
          >
            Enlace directo de reseñas en Google Maps
          </label>
          <input
            id="settings-google-url"
            name="googleReviewUrl"
            type="url"
            disabled={saving}
            value={googleReviewUrl}
            onChange={(e) => setGoogleReviewUrl(e.target.value)}
            placeholder="https://g.page/r/tu-codigo-de-google/review"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 transition-colors focus:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-transparent dark:bg-[#27272E] dark:text-zinc-100 dark:shadow-sm dark:shadow-black/40 dark:placeholder:text-zinc-400 dark:focus:bg-[#32323A] dark:focus:border-amber-500/60"
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400">
            Copia este enlace <span className="font-mono">https://</span> desde
            tu perfil de Google Business Profile (&ldquo;Solicitar reseñas&rdquo;)
            o Google Maps (<span className="font-mono">g.page</span>,{' '}
            <span className="font-mono">maps.app.goo.gl</span>,{' '}
            <span className="font-mono">maps.google.com</span> o{' '}
            <span className="font-mono">google.com/maps</span>).
          </p>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-orange-500 bg-transparent px-5 text-sm font-semibold shadow-xs transition-all hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {saving ? (
              <>
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-orange-500 dark:text-orange-400"
                  aria-hidden="true"
                />
                <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                  Guardando...
                </span>
              </>
            ) : (
              <>
                <Save
                  className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400"
                  aria-hidden="true"
                />
                <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent font-semibold dark:from-orange-400 dark:to-amber-400">
                  Guardar cambios
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
