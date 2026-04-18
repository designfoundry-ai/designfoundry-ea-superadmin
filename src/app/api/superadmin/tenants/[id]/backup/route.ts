import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    const { rows: tenantRows } = await pool.query<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM tenants WHERE id = $1`,
      [id],
    );
    const tenant = tenantRows[0];
    if (!tenant) return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });

    const schemaName = `t_${tenant.slug}`;

    // List all user-defined tables in this schema
    const { rows: tableRows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schemaName],
    );

    const lines: string[] = [
      `-- DesignFoundry tenant backup`,
      `-- Tenant: ${tenant.name} (${tenant.slug})`,
      `-- Exported: ${new Date().toISOString()}`,
      `-- Schema: ${schemaName}`,
      ``,
    ];

    for (const { table_name } of tableRows) {
      const qualifiedTable = `"${schemaName}"."${table_name}"`;

      // Get column names
      const { rows: colRows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schemaName, table_name],
      );
      const columns = colRows.map(c => c.column_name);

      // Export rows
      const { rows: dataRows } = await pool.query(`SELECT * FROM ${qualifiedTable}`);

      lines.push(`-- Table: ${table_name} (${dataRows.length} rows)`);

      if (dataRows.length === 0) {
        lines.push(`-- (empty)`);
        lines.push('');
        continue;
      }

      // CSV header
      lines.push(columns.map(escapeCsv).join(','));

      // CSV rows
      for (const row of dataRows) {
        lines.push(columns.map(col => escapeCsv(row[col] ?? '')).join(','));
      }
      lines.push('');
    }

    const csv = lines.join('\n');
    const filename = `backup_${tenant.slug}_${new Date().toISOString().replace(/[:.]/g, '-')}.sql.csv`;

    await logAudit(admin.id, admin.email, 'TENANT_BACKUP', 'tenant', id,
      { name: tenant.name, slug: tenant.slug, tables: tableRows.length }, getClientIp(req));

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant backup]', err);
    return NextResponse.json({ message: 'Backup failed' }, { status: 500 });
  }
}

function escapeCsv(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
