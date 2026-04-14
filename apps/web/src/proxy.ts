// apps/web/src/proxy.ts
import createMiddleware from 'next-intl/middleware';
import { withAuth } from "next-auth/middleware";
import { NextRequest } from 'next/server';

const locales = ['en', 'tr']; 
// Designate root and authentication paths as publicly accessible perimeters
const publicPages = ['/', '/auth/login', '/auth/register'];

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale: 'en'
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
      signIn: '/en/auth/login',
    },
  }
);

// CRITICAL: Next.js 16 deprecates 'middleware' in favor of the 'proxy' convention
export default function proxy(req: NextRequest) {
  const publicPathnameRegex = RegExp(
    `^(/(${locales.join('|')}))?(${publicPages.join('|')})?/?$`,
    'i'
  );
  const isPublicPage = publicPathnameRegex.test(req.nextUrl.pathname);

  if (isPublicPage) {
    return intlMiddleware(req);
  } else {
    return (authMiddleware as any)(req);
  }
}

export const config = {
  // CRITICAL: Bypass the internationalization interceptor for API routes and static assets.
  // Failing to enforce this exclusion will corrupt NextAuth endpoints, resulting in 404 HTML errors.
  matcher: ['/((?!api|_next|.*\\..*).*)']
};