import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/* ==========================================================================
   Proxy  (Next 16's replacement for the middleware convention)
   --------------------------------------------------------------------------
   Two jobs, and deliberately no more:

     1. Keep the Supabase session cookie fresh, so a long-lived tab does not
        silently expire mid-lesson.
     2. Send an unauthenticated request to /login rather than rendering an
        empty dashboard.

   It is NOT the authorisation boundary. Role checks live in the page (which
   redirects) and, properly, in Row Level Security (which returns nothing).
   This runs on every request with a cookie it cannot fully verify without a
   round trip, so treating it as the gate would be a mistake.
   ========================================================================== */

/* /checkout and /api/checkout are public because buyers arrive from the static
   marketing site with no account and the portal has no self-signup. Validation
   in the route is what stands in for a session there. */
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/webhooks",
  "/checkout",
  "/api/checkout",
  "/demo/switch",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const demoFlag =
    process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true" ||
    process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "1";
  const demo = demoFlag || !(url && anonKey);

  if (demo) {
    const signedIn = Boolean(request.cookies.get("oys_demo_profile")?.value);
    if (!signedIn && !isPublic(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return response;
  }

  const supabase = createServerClient(url!, anonKey!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Calling getUser() is what actually refreshes the token. Removing it would
  // make this a no-op that still looks like it is doing something.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname)) {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /* Everything except static assets and image files. The webhook route is
       matched but short-circuited by isPublic, so it keeps its raw body. */
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
