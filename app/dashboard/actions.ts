'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizePhoneToE164 } from '@/lib/messaging/phone';
import {
  evaluateTrialStatus,
  normalizeGoogleReviewUrl,
} from '@/lib/subscription/trial';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Business, ReviewRequest } from '@/types/database';

export async function signOutAction(): Promise<{ error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    redirect('/login');
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      error: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
    };
  }

  redirect('/login');
}

export interface UpdateBusinessSettingsInput {
  businessName: string;
  googleReviewUrl: string;
  messageTemplate: string;
  delayMinutes: number;
}

export async function updateBusinessSettingsAction(
  input: UpdateBusinessSettingsInput
): Promise<{ business?: Business; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const businessName = input.businessName.trim();
  const googleReviewUrl = input.googleReviewUrl.trim();
  const messageTemplate = input.messageTemplate.trim();
  const delayMinutes = Number(input.delayMinutes);

  if (businessName.length < 2 || businessName.length > 120) {
    return {
      error: 'El nombre del negocio debe tener entre 2 y 120 caracteres.',
    };
  }

  if (googleReviewUrl.length > 0) {
    try {
      const parsed = new URL(googleReviewUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          error:
            'El enlace de Google Reviews debe comenzar con https:// o http://.',
        };
      }
    } catch {
      return {
        error: 'Ingresa una URL válida para el enlace de reseñas de Google.',
      };
    }
  }

  if (messageTemplate.length < 5) {
    return {
      error: 'La plantilla del mensaje debe tener al menos 5 caracteres.',
    };
  }

  if (
    !Number.isInteger(delayMinutes) ||
    delayMinutes < 0 ||
    delayMinutes > 10080
  ) {
    return {
      error:
        'El retraso en minutos debe ser un número entero entre 0 y 10080 (7 días).',
    };
  }

  const { data: currentBusiness } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  const previousStatus = currentBusiness?.subscription_status ?? 'trialing';
  const normalizedUrl =
    googleReviewUrl.length > 0
      ? normalizeGoogleReviewUrl(googleReviewUrl)
      : null;

  const { data, error } = await supabase
    .from('businesses')
    .update({
      business_name: businessName,
      google_review_url: googleReviewUrl.length > 0 ? googleReviewUrl : null,
      message_template: messageTemplate,
      delay_minutes: delayMinutes,
    })
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error || !data) {
    return {
      error:
        error?.message ||
        'No se pudo actualizar la configuración del negocio.',
    };
  }

  let finalBusiness = data as Business;
  let duplicateUrlRestrictionMsg: string | null = null;

  // Caso 1: El trigger de PostgreSQL restringió el Trial automáticamente al detectar URL reutilizada
  if (
    previousStatus === 'trialing' &&
    finalBusiness.subscription_status === 'inactive'
  ) {
    duplicateUrlRestrictionMsg =
      finalBusiness.trial_restricted_reason ||
      'Este enlace de Google Reviews ya utilizó una prueba gratuita anteriormente. Activa un plan de pago para continuar.';
  }

  // Caso 2: Refuerzo en backend con adminClient (útil también antes de ejecutar la migración SQL)
  if (
    previousStatus !== 'active' &&
    finalBusiness.subscription_status === 'trialing' &&
    normalizedUrl
  ) {
    const adminClient = createAdminClient();
    if (adminClient) {
      let hasDuplicateUrl = false;

      const { data: claimMatches, error: claimErr } = await adminClient
        .from('trial_claims')
        .select('id, business_id')
        .eq('claim_type', 'google_review_url')
        .eq('claim_value', normalizedUrl)
        .neq('business_id', finalBusiness.id)
        .limit(1);

      if (!claimErr && claimMatches && claimMatches.length > 0) {
        hasDuplicateUrl = true;
      } else {
        const { data: otherBusinesses } = await adminClient
          .from('businesses')
          .select('id, google_review_url')
          .neq('id', finalBusiness.id)
          .not('google_review_url', 'is', null);

        if (otherBusinesses) {
          hasDuplicateUrl = otherBusinesses.some(
            (other) =>
              normalizeGoogleReviewUrl(other.google_review_url) ===
              normalizedUrl
          );
        }
      }

      if (hasDuplicateUrl) {
        const restrictionReason =
          'Este enlace de Google Reviews ya utilizó una prueba gratuita anteriormente. Activa un plan de pago para continuar.';

        const { data: restrictedBiz, error: restrictErr } = await adminClient
          .from('businesses')
          .update({
            subscription_status: 'inactive',
            trial_restricted_reason: restrictionReason,
            normalized_google_review_url: normalizedUrl,
          })
          .eq('id', finalBusiness.id)
          .select('*')
          .single();

        if (!restrictErr && restrictedBiz) {
          finalBusiness = restrictedBiz as Business;
        } else {
          const { data: fallbackRestricted } = await adminClient
            .from('businesses')
            .update({ subscription_status: 'inactive' })
            .eq('id', finalBusiness.id)
            .select('*')
            .single();

          if (fallbackRestricted) {
            finalBusiness = {
              ...(fallbackRestricted as Business),
              trial_restricted_reason: restrictionReason,
            };
          }
        }

        duplicateUrlRestrictionMsg = restrictionReason;
      }
    }
  }

  revalidatePath('/dashboard');

  if (duplicateUrlRestrictionMsg) {
    return {
      business: finalBusiness,
      error: duplicateUrlRestrictionMsg,
    };
  }

  return { business: finalBusiness };
}

