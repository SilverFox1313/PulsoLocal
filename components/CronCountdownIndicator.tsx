'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  formatLocalScheduleHint,
  formatTimeRemaining,
  getConfiguredCronSchedule,
  getNextCronRunUtc,
} from '@/lib/cron/next-run';

interface CronCountdownIndicatorProps {
  hasPendingRequests: boolean;
}

const CRON_SCHEDULE = getConfiguredCronSchedule();

export default function CronCountdownIndicator({
  hasPendingRequests,
}: CronCountdownIndicatorProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    updateNow();

    const intervalId = window.setInterval(updateNow, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateNow();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const containerClass = hasPendingRequests
    ? 'mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/90 bg-amber-50/90 px-3 py-1.5 text-xs text-amber-950 shadow-xs transition-colors dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
    : 'mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-colors dark:border-white/[0.06] dark:bg-[#27272E] dark:text-zinc-200';

  const iconClass = hasPendingRequests
    ? 'h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400'
    : 'h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-zinc-400';

  if (nowMs === null) {
    return (
      <div className={containerClass}>
        <Clock className={iconClass} aria-hidden="true" />
        <span className="text-slate-600 dark:text-zinc-300">
          Calculando próximos envíos automáticos...
        </span>
      </div>
    );
  }

  const nextRun = getNextCronRunUtc(CRON_SCHEDULE, nowMs);
  if (!nextRun) {
    return null;
  }

  const diffMs = Math.max(0, nextRun.getTime() - nowMs);
  const countdownText = formatTimeRemaining(diffMs);
  const localHint = formatLocalScheduleHint(nextRun, new Date(nowMs));

  return (
    <div className={containerClass}>
      <Clock className={iconClass} aria-hidden="true" />
      <span className="tabular-nums">
        Próximos envíos automáticos en{' '}
        <strong
          className={
            hasPendingRequests
              ? 'font-semibold text-amber-900 dark:text-amber-300'
              : 'font-semibold text-slate-900 dark:text-zinc-50'
          }
        >
          {countdownText}
        </strong>
        <span
          className={
            hasPendingRequests
              ? 'ml-1.5 text-amber-800/80 dark:text-amber-200/80'
              : 'ml-1.5 text-slate-500 dark:text-zinc-400'
          }
        >
          ({localHint})
        </span>
      </span>
    </div>
  );
}
