import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Aplica el middleware a todas las rutas excepto cron APIs, archivos estáticos e imágenes:
     * - api/cron/*
     * - _next/static
     * - _next/image
     * - favicon.ico
     * - archivos con extensión de imagen común
     */
    '/((?!api/cron(?:/.*)?|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
