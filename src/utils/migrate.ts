/**
 * Database migration runner.
 * Reads SQL files from /migrations and executes them against the database.
 *
 * Usage: npx ts-node src/utils/migrate.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();

    const migrationsDir = path.resolve(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    console.log(`Found ${files.length} migration file(s)`);

    for (const file of files) {
      console.log(`Running: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`  ✓ ${file} completed`);
    }

    client.release();
    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
