// DB-routing decision — pending schema-owner review.
//
// Current behavior: this writer targets the PLATFORM database (./db,
// resolved from DATABASE_URL || ADMIN_DATABASE_URL by lib/db.ts). The
// admin_audit_log table is created by lib/admin-db-init.ts in the same
// database the lib/admin-db.ts pool talks to. In single-database
// development the two pools are interchangeable, but in production
// CLAUDE.md positions ADMIN_DATABASE_URL as the home for super-admin
// operational data (super_admins, instances, license catalog, audit).
//
// Why this might be the wrong pool:
//   - admin_audit_log is created by admin-db-init alongside super_admins
//     + instances, suggesting intent for it to live in the admin DB.
//   - Tests in src/lib/__tests__/audit.test.ts pin the current platform-
//     DB routing; a swap would need those tests updated as part of the
//     migration.
//   - If the two DBs ever diverge (the multi-tenant production
//     direction), audit writes would silently target the platform DB
//     while reads against the admin DB would find nothing.
//
// TODO(schema-owner): confirm intended home for admin_audit_log. If it
// belongs in the admin DB:
//   1. Switch the import below to `pool from './admin-db'`.
//   2. Add a one-shot migration that copies any historical rows from
//      platform.admin_audit_log → admin.admin_audit_log.
//   3. Update the test in src/lib/__tests__/audit.test.ts to mock
//      @/lib/admin-db instead of @/lib/db.
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
