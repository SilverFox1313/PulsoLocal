const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(
  value: string,
  options: { strictVersion?: boolean } = {}
): boolean {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  return options.strictVersion
    ? STRICT_UUID_REGEX.test(value)
    : UUID_REGEX.test(value);
}
