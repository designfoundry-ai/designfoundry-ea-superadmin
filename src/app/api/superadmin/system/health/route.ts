import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const services = [];

    // DB health check
    const dbStart = Date.now();
    try {
      await pool.query('SELECT 1');
      services.push({ name: 'PostgreSQL', status: 'healthy', uptime: '—', latencyMs: Date.now() - dbStart });
    } catch {
      services.push({ name: 'PostgreSQL', status: 'down', uptime: '—', latencyMs: -1 });
    }

    // Admin app itself
    services.push({ name: 'Admin App', status: 'healthy', uptime: '—', latencyMs: 0 });

    // Main app health probe
    const mainAppUrl = process.env.MAIN_APP_URL ?? 'http://localhost:3001';
    const apiStart = Date.now();
    try {
      const res = await fetch(`${mainAppUrl}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
      services.push({
        name: 'API Server',
        status: res.ok ? 'healthy' : 'degraded',
        uptime: '—',
        latencyMs: Date.now() - apiStart,
      });
    } catch {
      services.push({ name: 'API Server', status: 'down', uptime: '—', latencyMs: -1 });
    }

    // DB connection pool stats
    const poolStats = {
      current: pool.totalCount,
      max: pool.options.max ?? 10,
    };

    const metrics = {
      apiErrorRate: 0,
      apiRequestsPerMin: 0,
      dbConnections: poolStats,
      redisMemory: { used: 0, max: 256 },
      diskUsage: { used: 0, max: 500 },
    };

    return NextResponse.json({ services, metrics });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[system health]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
