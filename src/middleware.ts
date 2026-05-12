import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// The /api/superadmin/* Next.js routes are a dev-only fallback that queries
// Postgres directly. In production (and any env where NEXT_PUBLIC_API_URL is
// set to a real URL), the React app talks to the rezonator NestJS backend
// instead, so this middleware blocks the local routes to prevent silently
// diverging code paths. An empty string means "not configured" — same as
// unset, since Next.js inlines empty .env values literally.
const REAL_BACKEND =
  process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.length > 0
    ? process.env.NEXT_PUBLIC_API_URL
    : undefined;

export function middleware(req: NextRequest) {
  if (!REAL_BACKEND) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // The login route keeps its dev-credential fallback even when a real
  // backend is configured, so it is exempt from the guard.
  if (pathname === '/api/superadmin/login') {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      message:
        'Dev-only fallback API disabled because NEXT_PUBLIC_API_URL is set. ' +
        'Requests should go to the rezonator backend.',
    },
    { status: 410 }
  );
}

export const config = {
  matcher: ['/api/superadmin/:path*'],
};
