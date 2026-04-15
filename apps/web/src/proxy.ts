// apps/web/src/proxy.ts
import createMiddleware from 'next-intl/middleware';
import { withAuth } from "next-auth/middleware";
import { NextRequest, NextResponse } from 'next/server';

const locales = ['en', 'tr'];
const defaultLocale = 'en';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale
});

const authMiddleware = withAuth(
  function onSuccess(req) {
    return intlMiddleware(req);
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/auth/login',
    },
  }
);

export default function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 1. Identify the requested locale to maintain routing context
  const currentLocale = locales.find(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  ) || defaultLocale;

  // 2. Normalize the path by stripping the locale prefix
  const pathWithoutLocale = pathname.replace(new RegExp(`^/${currentLocale}`), '') || '/';

  // 3. Homepage resolution: Redirect root requests directly to the dashboard
  if (pathWithoutLocale === '/') {
    return NextResponse.redirect(new URL(`/${currentLocale}/dashboard`, req.url));
  }

  // 4. Define public authentication perimeters
  const isAuthPage = pathWithoutLocale.startsWith('/auth/login') || pathWithoutLocale.startsWith('/auth/register');

  // 5. Reliable session validation via secure and non-secure cookie inspection
  const hasToken = 
    req.cookies.has('next-auth.session-token') || 
    req.cookies.has('__Secure-next-auth.session-token');

  // 6. Infinite loop prevention: Route authenticated users away from login barriers
  if (isAuthPage && hasToken) {
    return NextResponse.redirect(new URL(`/${currentLocale}/dashboard`, req.url));
  }

  // 7. Execute middleware delegation
  if (isAuthPage) {
    return intlMiddleware(req);
  }

  return (authMiddleware as any)(req);
}

export const config = {
  // Bypass the internationalization interceptor for API routes and static assets
  matcher: ['/((?!api|_next|.*\\..*).*)']
};