import { normalizePhoneToE164 } from '@/lib/messaging/phone';

export interface TemplateParams {
  customerName: string;
  businessName: string;
  reviewLink: string;
}

export function buildReviewLink(origin: string, requestId: string): string {
  const configuredBase = process.env.APP_URL?.trim();
  const base =
    configuredBase && configuredBase.startsWith('http')
      ? configuredBase.replace(/\/+$/, '')
      : origin.replace(/\/+$/, '');

  return `${base}/r/${requestId}`;
}

export function buildReminderMessage(
  template: string,
  { customerName, businessName, reviewLink }: TemplateParams
): string {
  const baseTemplate =
    template.trim() ||
    'Hola {nombre}, gracias por elegir {negocio}. ¿Cómo calificarías tu experiencia? {enlace}';

  const hasLinkToken =
    baseTemplate.includes('{enlace}') ||
    baseTemplate.includes('{{review_link}}');

  let message = baseTemplate
    .replaceAll('{nombre}', customerName)
    .replaceAll('{{customer_name}}', customerName)
    .replaceAll('{negocio}', businessName)
    .replaceAll('{{business_name}}', businessName)
    .replaceAll('{enlace}', reviewLink)
    .replaceAll('{{review_link}}', reviewLink);

  if (!hasLinkToken) {
    message = `${message} ${reviewLink}`;
  }

  return message;
}

