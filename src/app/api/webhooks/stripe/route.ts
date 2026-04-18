import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { signLicense, planDefaults } from '@/lib/license';

// Stripe webhook — public endpoint, verified via stripe-signature header
// No admin JWT required; Stripe signature is the auth mechanism.
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature') ?? '';
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

    // Verify Stripe signature when secret is configured
    if (webhookSecret && webhookSecret !== 'whsec_placeholder') {
      const verified = await verifyStripeSignature(body, signature, webhookSecret);
      if (!verified) {
        return NextResponse.json({ message: 'Invalid signature' }, { status: 400 });
      }
    }

    const event = JSON.parse(body) as StripeEvent;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object as StripeSubscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object as StripeSubscription);
        break;

      case 'invoice.payment_succeeded':
        await logPlatformEvent('PAYMENT_SUCCEEDED', event.data.object);
        break;

      case 'invoice.payment_failed':
        await logPlatformEvent('BILLING_PAYMENT_FAILED', event.data.object);
        break;

      default:
        // Unhandled event — acknowledge receipt
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook]', err);
    return NextResponse.json({ message: 'Webhook processing failed' }, { status: 500 });
  }
}

async function handleSubscriptionChange(subscription: StripeSubscription) {
  const stripeCustomerId = subscription.customer as string;
  const status = subscription.status; // active, trialing, past_due, canceled
  const planNickname = subscription.items?.data?.[0]?.price?.nickname ?? 'team';

  // Map Stripe status to our tenant status
  const tenantStatus = status === 'active' ? 'active'
    : status === 'trialing' ? 'trial'
    : status === 'past_due' ? 'active'   // keep active but note past_due
    : 'suspended';

  const { rows: tenantRows } = await pool.query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM tenants WHERE stripe_customer_id = $1 OR id::text = $1 LIMIT 1`,
    [stripeCustomerId],
  );
  if (!tenantRows[0]) return; // Unknown customer

  const tenant = tenantRows[0];

  // Update tenant status and plan
  const plan = mapStripePlanToTier(planNickname);
  await pool.query(
    `UPDATE tenants SET status = $1, plan = $2 WHERE id = $3`,
    [tenantStatus, plan, tenant.id],
  );

  // Auto-generate / refresh license
  const defaults = planDefaults(plan);
  const expiresAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : undefined;

  const licenseJwt = signLicense({
    customerId: tenant.id,
    customerName: tenant.name,
    plan,
    maxUsers: defaults.maxUsers,
    maxObjects: defaults.maxObjects,
    features: defaults.features,
    addons: [],
    deliveryModel: 'saas',
  }, expiresAt);

  const payload = JSON.parse(
    Buffer.from(licenseJwt.split('.')[1], 'base64url').toString(),
  ) as { jti: string };

  // Upsert license record
  await pool.query(
    `INSERT INTO licenses
       (license_id, tenant_id, customer_name, contact_email, delivery_model,
        plan, addons, features, max_users, max_objects, issued_at, expires_at,
        license_blob, key_id, status)
     VALUES ($1, $2, $3, $4, 'saas', $5, '[]', $6::jsonb, $7, $8, NOW(), $9, $10, $11, 'active')
     ON CONFLICT (license_id) DO UPDATE
       SET license_blob = EXCLUDED.license_blob,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
    [
      payload.jti, tenant.id, tenant.name, '',
      plan, JSON.stringify(defaults.features),
      defaults.maxUsers, defaults.maxObjects,
      expiresAt ?? null, licenseJwt,
      process.env.LICENSE_KEY_ID ?? 'dev-2026-01',
    ],
  );

  await pool.query(
    `UPDATE tenants SET license_blob = $1, license_updated = NOW() WHERE id = $2`,
    [licenseJwt, tenant.id],
  );

  await logPlatformEvent('LICENSE_GENERATED', {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    plan,
    source: 'stripe_webhook',
  });
}

async function handleSubscriptionCanceled(subscription: StripeSubscription) {
  const stripeCustomerId = subscription.customer as string;
  await pool.query(
    `UPDATE tenants SET status = 'cancelled', is_active = false
     WHERE stripe_customer_id = $1 OR id::text = $1`,
    [stripeCustomerId],
  );
}

async function logPlatformEvent(eventType: string, details: unknown) {
  try {
    await pool.query(
      `INSERT INTO platform_activity_log (event_type, severity, details, created_at)
       VALUES ($1, 'INFO', $2::jsonb, NOW())`,
      [eventType, JSON.stringify(details)],
    );
  } catch { /* non-fatal */ }
}

function mapStripePlanToTier(nickname: string): string {
  const n = nickname.toLowerCase();
  if (n.includes('enterprise')) return 'enterprise';
  if (n.includes('professional') || n.includes('pro')) return 'professional';
  if (n.includes('team')) return 'team';
  return 'free';
}

async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  // Stripe signature format: t=timestamp,v1=hash,...
  const parts = Object.fromEntries(
    signature.split(',').map(p => p.split('=')).filter(p => p.length === 2) as [string, string][],
  );
  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${body}`;
  const { createHmac } = await import('crypto');
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  // Timing-safe compare
  if (expected.length !== v1.length) return false;
  const { timingSafeEqual } = await import('crypto');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
}

// Minimal Stripe type shims
interface StripeEvent {
  type: string;
  data: { object: unknown };
}

interface StripeSubscription {
  customer: string;
  status: string;
  current_period_end?: number;
  items?: { data: Array<{ price?: { nickname?: string } }> };
}
