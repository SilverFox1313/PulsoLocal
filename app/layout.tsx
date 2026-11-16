import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`dark ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body
        className="min-h-screen bg-[#09090B] font-sans text-zinc-100 antialiased selection:bg-amber-500/20 selection:text-amber-200"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
