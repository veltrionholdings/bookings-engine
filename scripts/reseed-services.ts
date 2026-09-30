/**
 * Reseed the Tas Hair service menu from the client's official price list.
 *
 * What it does (in one transaction):
 *  1. Looks up the Tas Hair tenant, the "Stylist" resource type, and the "Tas"
 *     resource — all by name, so it works against the live DB without hardcoded IDs.
 *  2. DEACTIVATES all existing services for the tenant (is_active = false).
 *     We deactivate rather than delete so existing bookings keep their history
 *     (bookings.service_id is ON DELETE CASCADE — a hard delete would wipe them).
 *  3. Inserts the 29 services from the price list, each with:
 *       - duration_minutes: 60 (default — the admin can tune per service later)
 *       - price_cents / currency ZAR
 *       - metadata.category (Relaxer / Treatment / Wig / Cut)
 *     Re-running is safe: a service matched by (tenant, name) is updated
 *     (price/category/duration refreshed and re-activated) instead of duplicated.
 *  4. Links every active service to Tas (resource_service_links) so they're bookable.
 *
 * Usage: npx ts-node scripts/reseed-services.ts
 */

import { Pool } from 'pg';

interface SeedService {
  name: string;
  category: 'Relaxer' | 'Treatment' | 'Wig' | 'Cut';
  price: number; // Rand
}

const DEFAULT_DURATION_MIN = 60;
const DEFAULT_BUFFER_MIN = 0;

// From the client's "Service Price" list.
const SERVICES: SeedService[] = [
  // ─── Relaxer ───────────────────────────────────────────────────────────────
  { name: 'Mizani', category: 'Relaxer', price: 500 },
  { name: 'Design Essentials', category: 'Relaxer', price: 450 },
  { name: 'Kids Relaxer', category: 'Relaxer', price: 400 },
  { name: 'Relax / Cut', category: 'Relaxer', price: 600 },
  { name: 'Relax & Dry Curl', category: 'Relaxer', price: 650 },
  { name: 'Relax & Finger Wave', category: 'Relaxer', price: 550 },
  { name: 'Relax / Cut / Style Pixie', category: 'Relaxer', price: 750 },
  { name: 'Relax / Cut / Dye / Style Pixie', category: 'Relaxer', price: 850 },
  { name: 'Relax / Cut / Style Pixie with Hair Piece', category: 'Relaxer', price: 950 },
  { name: 'Relax / Style / Bobcut with Hair Piece', category: 'Relaxer', price: 1300 },
  { name: 'Relax / Cut / Style Pixie with Micro Rings Extensions', category: 'Relaxer', price: 1400 },
  { name: 'Relax / Style / Bobcut with Micro Rings Extensions', category: 'Relaxer', price: 1800 },

  // ─── Treatment ───────────────────────────────────────────────────────────────
  { name: 'Scalp Treatment', category: 'Treatment', price: 300 },
  { name: 'Treatment & Style', category: 'Treatment', price: 450 },
  { name: 'Treatment / Cut & Style', category: 'Treatment', price: 500 },
  { name: 'Treatment & Dry Curl', category: 'Treatment', price: 550 },
  { name: 'Treatment & Finger Wave', category: 'Treatment', price: 450 },
  { name: 'Silky Press Natural Hair', category: 'Treatment', price: 600 },
  { name: 'Treatment Natural Hair Style', category: 'Treatment', price: 450 },
  { name: 'Treatment Natural Hair & Dry Curl', category: 'Treatment', price: 600 },

  // ─── Wig ───────────────────────────────────────────────────────────────────
  { name: 'Wig Treatment', category: 'Wig', price: 450 },
  { name: 'Wig Made', category: 'Wig', price: 550 },
  { name: 'Wig Colour (from)', category: 'Wig', price: 350 },

  // ─── Cut ───────────────────────────────────────────────────────────────────
  { name: 'Haircut', category: 'Cut', price: 170 },
  { name: 'Cut & Colour', category: 'Cut', price: 280 },
  { name: 'Cut & Textureized', category: 'Cut', price: 400 },
  { name: 'Cut Textureized & Colour', category: 'Cut', price: 550 },
  { name: 'Dye', category: 'Cut', price: 300 },
  { name: 'Cut & Platinum Blonde', category: 'Cut', price: 450 },
  { name: 'Cut & Grey Colour', category: 'Cut', price: 450 },
];

