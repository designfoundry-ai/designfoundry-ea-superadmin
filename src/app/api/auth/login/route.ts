import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { signAdminToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json() as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json({ message: 'Email and password required' }, { status: 400 });
    }

    const { rows } = await pool.query<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM super_admins WHERE email = $1`,
      [email],
    );

    const admin = rows[0];
    if (!admin) {
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }

    const token = signAdminToken({ id: admin.id, email: admin.email });

    return NextResponse.json({
      token,
      user: { id: admin.id, email: admin.email, role: 'superadmin' },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
