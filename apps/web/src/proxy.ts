// apps/web/src/middleware.ts
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/auth/login",
  },
});

export const config = {
  // Only protect these specific routes and their sub-routes
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
  ],
};