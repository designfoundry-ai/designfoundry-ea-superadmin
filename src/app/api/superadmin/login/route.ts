import { NextRequest, NextResponse } from 'next/server';
import { signAdminToken } from '@/lib/auth';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const IS_DEV = process.env.NODE_ENV !== 'production';

const DEV_CREDENTIALS = {
  email: 'super@designfoundry.app',
  password: 'superadmin123',
};

const DEV_USER = {
  id: 'dev-superadmin-1',
  email: 'super@designfoundry.app',
  name: 'Super Admin',
  role: 'superadmin',
};

function devSuccessResponse() {
  // Issue a real JWT so subsequent /api/superadmin/* requests pass
  // requireAdmin() (which verifies via jsonwebtoken).
  const token = signAdminToken({ id: DEV_USER.id, email: DEV_USER.email });
  return NextResponse.json({
    token,
    user: DEV_USER,
  });
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password are required' }, { status: 400 });
  }

  // In dev, accept the dev credentials before trying the backend.
  // Without this, a reachable backend that doesn't know these creds
  // would return 401 and block local development.
  if (IS_DEV && email === DEV_CREDENTIALS.email && password === DEV_CREDENTIALS.password) {
    return devSuccessResponse();
  }

  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    let data: { message?: string; user?: { role?: string }; token?: string } = {};
    try {
      data = await res.json();
    } catch {
      // Non-JSON response — treat as failure and fall through to error path below.
    }

    if (!res.ok) {
      return NextResponse.json(
        { message: data.message || 'Login failed' },
        { status: res.status }
      );
    }

    if (data.user?.role !== 'superadmin') {
      return NextResponse.json(
        { message: 'Access denied. Super admin role required.' },
        { status: 403 }
      );
    }

    return NextResponse.json(data);
  } catch {
    if (IS_DEV) {
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }
    return NextResponse.json({ message: 'Authentication service unavailable' }, { status: 503 });
  }
}
