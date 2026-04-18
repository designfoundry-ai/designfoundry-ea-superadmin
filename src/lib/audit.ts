import pool from './db';

export async function logAudit(
  adminUserId: string,
  adminEmail: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> | null,
  ipAddress: string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log
         (admin_user_id, admin_email, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [adminUserId, adminEmail, action, targetType, targetId,
       details ? JSON.stringify(details) : null, ipAddress],
    );
  } catch {
    // Non-fatal — never let audit failure break the main operation
  }
}