async function reseed() {
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
    console.log('💇 Reseeding Tas Hair services...\n');
    await client.query('BEGIN');

    // ─── Look up tenant / resource type / stylist by name ─────────────────────
    const tenantRes = await client.query(
      `SELECT id FROM tenants WHERE slug = 'tas-hair'`
    );
    if (tenantRes.rows.length === 0) throw new Error('Tas Hair tenant not found (slug tas-hair)');
    const tenantId = tenantRes.rows[0].id;
    console.log(`✓ Tenant: ${tenantId}`);

    const typeRes = await client.query(
      `SELECT id FROM resource_types WHERE tenant_id = $1 AND name = 'Stylist'`,
      [tenantId]
    );
    if (typeRes.rows.length === 0) throw new Error('Stylist resource type not found');
    const stylistTypeId = typeRes.rows[0].id;
    console.log(`✓ Resource type (Stylist): ${stylistTypeId}`);

    const tasRes = await client.query(
      `SELECT id FROM resources WHERE tenant_id = $1 AND name = 'Tas'`,
      [tenantId]
    );
    if (tasRes.rows.length === 0) throw new Error('Resource "Tas" not found');
    const tasId = tasRes.rows[0].id;
    console.log(`✓ Resource (Tas): ${tasId}\n`);

    // ─── Deactivate all existing services (preserve booking history) ──────────
    const deactivated = await client.query(
      `UPDATE services SET is_active = false WHERE tenant_id = $1 AND is_active = true`,
      [tenantId]
    );
    console.log(`✓ Deactivated ${deactivated.rowCount} existing service(s)`);

    // ─── Upsert the new services ──────────────────────────────────────────────
    const serviceIds: string[] = [];
    for (const svc of SERVICES) {
      const priceCents = svc.price * 100;
      const metadata = JSON.stringify({ category: svc.category });

      // Match by (tenant, name). No unique constraint exists, so do it manually.
      const existing = await client.query(
        `SELECT id FROM services WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
        [tenantId, svc.name]
      );

      if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE services SET
             description = NULL,
             duration_minutes = $1,
             buffer_minutes = $2,
             capacity = 1,
             resource_type_id = $3,
             price_cents = $4,
             currency = 'ZAR',
             is_active = true,
             metadata = $5::jsonb
           WHERE id = $6`,
          [DEFAULT_DURATION_MIN, DEFAULT_BUFFER_MIN, stylistTypeId, priceCents, metadata, id]
        );
        serviceIds.push(id);
      } else {
        const inserted = await client.query(
          `INSERT INTO services
             (tenant_id, name, description, duration_minutes, buffer_minutes, capacity, resource_type_id, price_cents, currency, is_active, metadata)
           VALUES ($1, $2, NULL, $3, $4, 1, $5, $6, 'ZAR', true, $7::jsonb)
           RETURNING id`,
          [tenantId, svc.name, DEFAULT_DURATION_MIN, DEFAULT_BUFFER_MIN, stylistTypeId, priceCents, metadata]
        );
        serviceIds.push(inserted.rows[0].id);
      }
    }
    console.log(`✓ Upserted ${serviceIds.length} services`);

    // ─── Link every service to Tas so they're bookable ────────────────────────
    for (const serviceId of serviceIds) {
      await client.query(
        `INSERT INTO resource_service_links (resource_id, service_id)
         VALUES ($1, $2)
         ON CONFLICT (resource_id, service_id) DO NOTHING`,
        [tasId, serviceId]
      );
    }
    console.log(`✓ Linked all ${serviceIds.length} services to Tas`);

    await client.query('COMMIT');

    console.log('\n────────────────────────────────────────');
    console.log('🎉 Service reseed complete!');
    console.log(`   ${serviceIds.length} active services across 4 categories.`);
    console.log('   Old services were deactivated (not deleted).');
    console.log('────────────────────────────────────────\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Reseed failed (rolled back):', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

reseed();
