import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    return NextResponse.json([]);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
