import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';
import { toLicFile } from '@/lib/license';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;

    const { rows } = await pool.query<{
      license_blob: string; customer_name: string;
    }>(
      `SELECT license_blob, customer_name FROM licenses WHERE id = $1 AND status != 'revoked'`,
      [id],
    );
    if (!rows[0]) return NextResponse.json({ message: 'License not found or revoked' }, { status: 404 });

    const licContent = toLicFile(rows[0].license_blob);
    const filename = `${rows[0].customer_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.lic`;

    return new NextResponse(licContent, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(Buffer.byteLength(licContent, 'utf8')),
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[license download]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
