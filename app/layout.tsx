import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import AppToaster from '@/components/AppToaster';
import NavigationProgress from '@/components/NavigationProgress';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PulsoLocal — Automatizador de Reseñas y Reputación Local',
  description:
    'Automatizador de Reseñas y Reputación Local para negocios locales.',
  openGraph: {
    title: 'PulsoLocal',
    description:
      'Automatizador de Reseñas y Reputación Local para negocios locales.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PulsoLocal',
    description:
      'Automatizador de Reseñas y Reputación Local para negocios locales.',
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pulsolocal-theme');var r=document.documentElement;if(t==='light'){r.classList.remove('dark');r.style.colorScheme='light';}else{r.classList.add('dark');r.style.colorScheme='dark';}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`dark ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased transition-colors duration-300 ease-in-out selection:bg-amber-500/20 selection:text-amber-700 dark:bg-black dark:text-zinc-100 dark:selection:text-amber-200"
        suppressHydrationWarning
      >
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
