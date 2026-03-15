import { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS production_records (
      id VARCHAR(255) PRIMARY KEY,
      timestamp BIGINT NOT NULL,
      date VARCHAR(255) NOT NULL,
      machine VARCHAR(255) NOT NULL,
      meters INTEGER NOT NULL,
      changesCount INTEGER NOT NULL,
      changesComment TEXT,
      shift VARCHAR(255) NOT NULL,
      boss VARCHAR(255) NOT NULL,
      operator VARCHAR(255)
    );

    CREATE TABLE IF NOT EXISTS custom_comments (
      name VARCHAR(255) PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS custom_operators (
      name VARCHAR(255) PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      operator_code VARCHAR(255) UNIQUE NOT NULL,
      pin_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      failed_attempts INTEGER DEFAULT 0,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      module VARCHAR(255) NOT NULL,
      action VARCHAR(255) NOT NULL,
      UNIQUE(user_id, module, action)
    );

    CREATE TABLE IF NOT EXISTS user_visibility (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      observer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      target_id UUID REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(observer_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(255) NOT NULL,
      details JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS user_visibility;
    DROP TABLE IF EXISTS permissions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS custom_operators;
    DROP TABLE IF EXISTS custom_comments;
    DROP TABLE IF EXISTS production_records;
  `);
}