export interface CreateReviewRequestInput {
  customerName: string;
  customerPhone: string;
}

export async function createReviewRequestAction(
  input: CreateReviewRequestInput
): Promise<{ request?: ReviewRequest; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const customerName = input.customerName.trim();
  const customerPhone = normalizePhoneToE164(input.customerPhone);

  if (customerName.length < 2 || customerName.length > 100) {
    return {
      error: 'El nombre del cliente debe tener entre 2 y 100 caracteres.',
    };
  }

  if (!customerPhone) {
    return {
      error:
        'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).',
    };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error:
        'No se encontró el perfil de tu negocio. Recarga la página o guarda tu configuración primero.',
    };
  }

  const typedBusiness = business as Business;

  // Los negocios con subscription_status === 'active' operan sin restricciones de Trial
  if (typedBusiness.subscription_status !== 'active') {
    const { count: existingRequestsCount, error: countError } = await supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', typedBusiness.id);

    if (countError) {
      return {
        error:
          'No se pudo verificar el límite de solicitudes de tu plan. Inténtalo nuevamente.',
      };
    }

    const trialEval = evaluateTrialStatus(typedBusiness, {
      totalRequestsCount: existingRequestsCount ?? 0,
    });

    if (trialEval.isCreationBlocked) {
      return {
        error:
          trialEval.creationErrorMessage ??
          'Tu plan actual no permite crear más solicitudes en este momento.',
      };
    }
  }

  const delayMinutes = Math.max(0, Number(typedBusiness.delay_minutes ?? 60));
  const scheduledFor =
    delayMinutes === 0
      ? new Date(Date.now() - 1000).toISOString()
      : new Date(Date.now() + delayMinutes * 60_000).toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from('review_requests')
    .insert({
      business_id: business.id,
      customer_name: customerName,
      customer_phone: customerPhone,
      status: 'pending',
      scheduled_for: scheduledFor,
    })
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .single();

  if (insertError || !inserted) {
    return {
      error:
        insertError?.message ||
        'No se pudo registrar la solicitud de reseña.',
    };
  }

  revalidatePath('/dashboard');
  return { request: inserted as ReviewRequest };
}

export interface UpdateReviewRequestInput {
  requestId: string;
  customerName: string;
  customerPhone: string;
  scheduledForIso?: string;
  sendNow?: boolean;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateReviewRequestAction(
  input: UpdateReviewRequestInput
): Promise<{ request?: ReviewRequest; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const requestId = input.requestId.trim();
  if (!UUID_REGEX.test(requestId)) {
    return { error: 'Identificador de solicitud inválido.' };
  }

  const customerName = input.customerName.trim();
  const customerPhone = normalizePhoneToE164(input.customerPhone);

  if (customerName.length < 2 || customerName.length > 100) {
    return {
      error: 'El nombre del cliente debe tener entre 2 y 100 caracteres.',
    };
  }

  if (!customerPhone) {
    return {
      error:
        'Ingresa un número de teléfono válido (entre 7 y 15 dígitos, con código de país).',
    };
  }

  let nextScheduledFor: string;
  if (input.sendNow) {
    nextScheduledFor = new Date(Date.now() - 1000).toISOString();
  } else {
    const rawDate = input.scheduledForIso?.trim() ?? '';
    const parsedDate = new Date(rawDate);
    if (!rawDate || Number.isNaN(parsedDate.getTime())) {
      return { error: 'Selecciona una fecha y hora programada válida.' };
    }
    nextScheduledFor = parsedDate.toISOString();
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error: 'No se encontró el perfil de tu negocio.',
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from('review_requests')
    .update({
      customer_name: customerName,
      customer_phone: customerPhone,
      scheduled_for: nextScheduledFor,
    })
    .eq('id', requestId)
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .select(
      'id, business_id, customer_name, customer_phone, status, scheduled_for, created_at'
    )
    .maybeSingle();

  if (updateError) {
    return {
      error:
        updateError.message ||
        'No se pudo actualizar la solicitud de reseña.',
    };
  }

  if (!updated) {
    return {
      error:
        'No se encontró la solicitud o ya fue procesada (solo se pueden editar solicitudes pendientes).',
    };
  }

  revalidatePath('/dashboard');
  return { request: updated as ReviewRequest };
}

export async function deleteReviewRequestAction(
  requestIdInput: string
): Promise<{ deletedId?: string; error?: string }> {
  const supabase = await createClient();

  if (!supabase) {
    return { error: 'La conexión con Supabase no está configurada.' };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  }

  const requestId = requestIdInput.trim();
  if (!UUID_REGEX.test(requestId)) {
    return { error: 'Identificador de solicitud inválido.' };
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (businessError || !business) {
    return {
      error: 'No se encontró el perfil de tu negocio.',
    };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('review_requests')
    .delete()
    .eq('id', requestId)
    .eq('business_id', business.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (deleteError) {
    return {
      error:
        deleteError.message ||
        'No se pudo eliminar la solicitud pendiente.',
    };
  }

  if (!deleted) {
    return {
      error:
        'No se encontró la solicitud o ya fue procesada (solo se pueden eliminar solicitudes pendientes).',
    };
  }

  revalidatePath('/dashboard');
  return { deletedId: deleted.id };
}

export async function updateSubscriptionStatusAction(
  nextStatus: 'active' | 'trialing'
): Promise<{ business?: Business; error?: string }> {
  void nextStatus;
  return {
    error:
      '403 Forbidden: El estado de la suscripción solo puede actualizarse desde el servidor tras verificar un pago válido.',
  };
}
