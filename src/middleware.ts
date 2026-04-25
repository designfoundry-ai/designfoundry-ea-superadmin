import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const REAL_BACKEND = process.env.NEXT_PUBLIC_API_URL;

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
        'Local mock API is disabled because NEXT_PUBLIC_API_URL is set. ' +
        'Requests should go to the real backend.',
    },
    { status: 410 }
  );
}

export const config = {
  matcher: ['/api/superadmin/:path*'],
};
