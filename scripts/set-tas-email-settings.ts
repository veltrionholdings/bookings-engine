/**
 * Set a tenant's per-tenant email settings (white-label sender + contact details).
 *
 * Values are read from environment variables so no tenant-specific or stopgap
 * values are committed to the repo. Any unset field is simply omitted, and the
 * email service falls back to the platform default for it.
 *
 * Usage (PowerShell example):
 *   $env:TENANT_SLUG          = 'tas-hair'
 *   $env:EMAIL_FROM_NAME      = 'Tas Hair & Beauty Cafe'
 *   $env:EMAIL_BUSINESS_ADDR  = '271/206 Block IA, Soshanguve'
 *   $env:EMAIL_BUSINESS_PHONE = '078 878 2527'
 *   $env:EMAIL_FROM           = 'bookings@tashair.co.za'   # must be verified in SES
 *   $env:EMAIL_REPLY_TO       = 'bookings@tashair.co.za'
 *   $env:EMAIL_LOGO_URL       = 'https://<app-domain>/logo-full.png'
 *   $env:EMAIL_SHOW_PLATFORM_FOOTER = 'true'
 *   npx ts-node scripts/set-tas-email-settings.ts
 *
 * (DB_* connection env vars are also required — see run-migration.ts.)
 */

import { Pool } from 'pg';

const TENANT_SLUG = process.env.TENANT_SLUG || 'tas-hair';

// Build the email settings object from env, omitting anything not provided.
const EMAIL_SETTINGS: Record<string, unknown> = {};
if (process.env.EMAIL_FROM_NAME) EMAIL_SETTINGS.from_name = process.env.EMAIL_FROM_NAME;
if (process.env.EMAIL_FROM) EMAIL_SETTINGS.from_email = process.env.EMAIL_FROM;
if (process.env.EMAIL_REPLY_TO) EMAIL_SETTINGS.reply_to = process.env.EMAIL_REPLY_TO;
if (process.env.EMAIL_BUSINESS_ADDR) EMAIL_SETTINGS.business_address = process.env.EMAIL_BUSINESS_ADDR;
if (process.env.EMAIL_BUSINESS_PHONE) EMAIL_SETTINGS.business_phone = process.env.EMAIL_BUSINESS_PHONE;
if (process.env.EMAIL_LOGO_URL) EMAIL_SETTINGS.logo_url = process.env.EMAIL_LOGO_URL;
if (process.env.EMAIL_SHOW_PLATFORM_FOOTER) {
  EMAIL_SETTINGS.show_platform_footer = process.env.EMAIL_SHOW_PLATFORM_FOOTER === 'true';
}

async function run() {
  if (Object.keys(EMAIL_SETTINGS).length === 0) {
    console.error('No EMAIL_* environment variables set — nothing to update.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    const tenant = await client.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
    if (tenant.rows.length === 0) throw new Error(`Tenant not found for slug: ${TENANT_SLUG}`);
    const tenantId = tenant.rows[0].id;

    // Shallow-merge the whole `email` sub-object into settings.
    await client.query(
      `UPDATE tenants SET settings = settings || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ email: EMAIL_SETTINGS }), tenantId]
    );

    const updated = await client.query(`SELECT settings->'email' AS email FROM tenants WHERE id = $1`, [tenantId]);
    console.log(`✓ Email settings updated for ${TENANT_SLUG}:`);
    console.log(JSON.stringify(updated.rows[0].email, null, 2));
  } catch (err) {
    console.error('Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
