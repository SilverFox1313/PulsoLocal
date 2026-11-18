'use client';

import { useSyncExternalStore } from 'react';

interface FormattedDateProps {
  dateString: string;
}

const MONTH_NAMES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

function emptySubscribe() {
  return () => {};
}

export default function FormattedDate({ dateString }: FormattedDateProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  let display = dateString;
  try {
    const d = new Date(dateString);
    if (!Number.isNaN(d.getTime())) {
      const day = String(isClient ? d.getDate() : d.getUTCDate()).padStart(
        2,
        '0'
      );
      const month =
        MONTH_NAMES[isClient ? d.getMonth() : d.getUTCMonth()] ?? '';
      const year = isClient ? d.getFullYear() : d.getUTCFullYear();
      const hours = String(isClient ? d.getHours() : d.getUTCHours()).padStart(
        2,
        '0'
      );
      const mins = String(
        isClient ? d.getMinutes() : d.getUTCMinutes()
      ).padStart(2, '0');
      display = `${day} ${month} ${year}, ${hours}:${mins}`;
    }
  } catch {
    display = dateString;
  }

  return <span suppressHydrationWarning>{display}</span>;
}
