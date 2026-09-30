/**
 * Set Tas Hair's per-tenant email settings (white-label sender + contact details).
 *
 * Sets the branding/contact fields now. `from_email` is intentionally left unset
 * until Tas Hair has a domain verified in SES — until then the platform default
 * sender is used, but the display name still reads "Tas Hair & Beauty Cafe".
 *
 * Usage: npx ts-node scripts/set-tas-email-settings.ts
 */

import { Pool } from 'pg';

const EMAIL_SETTINGS = {
  from_name: 'Tas Hair & Beauty Cafe',
  business_address: '271/206 Block IA, Soshanguve',
  business_phone: '078 878 2527',
  show_platform_footer: true,
  // from_email / reply_to: set these once tashair's domain is verified in SES.
};

async function run() {
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
    const tenant = await client.query(`SELECT id FROM tenants WHERE slug = 'tas-hair'`);
    if (tenant.rows.length === 0) throw new Error('Tas Hair tenant not found');
    const tenantId = tenant.rows[0].id;

    // Merge the email object into settings (top-level shallow merge is fine here
    // because we set the whole `email` sub-object at once).
    await client.query(
      `UPDATE tenants SET settings = settings || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ email: EMAIL_SETTINGS }), tenantId]
    );

    const updated = await client.query(`SELECT settings->'email' AS email FROM tenants WHERE id = $1`, [tenantId]);
    console.log('✓ Tas Hair email settings set:');
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
