'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { emitNavStart } from '@/components/NavigationProgress';

interface ActionLinkProps {
  href: string;
  children: ReactNode;
  loadingText?: string;
  className?: string;
  showSpinner?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function ActionLink({
  href,
  children,
  loadingText = 'Cargando...',
  className = '',
  showSpinner = true,
  ariaLabel,
  disabled = false,
}: ActionLinkProps) {
  const pathname = usePathname();
  const [navigatingFrom, setNavigatingFrom] = useState<string | null>(null);
  const lockRef = useRef<string | null>(null);

  const targetPath = href.split('?')[0].split('#')[0];
  const isNavigating =
    navigatingFrom !== null &&
    navigatingFrom === pathname &&
    targetPath !== pathname;
  const isBlocked = disabled || isNavigating;

  useEffect(() => {
    if (!isNavigating) return;

    const timer = window.setTimeout(() => {
      lockRef.current = null;
      setNavigatingFrom(null);
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [isNavigating]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    if (targetPath === pathname) {
      return;
    }

    if (lockRef.current === pathname || isNavigating) {
      event.preventDefault();
      return;
    }

    lockRef.current = pathname;
    setNavigatingFrom(pathname);
    emitNavStart();
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-disabled={isBlocked ? 'true' : undefined}
      aria-busy={isNavigating}
      tabIndex={isBlocked ? -1 : undefined}
      className={`${className} ${
        isBlocked
          ? 'pointer-events-none cursor-not-allowed opacity-60'
          : ''
      }`}
    >
      {isNavigating ? (
        <span className="inline-flex items-center justify-center gap-2">
          {showSpinner && (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
          )}
          <span>{loadingText}</span>
        </span>
      ) : (
        children
      )}
    </Link>
  );
}
