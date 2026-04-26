import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  supportUrl: string;
  defaultTenantPlan: 'free' | 'team';
  registrationEnabled: boolean;
  trialEnabled: boolean;
}

async function readSettings(): Promise<PlatformSettings> {
  const rows = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM platform_settings`,
  );
  const settings: Record<string, string> = {};
  for (const r of rows.rows) settings[r.key] = r.value;
  return {
    platformName: settings.platform_name ?? 'DesignFoundry',
    supportEmail: settings.support_email ?? '',
    supportUrl: settings.support_url ?? '',
    defaultTenantPlan: (settings.default_plan ?? 'free') as 'free' | 'team',
    registrationEnabled: settings.allow_public_registration !== 'false',
    trialEnabled: settings.trial_enabled !== 'false',
  };
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    return NextResponse.json(await readSettings());
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[settings GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const body = await req.json() as Record<string, unknown>;

    const keyMap: Record<string, string> = {
      platformName: 'platform_name',
      supportEmail: 'support_email',
      supportUrl: 'support_url',
      defaultTenantPlan: 'default_plan',
      registrationEnabled: 'allow_public_registration',
      trialEnabled: 'trial_enabled',
    };

    for (const [field, key] of Object.entries(keyMap)) {
      if (body[field] !== undefined) {
        await pool.query(
          `INSERT INTO platform_settings (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, String(body[field])],
        );
      }
    }

    await logAudit(admin.id, admin.email, 'SETTINGS_UPDATED', 'settings', null,
      body as Record<string, unknown>, getClientIp(req));

    return NextResponse.json(await readSettings());
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[settings PATCH]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
