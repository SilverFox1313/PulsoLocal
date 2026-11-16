'use client';

interface FormattedDateProps {
  dateString: string;
}

export default function FormattedDate({ dateString }: FormattedDateProps) {
  let display = dateString;
  try {
    const d = new Date(dateString);
    if (!Number.isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const monthNames = [
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
      const month = monthNames[d.getUTCMonth()] ?? '';
      const year = d.getUTCFullYear();
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const mins = String(d.getUTCMinutes()).padStart(2, '0');
      display = `${day} ${month} ${year}, ${hours}:${mins}`;
    }
  } catch {
    display = dateString;
  }

  return <span suppressHydrationWarning>{display}</span>;
}
