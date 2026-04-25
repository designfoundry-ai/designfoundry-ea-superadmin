import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

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

  // Try to proxy to real backend first
  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

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
    // Backend unreachable — fall back to dev credentials in non-production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ message: 'Authentication service unavailable' }, { status: 503 });
    }

    if (email === DEV_CREDENTIALS.email && password === DEV_CREDENTIALS.password) {
      return NextResponse.json({
        token: 'dev-token-superadmin',
        user: DEV_USER,
      });
    }

    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }
}
