export interface CountryDialCodeOption {
  code: string;
  label: string;
  placeholder: string;
}

export const COUNTRY_DIAL_CODES: CountryDialCodeOption[] = [
  { code: '+1', label: '+1 (US/RD)', placeholder: '809 555 0199' },
  { code: '+52', label: '+52 (MX)', placeholder: '55 1234 5678' },
  { code: '+34', label: '+34 (ES)', placeholder: '612 345 678' },
  { code: '+57', label: '+57 (CO)', placeholder: '300 123 4567' },
  { code: '+54', label: '+54 (AR)', placeholder: '11 2345 6789' },
  { code: '+56', label: '+56 (CL)', placeholder: '9 1234 5678' },
  { code: '+51', label: '+51 (PE)', placeholder: '912 345 678' },
  { code: '+593', label: '+593 (EC)', placeholder: '99 123 4567' },
  { code: '+502', label: '+502 (GT)', placeholder: '5123 4567' },
  { code: '+506', label: '+506 (CR)', placeholder: '8123 4567' },
  { code: '+507', label: '+507 (PA)', placeholder: '6123 4567' },
  { code: 'custom', label: 'Otro (+)', placeholder: '+1 809 555 0199' },
];

const SORTED_KNOWN_CODES = COUNTRY_DIAL_CODES.filter(
  (item) => item.code !== 'custom'
)
  .map((item) => item.code)
  .sort((a, b) => b.length - a.length);

/**
 * Limpia prefijos duplicados accidentales (como `+1+1...` o `++...`).
 */
export function collapseDuplicatePrefixes(raw: string): string {
  let cleaned = raw
    .trim()
    .replace(/^(whatsapp\s*:\s*)+/i, '')
    .trim();

  // Colapsar múltiples signos + iniciales (ej. "++1..." -> "+1...")
  cleaned = cleaned.replace(/^\+{2,}/, '+');

  // Colapsar repeticiones de "+1" al inicio (ej. "+1+1 809..." o "+1 +1 809..." -> "+1 809...")
  cleaned = cleaned.replace(/^(?:\+\s*1[\s\-().]*){2,}/, '+1 ');

  // Colapsar múltiples signos + internos tras el código inicial (ej. "+52+52..." o "+1+809...")
  if (cleaned.startsWith('+')) {
    cleaned = `+${cleaned.slice(1).replace(/\+/g, '')}`;
  }

  return cleaned.trim();
}

/**
 * Detecta si un texto pegado o escrito inicia con `+` y separa el código de país si coincide con uno conocido.
 */
export function parseInternationalInput(raw: string): {
  hasExplicitPlus: boolean;
  matchedCode: string | null;
  localPart: string;
  collapsedRaw: string;
} {
  const collapsed = collapseDuplicatePrefixes(raw);
  if (!collapsed.startsWith('+')) {
    return {
      hasExplicitPlus: false,
      matchedCode: null,
      localPart: collapsed,
      collapsedRaw: collapsed,
    };
  }

  for (const code of SORTED_KNOWN_CODES) {
    if (collapsed.startsWith(code)) {
      const rest = collapsed.slice(code.length).replace(/^[\s-]+/, '');
      const restDigits = rest.replace(/\D/g, '');
      if (restDigits.length >= 4) {
        return {
          hasExplicitPlus: true,
          matchedCode: code,
          localPart: rest,
          collapsedRaw: collapsed,
        };
      }
    }
  }

  return {
    hasExplicitPlus: true,
    matchedCode: null,
    localPart: collapsed,
    collapsedRaw: collapsed,
  };
}

/**
 * Normaliza un número telefónico a formato E.164 limpio (ej. `+18095550199`).
 * Devuelve `null` si no cumple el rango válido de 7 a 15 dígitos.
 */
export function normalizePhoneToE164(
  rawInput: string,
  defaultDialCode = '+1'
): string | null {
  const collapsed = collapseDuplicatePrefixes(rawInput);
  if (!collapsed) {
    return null;
  }

  const effectiveDefault =
    defaultDialCode === 'custom' ? '+1' : defaultDialCode;
  const defaultDigits = effectiveDefault.replace(/\D/g, '') || '1';

  let finalDigits: string;

  if (collapsed.startsWith('+')) {
    finalDigits = collapsed.slice(1).replace(/\D/g, '');
  } else if (collapsed.startsWith('00')) {
    finalDigits = collapsed.slice(2).replace(/\D/g, '');
  } else {
    const localDigits = collapsed.replace(/\D/g, '');
    if (!localDigits) {
      return null;
    }

    if (
      defaultDigits === '1' &&
      localDigits.length === 11 &&
      localDigits.startsWith('1')
    ) {
      finalDigits = localDigits;
    } else if (
      defaultDigits !== '1' &&
      localDigits.startsWith(defaultDigits) &&
      localDigits.length >= defaultDigits.length + 9
    ) {
      finalDigits = localDigits;
    } else {
      finalDigits = `${defaultDigits}${localDigits}`;
    }
  }

  if (finalDigits.length < 7 || finalDigits.length > 15) {
    return null;
  }

  return `+${finalDigits}`;
}
