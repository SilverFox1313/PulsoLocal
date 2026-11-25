import { normalizePhoneToE164 } from '@/lib/messaging/phone';
import {
  isValidPublicReviewLink,
  MAX_TEMPLATE_NAME_LENGTH,
  sanitizeWhatsAppTemplateVariable,
} from '@/lib/validation/messaging-safety';

export interface TemplateParams {
  customerName: string;
  businessName: string;
  reviewLink: string;
}

function cleanEnvValue(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

function isLocalOrBindOrigin(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    );
  } catch {
    return true;
  }
}

function resolvePublicBaseUrl(origin: string): string {
  const configuredAppUrl = cleanEnvValue(process.env.APP_URL);
  if (
    configuredAppUrl &&
    /^https?:\/\//i.test(configuredAppUrl) &&
    (process.env.NODE_ENV !== 'production' ||
      !isLocalOrBindOrigin(configuredAppUrl))
  ) {
    return configuredAppUrl.replace(/\/+$/, '');
  }

  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  if (
    cleanOrigin &&
    /^https?:\/\//i.test(cleanOrigin) &&
    !isLocalOrBindOrigin(cleanOrigin)
  ) {
    return cleanOrigin;
  }

  const vercelProdUrl = cleanEnvValue(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelProdUrl) {
    return `https://${vercelProdUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }

  const vercelUrl = cleanEnvValue(process.env.VERCEL_URL);
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }

  return cleanOrigin;
}

export function buildReviewLink(origin: string, requestId: string): string {
  const base = resolvePublicBaseUrl(origin);
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

export function canSimulateWhatsAppInCurrentEnv(): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowSimulated =
    cleanEnvValue(process.env.ALLOW_SIMULATED_WHATSAPP).toLowerCase() === 'true';

  return !isProduction || allowSimulated;
}

export interface DeliveryResult {
  ok: boolean;
  mode: 'whatsapp_cloud' | 'simulated';
  externalId?: string;
  retryable?: boolean;
  error?: string;
}

export interface SendWhatsAppContext {
  source?: string;
  requestId?: string;
  templateParams: TemplateParams;
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

function maskPhoneForLog(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return '***';
  }
  if (digits.length <= 4) {
    return `***${digits}`;
  }
  return `***${digits.slice(-4)}`;
}

function formatMetaErrorMessage(
  err: MetaGraphErrorPayload | undefined,
  httpStatus: number
): string {
  const code = err?.code;

  if (code === 190) {
    return 'La conexión con WhatsApp Empresarial expiró o no es válida. Renueva la autorización en el servidor.';
  }

  if (code === 131030) {
    return 'El número de destino no está habilitado para recibir mensajes desde esta cuenta de WhatsApp Empresarial.';
  }

  if (code === 131047) {
    return 'No fue posible iniciar la conversación fuera de la ventana de 24 h. Verifica que la plantilla aprobada de WhatsApp esté activa.';
  }

  if (code === 131026) {
    return 'No se pudo entregar el mensaje: verifica que el número destino tenga WhatsApp activo y código de país correcto.';
  }

  if (code === 132001) {
    return 'La plantilla de WhatsApp configurada no existe o aún no ha sido aprobada.';
  }

  if (code === 132000 || code === 132012 || code === 100 || code === 131008 || code === 131009) {
    return 'Los datos enviados no coinciden con las variables de la plantilla aprobada de WhatsApp.';
  }

  if (code === 130429 || code === 131056 || code === 80007 || httpStatus === 429) {
    return 'WhatsApp alcanzó temporalmente el límite de envíos. Se reintentará automáticamente en unos minutos.';
  }

  if (code === 131042 || code === 131045) {
    return 'La cuenta de WhatsApp Empresarial requiere revisión de facturación o verificación en Meta.';
  }

  if (httpStatus >= 500) {
    return 'El servicio de WhatsApp presenta una falla temporal. Se reintentará automáticamente.';
  }

  return 'No se pudo entregar el mensaje por WhatsApp en este momento. Verifica el número del cliente o intenta más tarde.';
}

function isRetryableMetaFailure(
  httpStatus: number,
  metaCode?: number
): boolean {
  if (httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) {
    return true;
  }

  // Errores de configuración / ventana que pueden reintentarse tras ajustar credenciales o reglas
  if (metaCode === 190 || metaCode === 131030 || metaCode === 131047) {
    return true;
  }

  return false;
}

export async function sendWhatsAppOrSimulate(
  toPhone: string,
  context: SendWhatsAppContext
): Promise<DeliveryResult> {
  const source = context.source ?? 'unknown';
  const requestId = context.requestId ?? null;
  const phoneNumberId = cleanEnvValue(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const accessToken = cleanEnvValue(process.env.WHATSAPP_ACCESS_TOKEN);
  const templateName = cleanEnvValue(process.env.WHATSAPP_TEMPLATE_NAME);
  const templateLang =
    cleanEnvValue(process.env.WHATSAPP_TEMPLATE_LANG) || 'es';
  const simulationAllowed = canSimulateWhatsAppInCurrentEnv();

  console.info('[WhatsApp Cloud API] Verificación previa de credenciales', {
    source,
    requestId,
    hasAccessToken: Boolean(accessToken),
    phoneNumberId: phoneNumberId || null,
    templateName: templateName || null,
    templateLang: templateName ? templateLang : null,
    simulationAllowed,
  });

  if (!phoneNumberId && !accessToken) {
    if (simulationAllowed) {
      console.warn(
        '[WhatsApp Cloud API] Faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN; ejecutando en modo simulado (entorno no productivo o ALLOW_SIMULATED_WHATSAPP=true).',
        { source, requestId }
      );
      return {
        ok: true,
        mode: 'simulated',
      };
    }

    console.error('[WhatsApp Cloud API] Credenciales faltantes en producción (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)', {
      source,
      requestId,
    });
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: true,
      error:
        'La conexión con WhatsApp Empresarial aún no está configurada en el servidor.',
    };
  }

  if (!phoneNumberId || !accessToken) {
    const serverReason = !phoneNumberId
      ? 'Falta WHATSAPP_PHONE_NUMBER_ID'
      : 'Falta WHATSAPP_ACCESS_TOKEN';

    console.error('[WhatsApp Cloud API] Error de credenciales incompletas', {
      source,
      requestId,
      hasAccessToken: Boolean(accessToken),
      phoneNumberId: phoneNumberId || null,
      error: serverReason,
    });

    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: true,
      error:
        'La conexión con WhatsApp Empresarial está incompleta en el servidor.',
    };
  }

  if (!templateName) {
    console.error(
      '[WhatsApp Cloud API] Falta WHATSAPP_TEMPLATE_NAME; los envíos de texto libre por WhatsApp están deshabilitados.',
      { source, requestId }
    );
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: true,
      error:
        'Falta completar la configuración de la plantilla oficial de WhatsApp en el servidor.',
    };
  }

  const cleanRecipient = normalizeWhatsAppRecipient(toPhone);
  if (!cleanRecipient) {
    const phoneError =
      'El número del cliente no es válido para WhatsApp (incluye el código de país, ej. +18095550199).';
    console.error('[WhatsApp Cloud API] Número de destinatario inválido', {
      source,
      requestId,
      recipient: maskPhoneForLog(toPhone),
      error: phoneError,
    });
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: false,
      error: phoneError,
    };
  }

  const maskedRecipient = maskPhoneForLog(cleanRecipient);
  const params = context.templateParams;
  if (!params || !isValidPublicReviewLink(params.reviewLink, context.requestId)) {
    const linkError =
      'El enlace público de reseña no tiene un formato válido para la plantilla de WhatsApp.';
    console.error('[WhatsApp Cloud API] Parámetros o enlace inválido para plantilla', {
      source,
      requestId,
      recipient: maskedRecipient,
      error: linkError,
    });
    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: false,
      error: linkError,
    };
  }

  const safeCustomerName = sanitizeWhatsAppTemplateVariable(
    params.customerName,
    'Cliente',
    MAX_TEMPLATE_NAME_LENGTH
  );
  const safeBusinessName = sanitizeWhatsAppTemplateVariable(
    params.businessName,
    'Nuestro Negocio',
    MAX_TEMPLATE_NAME_LENGTH
  );
  const safeReviewLink = params.reviewLink.trim();

  const messagePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanRecipient,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: templateLang,
      },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: safeCustomerName },
            { type: 'text', text: safeBusinessName },
            { type: 'text', text: safeReviewLink },
          ],
        },
      ],
    },
  };

  try {
    const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(
      phoneNumberId
    )}/messages`;

    console.info('[WhatsApp Cloud API] Enviando plantilla aprobada a Meta', {
      source,
      requestId,
      endpoint,
      phoneNumberId,
      recipient: maskedRecipient,
      messageType: 'template',
      templateName,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
      signal: AbortSignal.timeout(8000),
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
      const retryable = isRetryableMetaFailure(
        response.status,
        data.error?.code
      );

      console.error('[WhatsApp Cloud API] Respuesta de error de Meta', {
        source,
        requestId,
        status: response.status,
        retryable,
        recipient: maskedRecipient,
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
      });

      return {
        ok: false,
        mode: 'whatsapp_cloud',
        retryable,
        error: formatMetaErrorMessage(data.error, response.status),
      };
    }

    console.info('[WhatsApp Cloud API] Respuesta exitosa de Meta', {
      source,
      requestId,
      status: response.status,
      recipient: maskedRecipient,
      phoneNumberId,
      messageId: data.messages?.[0]?.id ?? null,
    });

    return {
      ok: true,
      mode: 'whatsapp_cloud',
      externalId: data.messages?.[0]?.id,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    const logMessage =
      err instanceof Error ? err.message : 'Error desconocido de red';
    const userErrorMessage = isTimeout
      ? 'Tiempo de espera agotado al contactar a WhatsApp. Se reintentará automáticamente.'
      : 'Error de conexión al intentar enviar el mensaje por WhatsApp. Se reintentará automáticamente.';

    console.error('[WhatsApp Cloud API] Error de red o excepción inesperada', {
      source,
      requestId,
      isTimeout,
      recipient: maskedRecipient,
      phoneNumberId,
      error: logMessage,
      ...(process.env.NODE_ENV !== 'production' && err instanceof Error
        ? { stack: err.stack }
        : {}),
    });

    return {
      ok: false,
      mode: 'whatsapp_cloud',
      retryable: true,
      error: userErrorMessage,
    };
  }
}


