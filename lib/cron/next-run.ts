import vercelConfig from '@/vercel.json';

interface CronEntry {
  path?: string;
  schedule?: string;
  requestMethod?: string;
}

interface VercelConfigShape {
  schedules?: Record<string, CronEntry>;
  crons?: CronEntry[];
}

const DEFAULT_CRON_SCHEDULE = '0 14 * * *';
const TARGET_CRON_PATH = '/api/cron/enviar-pendientes';

export function getConfiguredCronSchedule(): string {
  const config = vercelConfig as VercelConfigShape;

  if (config.schedules && typeof config.schedules === 'object') {
    const scheduleEntries = Object.values(config.schedules);
    const targetSchedule =
      config.schedules['enviar-pendientes'] ??
      scheduleEntries.find((entry) => entry.path === TARGET_CRON_PATH) ??
      scheduleEntries[0];

    const scheduleExpr = targetSchedule?.schedule?.trim();
    if (scheduleExpr) {
      return scheduleExpr;
    }
  }

  const crons = Array.isArray(config.crons) ? config.crons : [];
  const targetCron =
    crons.find((entry) => entry.path === TARGET_CRON_PATH) ?? crons[0];

  const legacySchedule = targetCron?.schedule?.trim();
  return legacySchedule || DEFAULT_CRON_SCHEDULE;
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  normalizeValue?: (v: number) => number
): Set<number> | null {
  const result = new Set<number>();
  const parts = field
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart !== undefined ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      return null;
    }

    let start = min;
    let end = max;

    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [rawStart, rawEnd] = rangePart.split('-');
        const parsedStart = Number.parseInt(rawStart, 10);
        const parsedEnd = Number.parseInt(rawEnd, 10);
        if (
          !Number.isInteger(parsedStart) ||
          !Number.isInteger(parsedEnd) ||
          parsedStart > parsedEnd
        ) {
          return null;
        }
        start = Math.max(min, parsedStart);
        end = Math.min(max, parsedEnd);
      } else {
        const single = Number.parseInt(rangePart, 10);
        if (!Number.isInteger(single)) {
          return null;
        }
        start = single;
        end = stepPart !== undefined ? max : single;
      }
    }

    for (let value = start; value <= end; value += step) {
      const normalized = normalizeValue ? normalizeValue(value) : value;
      if (normalized >= min && normalized <= max) {
        result.add(normalized);
      }
    }
  }

  return result.size > 0 ? result : null;
}

/**
 * Calcula la próxima fecha/hora de ejecución en UTC para una expresión cron estándar de 5 campos.
 */
export function getNextCronRunUtc(
  schedule: string,
  nowMs: number = Date.now()
): Date | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const [minField, hourField, domField, monthField, dowField] = fields;

  const minutes = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dowField, 0, 7, (v) => (v === 7 ? 0 : v));

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return null;
  }

  const domWildcard = domField.trim() === '*';
  const dowWildcard = dowField.trim() === '*';

  // Avanzar al siguiente minuto UTC completo posterior a nowMs
  const startMinuteMs = Math.floor(nowMs / 60_000) * 60_000 + 60_000;
  const maxMinutesToScan = 60 * 24 * 32; // Hasta 32 días

  for (let i = 0; i < maxMinutesToScan; i += 1) {
    const candidate = new Date(startMinuteMs + i * 60_000);
    const cMonth = candidate.getUTCMonth() + 1;
    if (!months.has(cMonth)) continue;

    const cHour = candidate.getUTCHours();
    if (!hours.has(cHour)) continue;

    const cMinute = candidate.getUTCMinutes();
    if (!minutes.has(cMinute)) continue;

    const cDom = candidate.getUTCDate();
    const cDow = candidate.getUTCDay();

    const domMatch = daysOfMonth.has(cDom);
    const dowMatch = daysOfWeek.has(cDow);

    const dayMatches =
      domWildcard && dowWildcard
        ? true
        : domWildcard
          ? dowMatch
          : dowWildcard
            ? domMatch
            : domMatch || dowMatch;

    if (dayMatches) {
      return candidate;
    }
  }

  return null;
}

export function formatTimeRemaining(diffMs: number): string {
  if (diffMs <= 0 || diffMs < 60_000) {
    return 'menos de 1 min';
  }

  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

export function formatLocalScheduleHint(
  targetDate: Date,
  nowDate: Date
): string {
  const timeText = new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(targetDate);

  const nowDayKey = `${nowDate.getFullYear()}-${nowDate.getMonth()}-${nowDate.getDate()}`;
  const targetDayKey = `${targetDate.getFullYear()}-${targetDate.getMonth()}-${targetDate.getDate()}`;

  if (nowDayKey === targetDayKey) {
    return `hoy a las ${timeText}`;
  }

  const tomorrow = new Date(nowDate);
  tomorrow.setDate(nowDate.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;

  if (targetDayKey === tomorrowKey) {
    return `mañana a las ${timeText}`;
  }

  const dateText = new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
  }).format(targetDate);

  return `${dateText} a las ${timeText}`;
}
