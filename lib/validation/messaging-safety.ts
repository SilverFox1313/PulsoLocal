import { isValidUuid } from '@/lib/validation/uuid';

export const MIN_TEMPLATE_NAME_LENGTH = 2;
export const MAX_TEMPLATE_NAME_LENGTH = 50;
export const MAX_PRIVATE_FEEDBACK_COMMENT_LENGTH = 500;

const URL_OR_PROTOCOL_REGEX =
  /https?:\/\/|ftp:\/\/|mailto:|tel:|whatsapp:|\bwww\.|\bwa\.me\/|\bt\.me\/|\bbit\.ly\b|\btinyurl\.com\b|\bgoo\.gl\b/i;

const KNOWN_DOMAIN_REGEX =
  /\b[a-z0-9-]{2,}\.(?:com|net|org|edu|gov|io|co|app|dev|me|info|biz|xyz|top|online|site|store|shop|club|vip|link|ly|gg|cc|tv|click|live|pro|cloud|ai|es|mx|ar|cl|pe|ec|do|gt|cr|pa|us|uk|ca|br|fr|de|ru|cn|tk|ml|ga|cf|gq)\b(?:\/\S*)?/i;

const DOMAIN_WITH_PATH_REGEX = /\b[a-z0-9-]{2,}\.[a-z]{2,10}\/\S*/i;

const HTML_BRACKET_REGEX = /[<>]/;

const HOMOGLYPH_MAP: Record<string, string> = {
  а: 'a',
  е: 'e',
  ё: 'e',
  і: 'i',
  ї: 'i',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  ѕ: 's',
  ј: 'j',
  ӏ: 'l',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'y',
  χ: 'x',
};

const ABUSIVE_OR_SPAM_PATTERNS: RegExp[] = [
  /\bput[ao]s?\b/i,
  /\bmierda\b/i,
  /\bverga\b/i,
  /\bcabron(?:es|a|as)?\b/i,
  /\bpendej[ao]s?\b/i,
  /\bmaricon(?:es)?\b/i,
  /\bchinga(?:r|da|do|s)?\b/i,
  /\bculer[ao]s?\b/i,
  /\bfuck(?:ing|er|ed)?\b/i,
  /\bshit(?:ty)?\b/i,
  /\bbitch(?:es)?\b/i,
  /\basshole\b/i,
  /\bwhore\b/i,
  /\bslut\b/i,
  /\bcunt\b/i,
  /\bnigger\b/i,
  /\bfaggot\b/i,
  /\bviagra\b/i,
  /\bcialis\b/i,
  /\bcasino\b/i,
  /\bporno?\b/i,
  /\bxxx\b/i,
  /\bbinance\b/i,
  /\bairdrop\b/i,
  /\bphishing\b/i,
  /\bgana\s+dinero\b/i,
  /\bdinero\s+facil\b/i,
];

function isAsciiOrBidiControlChar(code: number): boolean {
  return (
    code <= 31 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function isZeroWidthOrInvisibleFormatChar(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x061c ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x17b4 ||
    code === 0x17b5 ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0x3164 ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    code === 0xffa0
  );
}

function isUnicodeSpaceSeparator(code: number): boolean {
  return (
    code === 0x00a0 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

export function containsControlOrNewlineChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isAsciiOrBidiControlChar(code) || isZeroWidthOrInvisibleFormatChar(code)) {
      return true;
    }
  }
  return false;
}

export function stripControlAndInvisibleChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isZeroWidthOrInvisibleFormatChar(code)) {
      continue;
    }
    if (isAsciiOrBidiControlChar(code) || isUnicodeSpaceSeparator(code)) {
      out += ' ';
    } else {
      out += value[i];
    }
  }
  return out.normalize('NFKC').replace(/ {2,}/g, ' ').trim();
}

export function normalizeForSafetyComparison(value: string): string {
  const stripped = stripControlAndInvisibleChars(value)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let folded = '';
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i];
    folded += HOMOGLYPH_MAP[ch] ?? ch;
  }

  return folded;
}

