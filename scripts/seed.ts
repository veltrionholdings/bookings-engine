/**
 * Seed script: Creates the Tas Hair & Beauty Cafe tenant with sample data.
 *
 * This sets up:
 * - Tenant (Tas Hair)
 * - Resource type (Stylist)
 * - Resource (Tas - the owner/stylist)
 * - Services (all the services they offer)
 * - Resource-service links
 * - Tas's weekly schedule (Mon-Sun 9:00-18:00)
 *
 * Usage: npx ts-node scripts/seed.ts
 */

import { Pool } from 'pg';

async function seed() {
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
    console.log('🌱 Seeding Tas Hair & Beauty Cafe...\n');

    await client.query('BEGIN');

    // ─── Tenant ──────────────────────────────────────────────────────────────
    const tenantResult = await client.query(`
      INSERT INTO tenants (name, slug, business_type, timezone, settings)
      VALUES (
        'Tas Hair & Beauty Cafe',
        'tas-hair',
        'salon',
        'Africa/Johannesburg',
        $1::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [JSON.stringify({
      booking: {
        default_status: 'confirmed',
        allow_past_bookings: false,
        min_advance_minutes: 60,
        max_advance_days: 90,
        cancellation_window_minutes: 1440,
        allow_customer_cancellation: true,
        overbooking_allowed: false,
      },
      availability: {
        slot_interval_minutes: 15,
        assignment_strategy: 'first_available',
      },
      notifications: {
        send_confirmation: true,
        send_reminder: true,
        reminder_hours_before: 24,
      },
    })]);

    const tenantId = tenantResult.rows[0].id;
    console.log(`✓ Tenant created: ${tenantId}`);

    // ─── Resource Type ───────────────────────────────────────────────────────
    const resourceTypeResult = await client.query(`
      INSERT INTO resource_types (tenant_id, name, description)
      VALUES ($1, 'Stylist', 'Hair stylists and beauty professionals')
      ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
      RETURNING id
    `, [tenantId]);

    const stylistTypeId = resourceTypeResult.rows[0].id;
    console.log(`✓ Resource type created: Stylist (${stylistTypeId})`);

    // ─── Resource (Tas) ──────────────────────────────────────────────────────
    const resourceResult = await client.query(`
      INSERT INTO resources (tenant_id, resource_type_id, name, description, metadata)
      VALUES ($1, $2, 'Tas', 'Senior Stylist & Owner', $3::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [tenantId, stylistTypeId, JSON.stringify({
      specialties: ['pixie cuts', 'platinum colour', 'microrings extensions'],
    })]);

    let tasId: string;
    if (resourceResult.rows.length > 0) {
      tasId = resourceResult.rows[0].id;
    } else {
      const existing = await client.query(
        `SELECT id FROM resources WHERE tenant_id = $1 AND name = 'Tas'`, [tenantId]
      );
      tasId = existing.rows[0].id;
    }
    console.log(`✓ Resource created: Tas (${tasId})`);

    // ─── Services ────────────────────────────────────────────────────────────
    const services = [
      { name: 'Pixie Cut', description: 'Precision short cut tailored to your face shape', duration: 45, buffer: 10, price: 25000 },
      { name: 'Bob Cut', description: 'Classic bob cut with clean lines and movement', duration: 60, buffer: 10, price: 30000 },
      { name: 'Platinum Colour', description: 'Full platinum blonde transformation', duration: 180, buffer: 15, price: 80000 },
      { name: 'Microrings Extensions', description: 'Seamless strand-by-strand extensions using micro rings', duration: 240, buffer: 15, price: 150000 },
      { name: 'Hair Colour (Standard)', description: 'Single process colour application', duration: 90, buffer: 15, price: 45000 },
      { name: 'Wash & Style', description: 'Shampoo, condition, and blow-dry styling', duration: 30, buffer: 5, price: 15000 },
      { name: 'Hair Treatment', description: 'Deep conditioning and repair treatment', duration: 45, buffer: 10, price: 20000 },
      { name: 'Cut & Colour Combo', description: 'Pixie or bob cut with full colour service', duration: 150, buffer: 15, price: 95000 },
    ];

    const serviceIds: string[] = [];
    for (const svc of services) {
      const result = await client.query(`
        INSERT INTO services (tenant_id, name, description, duration_minutes, buffer_minutes, capacity, resource_type_id, price_cents, currency)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'ZAR')
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [tenantId, svc.name, svc.description, svc.duration, svc.buffer, stylistTypeId, svc.price]);

      if (result.rows.length > 0) {
        serviceIds.push(result.rows[0].id);
      } else {
        const existing = await client.query(
          `SELECT id FROM services WHERE tenant_id = $1 AND name = $2`, [tenantId, svc.name]
        );
        serviceIds.push(existing.rows[0].id);
      }
    }
    console.log(`✓ ${services.length} services created`);

    // ─── Resource-Service Links ──────────────────────────────────────────────
    for (const serviceId of serviceIds) {
      await client.query(`
        INSERT INTO resource_service_links (resource_id, service_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [tasId, serviceId]);
    }
    console.log(`✓ Tas linked to all ${serviceIds.length} services`);

    // ─── Schedule (Mon-Sun 9:00-18:00) ───────────────────────────────────────
    await client.query(`DELETE FROM resource_schedules WHERE resource_id = $1`, [tasId]);
    for (let day = 0; day <= 6; day++) {
      await client.query(`
        INSERT INTO resource_schedules (resource_id, day_of_week, start_time, end_time)
        VALUES ($1, $2, '09:00', '18:00')
      `, [tasId, day]);
    }
    console.log(`✓ Schedule set: Mon-Sun 9:00-18:00`);

    // ─── Sample Customer ─────────────────────────────────────────────────────
    const customerResult = await client.query(`
      INSERT INTO customers (tenant_id, first_name, last_name, email, phone)
      VALUES ($1, 'Thandi', 'Mokoena', 'thandi@example.com', '+27821234567')
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [tenantId]);

    if (customerResult.rows.length > 0) {
      console.log(`✓ Sample customer created: Thandi Mokoena (${customerResult.rows[0].id})`);
    }

    await client.query('COMMIT');

    console.log('\n────────────────────────────────────────');
    console.log('🎉 Seed complete!\n');
    console.log(`Tenant ID: ${tenantId}`);
    console.log(`Stylist (Tas) ID: ${tasId}`);
    console.log(`Services: ${serviceIds.length} created`);
    console.log('────────────────────────────────────────\n');
    console.log('Save this Tenant ID — you need it for the Cognito user attribute.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
