'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export const NAV_START_EVENT = 'pulsolocal:nav-start';
export const NAV_DONE_EVENT = 'pulsolocal:nav-done';

export function emitNavStart() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_START_EVENT));
  }
}

export function emitNavDone() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NAV_DONE_EVENT));
  }
}

export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const trickleTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const lastRouteRef = useRef(`${pathname}?${searchParams.toString()}`);

  const clearTimers = () => {
    if (trickleTimerRef.current !== null) {
      window.clearInterval(trickleTimerRef.current);
      trickleTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  };

  const applyBarStyle = (scaleX: number, opacity: number) => {
    const el = barRef.current;
    if (!el) return;
    el.style.opacity = String(opacity);
    el.style.transform = `scaleX(${scaleX})`;
  };

  const startProgress = () => {
    clearTimers();
    progressRef.current = 0.14;
    applyBarStyle(0.14, 1);

    trickleTimerRef.current = window.setInterval(() => {
      const current = progressRef.current;
      const step = current < 0.45 ? 0.12 : current < 0.75 ? 0.05 : 0.015;
      const next = Math.min(0.92, current + step);
      progressRef.current = next;
      applyBarStyle(next, 1);
    }, 180);

    safetyTimerRef.current = window.setTimeout(() => {
      completeProgress();
    }, 15000);
  };

  const completeProgress = () => {
    clearTimers();
    if (progressRef.current === 0) return;

    progressRef.current = 1;
    applyBarStyle(1, 1);

    hideTimerRef.current = window.setTimeout(() => {
      applyBarStyle(1, 0);
      window.setTimeout(() => {
        progressRef.current = 0;
        applyBarStyle(0, 0);
      }, 200);
    }, 160);
  };

  useEffect(() => {
    const nextRoute = `${pathname}?${searchParams.toString()}`;
    if (lastRouteRef.current !== nextRoute) {
      lastRouteRef.current = nextRoute;
      completeProgress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleNavStart = () => startProgress();
    const handleNavDone = () => completeProgress();

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;

      const rawHref = anchor.getAttribute('href');
      if (
        !rawHref ||
        rawHref.startsWith('#') ||
        rawHref.startsWith('mailto:') ||
        rawHref.startsWith('tel:') ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('aria-disabled') === 'true'
      ) {
        return;
      }

      try {
        const destUrl = new URL(anchor.href, window.location.href);
        if (destUrl.origin !== window.location.origin) return;

        const currentUrl = new URL(window.location.href);
        if (
          destUrl.pathname === currentUrl.pathname &&
          destUrl.search === currentUrl.search
        ) {
          return;
        }

        startProgress();
      } catch {
        // Ignorar URLs inválidas
      }
    };

    window.addEventListener(NAV_START_EVENT, handleNavStart);
    window.addEventListener(NAV_DONE_EVENT, handleNavDone);
    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      clearTimers();
      window.removeEventListener(NAV_START_EVENT, handleNavStart);
      window.removeEventListener(NAV_DONE_EVENT, handleNavDone);
      document.removeEventListener('click', handleDocumentClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div
        ref={barRef}
        style={{ transform: 'scaleX(0)', opacity: 0 }}
        className="h-full w-full origin-left bg-amber-500 transition-[transform,opacity] duration-200 ease-out"
      />
    </div>
  );
}
