import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';

dotenv.config();

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const migrationsDirectory = path.resolve(currentDirectory, '../migrations');

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to prepare the database.');
  }

  return databaseUrl;
}

function getDatabaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name.');
  }

  return databaseName;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const databaseName = getDatabaseName(databaseUrl);

  if (databaseName === 'postgres') {
    return;
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });

  try {
    const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if (result.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      console.log(`Created PostgreSQL database ${databaseName}.`);
    }
  } finally {
    await adminPool.end();
  }
}

async function runMigrations(databaseUrl: string): Promise<void> {
  const migrated = await runner({
    databaseUrl,
    dir: migrationsDirectory,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    verbose: process.env.NODE_ENV !== 'production',
    log: (message: string) => console.log(message),
  });

  if (migrated.length > 0) {
    console.log(`Applied ${migrated.length} database migration(s).`);
  } else {
    console.log('No pending database migrations.');
  }
}

export async function prepareDatabase(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  await ensureDatabaseExists(databaseUrl);
  await runMigrations(databaseUrl);
}