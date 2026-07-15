import { Pool } from 'pg';

async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: 5432,
    database: 'bookings',
    user: 'bookings_admin',
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  const result = await pool.query("DELETE FROM customers WHERE email = 'rontsotetsi@gmail.com'");
  console.log('Deleted', result.rowCount, 'customer row(s)');
  await pool.end();
}

run();