function cleanEnvValue(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/**
 * Normaliza un número telefónico al formato numérico limpio requerido por
 * la Meta WhatsApp Cloud API (solo dígitos con código de país, sin `+` ni `whatsapp:`).
 */
export function normalizeWhatsAppRecipient(raw: string): string | null {
  const e164 = normalizePhoneToE164(raw);
  if (!e164) {
    return null;
  }
  return e164.slice(1);
}

export interface WhatsAppEnvStatus {
  hasPhoneNumberId: boolean;
  hasAccessToken: boolean;
  isConfigured: boolean;
}

export function getWhatsAppEnvStatus(): WhatsAppEnvStatus {
  const phoneNumberId = cleanEnvValue(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const accessToken = cleanEnvValue(process.env.WHATSAPP_ACCESS_TOKEN);

  return {
    hasPhoneNumberId: Boolean(phoneNumberId),
    hasAccessToken: Boolean(accessToken),
    isConfigured: Boolean(phoneNumberId && accessToken),
  };
}

export function isWhatsAppCloudConfigured(): boolean {
  return getWhatsAppEnvStatus().isConfigured;
}

export interface DeliveryResult {
  ok: boolean;
  mode: 'whatsapp_cloud' | 'simulated';
  externalId?: string;
  error?: string;
}

export interface SendWhatsAppContext {
  source?: string;
  requestId?: string;
}

interface MetaGraphErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_data?: {
    details?: string;
  };
}

function formatMetaErrorMessage(
  err: MetaGraphErrorPayload | undefined,
  httpStatus: number
): string {
  const code = err?.code;
  const rawMessage =
    err?.message || `WhatsApp Cloud API respondió con estado HTTP ${httpStatus}.`;
  const details = err?.error_data?.details;

  if (code === 190) {
    return `[Meta 190] El token de acceso (WHATSAPP_ACCESS_TOKEN) expiró o es inválido. Genera uno nuevo en Meta Developers.`;
  }

  if (code === 131030) {
    return `[Meta 131030] El número destino no está autorizado en la lista de pruebas de tu app de Meta Developers. Agrégalo en "Para" (Manage phone number list) e inténtalo de nuevo.`;
  }

  if (code === 131047) {
    return `[Meta 131047] Han pasado más de 24 horas desde el último mensaje del cliente. Envía primero un mensaje desde ese WhatsApp al número de pruebas para abrir la ventana de 24 h.`;
  }

  if (code === 131026) {
    return `[Meta 131026] No se pudo entregar el mensaje: verifica que el número destino tenga WhatsApp activo y código de país correcto.`;
  }

  const base = code ? `[Meta ${code}] ${rawMessage}` : rawMessage;
  return details ? `${base} (${details})` : base;
}

export async function sendWhatsAppOrSimulate(
  toPhone: string,
  body: string,
  context: SendWhatsAppContext = {}
): Promise<DeliveryResult> {
  const source = context.source ?? 'unknown';
  const requestId = context.requestId ?? null;
  const phoneNumberId = cleanEnvValue(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const accessToken = cleanEnvValue(process.env.WHATSAPP_ACCESS_TOKEN);

  console.info('[WhatsApp Cloud API] Verificación previa de credenciales', {
    source,
    requestId,
    hasAccessToken: Boolean(accessToken),
    accessTokenLength: accessToken.length,
    phoneNumberId: phoneNumberId || null,
  });

  if (!phoneNumberId && !accessToken) {
    console.warn(
      '[WhatsApp Cloud API] Faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN; ejecutando en modo simulado (no se envió a Meta).',
      { source, requestId }
    );
    return {
      ok: true,
      mode: 'simulated',
    };
  }

  if (!phoneNumberId || !accessToken) {
    const missingError = !phoneNumberId
      ? 'Falta configurar WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.'
      : 'Falta configurar WHATSAPP_ACCESS_TOKEN en las variables de entorno.';

    console.error('[WhatsApp Cloud API] Error de credenciales incompletas', {
      source,
      requestId,
      hasAccessToken: Boolean(accessToken),
      phoneNumberId: phoneNumberId || null,
      error: missingError,
    });

    return {
      ok: false,
      mode: 'whatsapp_cloud',
      error: missingError,
    };
  }

  const cleanRecipient = normalizeWhatsAppRecipient(toPhone);
  if (!cleanRecipient) {
    const phoneError =
      'El número del cliente no es válido para WhatsApp Cloud API (incluye código de país, ej. +18097155343).';
    console.error('[WhatsApp Cloud API] Número de destinatario inválido', {
      source,
      requestId,
      rawPhone: toPhone,
      error: phoneError,
    });
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      error: phoneError,
    };
  }

  const cleanBody = body.trim();
  if (!cleanBody) {
    const bodyError = 'El cuerpo del mensaje de WhatsApp no puede estar vacío.';
    console.error('[WhatsApp Cloud API] Cuerpo de mensaje vacío', {
      source,
      requestId,
      recipient: cleanRecipient,
      error: bodyError,
    });
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      error: bodyError,
    };
  }

  try {
    const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(
      phoneNumberId
    )}/messages`;

    console.info('[WhatsApp Cloud API] Enviando petición a Meta', {
      source,
      requestId,
      endpoint,
      phoneNumberId,
      recipient: cleanRecipient,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanRecipient,
        type: 'text',
        text: {
          preview_url: true,
          body: cleanBody,
        },
      }),
    });

    const rawText = await response.text();
    let data: {
      messages?: Array<{ id?: string }>;
      error?: MetaGraphErrorPayload;
      [key: string]: unknown;
    } = {};

    if (rawText) {
      try {
        data = JSON.parse(rawText) as typeof data;
      } catch {
        data = { rawText };
      }
    }

    if (!response.ok) {
      console.error('[WhatsApp Cloud API] Respuesta de error de Meta', {
        source,
        requestId,
        status: response.status,
        recipient: cleanRecipient,
        phoneNumberId,
        metaError: data.error
          ? {
              code: data.error.code ?? null,
              message: data.error.message ?? null,
              type: data.error.type ?? null,
              error_subcode: data.error.error_subcode ?? null,
              fbtrace_id: data.error.fbtrace_id ?? null,
              error_data: data.error.error_data ?? null,
            }
          : null,
        data,
      });

      return {
        ok: false,
        mode: 'whatsapp_cloud',
        error: formatMetaErrorMessage(data.error, response.status),
      };
    }

    console.info('[WhatsApp Cloud API] Respuesta exitosa de Meta', {
      source,
      requestId,
      status: response.status,
      recipient: cleanRecipient,
      phoneNumberId,
      messageId: data.messages?.[0]?.id ?? null,
      data,
    });

    return {
      ok: true,
      mode: 'whatsapp_cloud',
      externalId: data.messages?.[0]?.id,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : 'Error de red al intentar enviar el mensaje mediante WhatsApp Cloud API.';

    console.error('[WhatsApp Cloud API] Error de red o excepción inesperada', {
      source,
      requestId,
      recipient: cleanRecipient,
      phoneNumberId,
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
    });

    return {
      ok: false,
      mode: 'whatsapp_cloud',
      error: errorMessage,
    };
  }
}