export function containsHtmlOrMarkup(value: string): boolean {
  return (
    HTML_BRACKET_REGEX.test(value) ||
    HTML_BRACKET_REGEX.test(normalizeForSafetyComparison(value))
  );
}

export function containsUrlOrDomain(value: string): boolean {
  const normalized = normalizeForSafetyComparison(value);
  return (
    URL_OR_PROTOCOL_REGEX.test(value) ||
    KNOWN_DOMAIN_REGEX.test(value) ||
    DOMAIN_WITH_PATH_REGEX.test(value) ||
    URL_OR_PROTOCOL_REGEX.test(normalized) ||
    KNOWN_DOMAIN_REGEX.test(normalized) ||
    DOMAIN_WITH_PATH_REGEX.test(normalized)
  );
}

export function containsAbusiveOrSpamTerms(value: string): boolean {
  const normalized = normalizeForSafetyComparison(value);
  return ABUSIVE_OR_SPAM_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function validateAndSanitizeTemplateName(
  rawValue: string,
  fieldLabel: 'nombre del negocio' | 'nombre del cliente',
  maxLength = MAX_TEMPLATE_NAME_LENGTH
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = rawValue.trim();

  for (let i = 0; i < trimmed.length; i += 1) {
    if (isAsciiOrBidiControlChar(trimmed.charCodeAt(i))) {
      return {
        ok: false,
        error: `El ${fieldLabel} no puede contener saltos de línea ni caracteres de control.`,
      };
    }
  }

  const cleaned = stripControlAndInvisibleChars(trimmed);

  if (cleaned.length < MIN_TEMPLATE_NAME_LENGTH || cleaned.length > maxLength) {
    return {
      ok: false,
      error: `El ${fieldLabel} debe tener entre ${MIN_TEMPLATE_NAME_LENGTH} y ${maxLength} caracteres.`,
    };
  }

  if (containsHtmlOrMarkup(cleaned)) {
    return {
      ok: false,
      error: `El ${fieldLabel} no puede contener etiquetas HTML ni los símbolos < o >.`,
    };
  }

  if (containsUrlOrDomain(cleaned)) {
    return {
      ok: false,
      error: `El ${fieldLabel} no puede contener enlaces, URLs ni nombres de dominio.`,
    };
  }

  if (containsAbusiveOrSpamTerms(cleaned)) {
    return {
      ok: false,
      error: `El ${fieldLabel} contiene términos no permitidos para mensajes a clientes.`,
    };
  }

  return { ok: true, value: cleaned };
}

/**
 * Sanitización defensiva de última línea justo antes de enviar parámetros a Meta WhatsApp Cloud API.
 * Nunca permite saltos de línea, HTML, URLs, términos abusivos ni valores fuera de longitud.
 */
export function sanitizeWhatsAppTemplateVariable(
  rawValue: string,
  fallback: string,
  maxLength = MAX_TEMPLATE_NAME_LENGTH
): string {
  let cleaned = stripControlAndInvisibleChars(rawValue ?? '')
    .replace(/[<>]/g, '')
    .replace(URL_OR_PROTOCOL_REGEX, ' ')
    .replace(KNOWN_DOMAIN_REGEX, ' ')
    .replace(DOMAIN_WITH_PATH_REGEX, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trim();
  }

  if (
    cleaned.length < MIN_TEMPLATE_NAME_LENGTH ||
    containsUrlOrDomain(cleaned) ||
    containsAbusiveOrSpamTerms(cleaned)
  ) {
    return fallback;
  }

  return cleaned;
}

export function isValidPublicReviewLink(
  rawUrl: string,
  expectedRequestId?: string
): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || containsControlOrNewlineChars(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.search || parsed.hash) {
      return false;
    }

    const match = /^\/r\/([^/]+)$/.exec(parsed.pathname);
    if (!match) {
      return false;
    }

    const pathRequestId = match[1];
    if (!isValidUuid(pathRequestId, { strictVersion: true })) {
      return false;
    }

    if (expectedRequestId && pathRequestId !== expectedRequestId) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
