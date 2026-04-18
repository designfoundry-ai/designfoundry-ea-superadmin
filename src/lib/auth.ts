import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-change-in-prod';

export interface AdminUser {
  id: string;
  email: string;
}

export function signAdminToken(user: AdminUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: 'superadmin' },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

export function verifyAdminToken(token: string): AdminUser {
  const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
  return { id: payload.sub, email: payload.email };
}

export function getAdminFromRequest(request: NextRequest): AdminUser | null {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return verifyAdminToken(auth.slice(7));
  } catch {
    return null;
  }
}

export function requireAdmin(request: NextRequest): AdminUser {
  const admin = getAdminFromRequest(request);
  if (!admin) throw new AuthError('Unauthorized');
  return admin;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}
