import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    // Billing data comes from Stripe — return zeros until Stripe is wired up
    return NextResponse.json({
      activeMRR: 0,
      churnedMRR: 0,
      netNewMRR: 0,
      trialConversionRate: 0,
      arpu: 0,
      ltv: 0,
      mrrHistory: [],
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
