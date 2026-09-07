import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Protects all routes except the public ones excluded by `matcher` below
 * (login page, auth API, tokenized client delivery, Next static assets). Uses
 * the edge-safe session module only — no Prisma / Node-only imports here.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Public product landing page + its lead API + the static PDF (`/freedom...`)
    // are intentionally unauthenticated, alongside login/auth and tokenized delivery.
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|deliver|api/deliver|freedom|api/leads).*)",
  ],
};
