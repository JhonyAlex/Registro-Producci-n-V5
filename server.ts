import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import http from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { buildRecordAuditSnapshot, getRecordAuditChangedFields } from './utils/auditLog';
import { isSessionTokenCurrent } from './utils/sessionAuth';

type AuthTokenPayload = {
  id: string;
  role: string;
  sv: number;
  iat?: number;
  exp?: number;
};

type RuntimeViteModule = {
  createServer: (config: {
    server: { middlewareMode: true };
    appType: string;
  }) => Promise<{ middlewares: unknown }>;
};

dotenv.config();

const app = express();
const PORT = 3000;
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

(app as any).use(cors());
(app as any).use(express.json({ limit: '50mb' }));
(app as any).use(cookieParser());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  if (next) {
    next();
  }
});

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pigmea',
  connectionTimeoutMillis: 3000, // Fail fast after 3 seconds if unreachable
});

let isDbConnected = false;

// Initialize Database Tables
async function initDB() {
  try {
    await pool.query('SELECT 1'); // Test connection
    await pool.query(`
      CREATE TABLE IF NOT EXISTS production_records (
        id VARCHAR(255) PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by_user_id UUID,
        last_modified_by_user_id UUID,
        date VARCHAR(255) NOT NULL,
        machine VARCHAR(255) NOT NULL,
        meters INTEGER NOT NULL,
        changesCount INTEGER NOT NULL,
        changesComment TEXT,
        shift VARCHAR(255) NOT NULL,
        boss VARCHAR(255) NOT NULL,
        boss_user_id UUID,
        operator VARCHAR(255),
        operator_user_id UUID,
        dynamic_fields_values JSONB NOT NULL DEFAULT '{}'::jsonb,
        schema_version_used INTEGER
      );

      CREATE TABLE IF NOT EXISTS machine_field_schemas (
        machine VARCHAR(255) PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1,
        fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_by_user_id UUID,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        session_version INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS role_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role VARCHAR(50) NOT NULL,
        permission_key VARCHAR(255) NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE(role, permission_key)
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

    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS created_by_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS last_modified_by_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS boss_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS operator_user_id UUID');
    await pool.query(`ALTER TABLE production_records
      ADD COLUMN IF NOT EXISTS dynamic_fields_values JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS schema_version_used INTEGER');
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'production_records' AND column_name = 'meters' AND data_type = 'integer'
        ) THEN
          ALTER TABLE production_records ALTER COLUMN meters TYPE BIGINT USING meters::bigint;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'production_records' AND column_name = 'changescount' AND data_type = 'integer'
        ) THEN
          ALTER TABLE production_records ALTER COLUMN changescount TYPE BIGINT USING changescount::bigint;
        END IF;
      END$$;
    `);

    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_production_records_machine ON production_records(machine)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_machine_field_schemas_updated_at ON machine_field_schemas(updated_at DESC)'
    );

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_records_created_by_user_id_fkey') THEN
          ALTER TABLE production_records
          ADD CONSTRAINT production_records_created_by_user_id_fkey
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_records_last_modified_by_user_id_fkey') THEN
          ALTER TABLE production_records
          ADD CONSTRAINT production_records_last_modified_by_user_id_fkey
          FOREIGN KEY (last_modified_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_records_boss_user_id_fkey') THEN
          ALTER TABLE production_records
          ADD CONSTRAINT production_records_boss_user_id_fkey
          FOREIGN KEY (boss_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_records_operator_user_id_fkey') THEN
          ALTER TABLE production_records
          ADD CONSTRAINT production_records_operator_user_id_fkey
          FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'machine_field_schemas_updated_by_user_id_fkey') THEN
          ALTER TABLE machine_field_schemas
          ADD CONSTRAINT machine_field_schemas_updated_by_user_id_fkey
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);
    await pool.query(`
      UPDATE production_records
      SET recorded_at = TO_TIMESTAMP(timestamp / 1000.0)
      WHERE recorded_at IS NULL
    `);

    await pool.query(`
      UPDATE production_records pr
      SET operator_user_id = u.id
      FROM users u
      WHERE pr.operator_user_id IS NULL
        AND pr.operator IS NOT NULL
        AND pr.operator = u.name
    `);

    await pool.query(`
      UPDATE production_records pr
      SET boss_user_id = u.id
      FROM users u
      WHERE pr.boss_user_id IS NULL
        AND pr.boss IS NOT NULL
        AND pr.boss = u.name
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS field_catalog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(100) NOT NULL UNIQUE,
        label VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        required BOOLEAN NOT NULL DEFAULT FALSE,
        display_order INTEGER,
        options JSONB NOT NULL DEFAULT '[]',
        default_value JSONB,
        rules JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by_user_id UUID
      )
    `);

    await pool.query('ALTER TABLE field_catalog ADD COLUMN IF NOT EXISTS display_order INTEGER');
    await pool.query(`
      WITH ordered AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY created_at ASC, label ASC, id ASC) - 1 AS normalized_order
        FROM field_catalog
      )
      UPDATE field_catalog fc
      SET display_order = ordered.normalized_order
      FROM ordered
      WHERE fc.id = ordered.id
        AND fc.display_order IS NULL
    `);
    await pool.query('ALTER TABLE field_catalog ALTER COLUMN display_order SET DEFAULT 0');
    await pool.query('UPDATE field_catalog SET display_order = 0 WHERE display_order IS NULL');
    await pool.query('ALTER TABLE field_catalog ALTER COLUMN display_order SET NOT NULL');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_field_catalog_display_order ON field_catalog(display_order)');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS field_catalog_assignments (
        field_id UUID NOT NULL,
        machine VARCHAR(50) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (field_id, machine)
      );

      CREATE TABLE IF NOT EXISTS dashboard_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_field VARCHAR(255) NOT NULL,
        related_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by_user_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_catalog_created_by_fkey') THEN
          ALTER TABLE field_catalog ADD CONSTRAINT field_catalog_created_by_fkey
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_catalog_assignments_field_id_fkey') THEN
          ALTER TABLE field_catalog_assignments ADD CONSTRAINT field_catalog_assignments_field_id_fkey
          FOREIGN KEY (field_id) REFERENCES field_catalog(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_configs_updated_by_user_id_fkey') THEN
          ALTER TABLE dashboard_configs ADD CONSTRAINT dashboard_configs_updated_by_user_id_fkey
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await pool.query('CREATE INDEX IF NOT EXISTS idx_dashboard_configs_default ON dashboard_configs(is_default DESC, updated_at DESC)');

    await pool.query(`
      DO $$
      BEGIN
        ALTER TABLE dashboard_configs ALTER COLUMN base_field DROP NOT NULL;
      EXCEPTION
        WHEN undefined_column THEN NULL;
      END $$;
    `);

    for (const role of APP_ROLES) {
      for (const key of PERMISSION_KEYS) {
        const allowed = DEFAULT_ROLE_PERMISSIONS[role].includes(key);
        await pool.query(
          `INSERT INTO role_permissions (role, permission_key, allowed)
           VALUES ($1, $2, $3)
           ON CONFLICT (role, permission_key) DO NOTHING`,
          [role, key, allowed]
        );
      }
    }

    console.log('Database tables initialized in PostgreSQL.');
    isDbConnected = true;
  } catch (err) {
    console.error('Failed to connect/init PostgreSQL. API will return 503 for database operations.');
    console.error(err);
    isDbConnected = false;
  }
}

// Middleware to check DB connection
const requireDB = (_req, res, next) => {
  if (!isDbConnected) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  next();
};

// API Routes

// --- AUTHENTICATION & AUTHORIZATION ---
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';
const SESSION_TIMEOUT_MINUTES = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30');
const MAX_FAILED_ATTEMPTS = 3;
const PIN_LENGTH = 4;

const APP_ROLES = ['admin', 'jefe_planta', 'jefe_turno', 'operario'] as const;
type AppRole = typeof APP_ROLES[number];
const USER_STATUSES = ['pending', 'active', 'locked'] as const;
type UserStatus = typeof USER_STATUSES[number];

const PERMISSION_KEYS = [
  'records.read',
  'records.write',
  'records.delete',
  'records.delete_all',
  'settings.read',
  'settings.manage',
  'settings.field_schemas',
  'settings.dashboards',
  'admin.users.read',
  'admin.users.create',
  'admin.users.approve',
  'admin.users.unlock',
  'admin.users.change_password',
  'admin.users.delete',
  'admin.audit.read',
  'backup.export',
  'backup.import'
] as const;

const DEFAULT_ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  admin: [...PERMISSION_KEYS],
  jefe_planta: [
    'records.read',
    'records.write',
    'records.delete',
    'records.delete_all',
    'settings.read',
    'settings.manage',
    'settings.field_schemas',
    'settings.dashboards',
    'admin.users.read',
    'admin.users.create',
    'admin.users.approve',
    'admin.users.unlock',
    'admin.users.change_password',
    'admin.audit.read',
    'backup.export',
    'backup.import'
  ],
  jefe_turno: ['records.read', 'records.write', 'settings.read'],
  operario: ['records.read', 'records.write', 'settings.read']
};

const normalizeOptionalString = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const isNumericOnly = (value: string): boolean => /^\d+$/.test(value);
const hasValidPinLength = (value: string): boolean => value.length === PIN_LENGTH;

const MACHINE_VALUES = ['WH1', 'Giave', 'WH3', 'NEXUS', 'SL2', '21', '22', 'S2DT', 'PROSLIT'] as const;
const SHIFT_VALUES = ['Mañana', 'Tarde', 'Noche'] as const;
const FIELD_TYPES = ['number', 'short_text', 'select', 'multi_select'] as const;
const CORE_FIELD_KEYS = new Set([
  'date',
  'machine',
  'shift',
  'boss',
  'operator',
  'meters',
  'changescount',
  'changescomment',
]);

type DynamicFieldType = typeof FIELD_TYPES[number];

const ensureCatalogFieldKeyAllowed = (rawKey: string) => {
  const normalized = String(rawKey || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('La clave técnica es obligatoria.');
  }
  if (CORE_FIELD_KEYS.has(normalized)) {
    throw new Error('La clave técnica coincide con un campo base del sistema. Usa una clave diferente.');
  }
};

const ensureCatalogFieldKeyIsUniqueCaseInsensitive = async (key: string, excludingId?: string) => {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;

  if (excludingId) {
    const duplicate = await pool.query(
      'SELECT id FROM field_catalog WHERE LOWER(key) = LOWER($1) AND id <> $2 LIMIT 1',
      [normalizedKey, excludingId]
    );
    if ((duplicate.rowCount || 0) > 0) {
      throw new Error('Ya existe un campo con esa clave técnica.');
    }
    return;
  }

  const duplicate = await pool.query(
    'SELECT id FROM field_catalog WHERE LOWER(key) = LOWER($1) LIMIT 1',
    [normalizedKey]
  );
  if ((duplicate.rowCount || 0) > 0) {
    throw new Error('Ya existe un campo con esa clave técnica.');
  }
};

const DASHBOARD_CHART_TYPES = ['bar', 'bar_horizontal', 'line', 'area', 'pie', 'combined_trend', 'segment_compare', 'kpi'] as const;
const DASHBOARD_AGGREGATIONS = ['count', 'sum', 'avg'] as const;

type DashboardChartType = typeof DASHBOARD_CHART_TYPES[number];
type DashboardAggregation = typeof DASHBOARD_AGGREGATIONS[number];

type DashboardWidgetConfig = {
  id: string;
  title: string;
  chartType: DashboardChartType;
  groupBy?: string;
  comparisonField?: string;
  comparisonValues?: string[];
  valueField: string;
  secondaryValueField?: string;
  aggregation: DashboardAggregation;
  spanColumns?: 1 | 2;
};

type DashboardConfigPayload = {
  name: string;
  description?: string | null;
  baseField?: string | null;
  relatedFields?: string[];
  widgets: DashboardWidgetConfig[];
  isDefault: boolean;
};

type MachineFieldDefinition = {
  key: string;
  label: string;
  type: DynamicFieldType;
  required: boolean;
  enabled: boolean;
  order: number;
  options?: string[];
  defaultValue?: string | number | string[];
  rules?: {
    min?: number;
    max?: number;
    maxLength?: number;
  };
};

const sanitizeMachineFieldDefinitions = (incomingFields: any): MachineFieldDefinition[] => {
  if (!Array.isArray(incomingFields)) {
    throw new Error('La definición de campos debe ser una lista.');
  }

  const seenKeys = new Set<string>();
  const sanitized = incomingFields.map((field: any, index: number) => {
    const key = String(field?.key || '').trim();
    const label = String(field?.label || '').trim();
    const type = String(field?.type || '').trim() as DynamicFieldType;
    const required = field?.required === true;
    const enabled = field?.enabled !== false;
    const order = Number.isFinite(Number(field?.order)) ? Number(field.order) : index;
    const rules: MachineFieldDefinition['rules'] = {};

    if (!key || !/^[a-zA-Z0-9_\-]+$/.test(key)) {
      throw new Error(`Clave de campo inválida: ${key || 'vacía'}`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`La clave de campo ${key} está duplicada.`);
    }
    seenKeys.add(key);

    if (!label) {
      throw new Error(`El campo ${key} requiere etiqueta.`);
    }
    if (!FIELD_TYPES.includes(type)) {
      throw new Error(`Tipo de campo inválido para ${key}.`);
    }

    if (field?.rules?.min !== undefined) {
      const min = Number(field.rules.min);
      if (!Number.isFinite(min)) throw new Error(`Regla min inválida para ${key}.`);
      rules.min = min;
    }
    if (field?.rules?.max !== undefined) {
      const max = Number(field.rules.max);
      if (!Number.isFinite(max)) throw new Error(`Regla max inválida para ${key}.`);
      rules.max = max;
    }
    if (rules.min !== undefined && rules.max !== undefined && rules.min > rules.max) {
      throw new Error(`La regla min no puede ser mayor que max en ${key}.`);
    }
    if (field?.rules?.maxLength !== undefined) {
      const maxLength = Number(field.rules.maxLength);
      if (!Number.isInteger(maxLength) || maxLength < 1) {
        throw new Error(`Regla maxLength inválida para ${key}.`);
      }
      rules.maxLength = maxLength;
    }

    const normalizedOptions = Array.isArray(field?.options)
      ? field.options
          .map((option: any) => String(option || '').trim())
          .filter((option: string) => option.length > 0)
      : [];

    if ((type === 'select' || type === 'multi_select') && normalizedOptions.length === 0) {
      throw new Error(`El campo ${key} requiere opciones.`);
    }

    const uniqueOptions: string[] = Array.from(new Set(normalizedOptions));
    const defaultValue = field?.defaultValue;

    if (defaultValue !== undefined && defaultValue !== null && defaultValue !== '') {
      if (type === 'number' && !Number.isFinite(Number(defaultValue))) {
        throw new Error(`El valor por defecto de ${key} debe ser numérico.`);
      }
      if (type === 'short_text' && typeof defaultValue !== 'string') {
        throw new Error(`El valor por defecto de ${key} debe ser texto.`);
      }
      if (type === 'select' && !uniqueOptions.includes(String(defaultValue))) {
        throw new Error(`El valor por defecto de ${key} debe existir en opciones.`);
      }
      if (type === 'multi_select') {
        if (!Array.isArray(defaultValue)) {
          throw new Error(`El valor por defecto de ${key} debe ser una lista.`);
        }
        const invalidDefault = defaultValue.find((value) => !uniqueOptions.includes(String(value)));
        if (invalidDefault) {
          throw new Error(`El valor ${invalidDefault} no es válido como default en ${key}.`);
        }
      }
    }

    return {
      key,
      label,
      type,
      required,
      enabled,
      order,
      options: uniqueOptions,
      defaultValue,
      rules,
    };
  });

  return sanitized.sort((a, b) => a.order - b.order);
};

const parseMachineSchema = (row: any): MachineFieldDefinition[] => {
  if (!row) return [];
  const raw = row.fields_json;
  if (!Array.isArray(raw)) return [];
  return sanitizeMachineFieldDefinitions(raw);
};

const computeSchemaVersionFromFields = (fields: MachineFieldDefinition[]): number => {
  const MAX_PG_INT = 2147483647;
  if (!Array.isArray(fields) || fields.length === 0) {
    return 1;
  }

  // Deterministic hash so clients can detect schema changes without relying on legacy table versions.
  const normalized = fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    enabled: field.enabled,
    order: field.order,
    options: field.options ?? [],
    defaultValue: field.defaultValue ?? null,
    rules: field.rules ?? {},
  }));

  const payload = JSON.stringify(normalized);
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash * 31) + payload.charCodeAt(i)) >>> 0;
  }

  const positiveInt32Hash = hash % MAX_PG_INT;
  return positiveInt32Hash === 0 ? 1 : positiveInt32Hash;
};

const getEffectiveMachineSchema = async (machine: string): Promise<{
  source: 'catalog' | 'legacy' | 'none';
  fields: MachineFieldDefinition[];
  version: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}> => {
  const catalogResult = await pool.query(
    `SELECT fc.key, fc.label, fc.type, fc.required, fca.enabled,
            fc.options, fc.default_value as "defaultValue", fc.rules,
            fc.display_order as "order", fc.updated_at as "updatedAt"
     FROM field_catalog_assignments fca
     JOIN field_catalog fc ON fc.id = fca.field_id
     WHERE fca.machine = $1
     ORDER BY fc.display_order ASC`,
    [machine]
  );

  if ((catalogResult.rowCount ?? 0) > 0) {
    const fields = sanitizeMachineFieldDefinitions(
      catalogResult.rows.map((row: any) => ({
        key: row.key,
        label: row.label,
        type: row.type,
        required: row.required,
        enabled: row.enabled,
        order: row.order,
        options: row.options ?? [],
        defaultValue: row.defaultValue ?? undefined,
        rules: row.rules ?? {},
      }))
    );

    const latestUpdatedAt = catalogResult.rows.reduce((latest: string | null, row: any) => {
      const current = row.updatedAt ? new Date(row.updatedAt).toISOString() : null;
      if (!current) return latest;
      if (!latest) return current;
      return current > latest ? current : latest;
    }, null as string | null);

    return {
      source: 'catalog',
      fields,
      version: computeSchemaVersionFromFields(fields),
      updatedByUserId: null,
      updatedAt: latestUpdatedAt,
    };
  }

  const legacyResult = await pool.query(
    `SELECT machine, schema_version as version, fields_json as fields,
            updated_by_user_id as "updatedByUserId", updated_at as "updatedAt"
     FROM machine_field_schemas
     WHERE machine = $1
     LIMIT 1`,
    [machine]
  );

  if (legacyResult.rowCount === 0) {
    return {
      source: 'none',
      fields: [],
      version: 1,
      updatedByUserId: null,
      updatedAt: null,
    };
  }

  const row = legacyResult.rows[0];
  const fields = parseMachineSchema({ fields_json: row.fields });
  return {
    source: 'legacy',
    fields,
    version: Number(row.version || 1),
    updatedByUserId: row.updatedByUserId || null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
};

type QueryExecutor = {
  query: (text: string, params?: any[]) => Promise<any>;
};

const normalizeFieldCatalogDisplayOrder = async (executor: QueryExecutor): Promise<void> => {
  await executor.query(`
    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (
               ORDER BY display_order ASC NULLS LAST, created_at ASC, id ASC
             ) - 1 AS normalized_order
      FROM field_catalog
    )
    UPDATE field_catalog fc
    SET display_order = ordered.normalized_order,
        updated_at = CASE
          WHEN fc.display_order IS DISTINCT FROM ordered.normalized_order THEN NOW()
          ELSE fc.updated_at
        END
    FROM ordered
    WHERE fc.id = ordered.id
  `);
};

const getOrderedFieldCatalogIds = async (executor: QueryExecutor): Promise<string[]> => {
  const result = await executor.query(
    `SELECT id
     FROM field_catalog
     ORDER BY display_order ASC, created_at ASC, id ASC`
  );
  return result.rows.map((row: any) => String(row.id));
};

const applyFieldCatalogDisplayOrder = async (executor: QueryExecutor, orderedIds: string[]): Promise<void> => {
  if (orderedIds.length === 0) {
    return;
  }

  const valuesSql = orderedIds
    .map((_, index) => `($${index + 1}::uuid, ${index})`)
    .join(', ');

  await executor.query(
    `UPDATE field_catalog fc
     SET display_order = incoming.display_order,
         updated_at = NOW()
     FROM (VALUES ${valuesSql}) AS incoming(id, display_order)
     WHERE fc.id = incoming.id`,
    orderedIds
  );
};

const migrateProductionRecordDynamicFieldKey = async (
  executor: QueryExecutor,
  previousKey: string,
  nextKey: string
): Promise<void> => {
  if (!previousKey || !nextKey || previousKey === nextKey) {
    return;
  }

  await executor.query(
    `UPDATE production_records
     SET dynamic_fields_values = CASE
       WHEN dynamic_fields_values ? $2 THEN dynamic_fields_values - $1
       ELSE (dynamic_fields_values - $1) || jsonb_build_object($2, dynamic_fields_values -> $1)
     END
     WHERE dynamic_fields_values ? $1`,
    [previousKey, nextKey]
  );
};

const remapDashboardDynamicFieldRef = (value: unknown, previousKey: string, nextKey: string) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value === `dynamic.${previousKey}` ? `dynamic.${nextKey}` : value;
};

const migrateDashboardConfigDynamicFieldKey = async (
  executor: QueryExecutor,
  previousKey: string,
  nextKey: string
): Promise<void> => {
  if (!previousKey || !nextKey || previousKey === nextKey) {
    return;
  }

  const configsResult = await executor.query(
    `SELECT id, base_field as "baseField", related_fields as "relatedFields", widgets
     FROM dashboard_configs`
  );

  for (const row of configsResult.rows) {
    let changed = false;
    const nextBaseField = remapDashboardDynamicFieldRef(row.baseField, previousKey, nextKey);
    if (nextBaseField !== row.baseField) {
      changed = true;
    }

    const sourceRelatedFields = Array.isArray(row.relatedFields) ? row.relatedFields : [];
    const nextRelatedFields = sourceRelatedFields.map((field) => {
      const remapped = remapDashboardDynamicFieldRef(field, previousKey, nextKey);
      if (remapped !== field) {
        changed = true;
      }
      return remapped;
    });

    const sourceWidgets = Array.isArray(row.widgets) ? row.widgets : [];
    const nextWidgets = sourceWidgets.map((widget: any) => {
      if (!widget || typeof widget !== 'object') {
        return widget;
      }

      const nextWidget = { ...widget };
      (['groupBy', 'comparisonField', 'valueField', 'secondaryValueField'] as const).forEach((fieldName) => {
        const remapped = remapDashboardDynamicFieldRef(nextWidget[fieldName], previousKey, nextKey);
        if (remapped !== nextWidget[fieldName]) {
          changed = true;
          nextWidget[fieldName] = remapped;
        }
      });

      return nextWidget;
    });

    if (!changed) {
      continue;
    }

    await executor.query(
      `UPDATE dashboard_configs
       SET base_field = $1,
           related_fields = $2::jsonb,
           widgets = $3::jsonb,
           updated_at = NOW()
       WHERE id = $4`,
      [
        typeof nextBaseField === 'string' ? nextBaseField : null,
        JSON.stringify(nextRelatedFields),
        JSON.stringify(nextWidgets),
        row.id,
      ]
    );
  }
};

const sanitizeDashboardConfigPayload = (incoming: any): DashboardConfigPayload => {
  const name = String(incoming?.name || '').trim();
  const baseField = normalizeOptionalString(incoming?.baseField);
  const description = normalizeOptionalString(incoming?.description);
  const isDefault = incoming?.isDefault === true;

  if (!name) {
    throw new Error('El nombre del dashboard es obligatorio.');
  }

  const relatedFields: string[] = Array.isArray(incoming?.relatedFields)
    ? Array.from(
        new Set<string>(
          incoming.relatedFields
            .map((field: any) => String(field || '').trim())
            .filter((field: string) => field.length > 0)
        )
      )
    : [];

  if (!Array.isArray(incoming?.widgets)) {
    throw new Error('La configuración requiere una lista de widgets.');
  }

  const widgets = incoming.widgets.map((widget: any, index: number) => {
    const id = String(widget?.id || '').trim() || `widget_${index + 1}`;
    const title = String(widget?.title || '').trim() || `Widget ${index + 1}`;
    const chartType = String(widget?.chartType || '').trim() as DashboardChartType;
    const groupBy = String(widget?.groupBy || '').trim() || undefined;
    const comparisonField = normalizeOptionalString(widget?.comparisonField) || undefined;
    const comparisonValues = Array.isArray(widget?.comparisonValues)
      ? Array.from(
          new Set(
            widget.comparisonValues
              .map((value: any) => String(value || '').trim())
              .filter((value: string) => value.length > 0)
          )
        ).slice(0, 30)
      : undefined;
    const valueField = String(widget?.valueField || '').trim();
    const secondaryValueField = normalizeOptionalString(widget?.secondaryValueField) || undefined;
    const aggregation = String(widget?.aggregation || 'count').trim() as DashboardAggregation;
    const spanColumns = Number(widget?.spanColumns) === 1 ? 1 : 2;

    if (!DASHBOARD_CHART_TYPES.includes(chartType)) {
      throw new Error(`Tipo de gráfico inválido en ${title}.`);
    }

    if (!valueField) {
      throw new Error(`El widget ${title} requiere un campo de valor.`);
    }

    if (!DASHBOARD_AGGREGATIONS.includes(aggregation)) {
      throw new Error(`Agregación inválida en ${title}.`);
    }

    if (chartType === 'combined_trend' && !secondaryValueField) {
      throw new Error(`El widget ${title} requiere un segundo campo para tendencia combinada.`);
    }

    if (chartType === 'segment_compare' && !comparisonField) {
      throw new Error(`El widget ${title} requiere un campo de serie/comparación.`);
    }

    return {
      id,
      title,
      chartType,
      groupBy,
      comparisonField,
      comparisonValues,
      valueField,
      secondaryValueField,
      aggregation,
      spanColumns,
    };
  });

  if (widgets.length === 0) {
    throw new Error('Debes configurar al menos un widget.');
  }

  return {
    name,
    description,
    baseField,
    relatedFields,
    widgets,
    isDefault,
  };
};

const validateDynamicFieldsAgainstSchema = (
  fields: MachineFieldDefinition[],
  dynamicFieldsValues: Record<string, unknown>
) => {
  const enabledFields = fields.filter((field) => field.enabled !== false);
  const byKey = new Map(enabledFields.map((field) => [field.key, field]));
  const sanitizedValues: Record<string, unknown> = {};

  for (const key of Object.keys(dynamicFieldsValues || {})) {
    if (!byKey.has(key)) {
      throw new Error(`El campo dinámico ${key} no existe en el esquema de la máquina.`);
    }
  }

  for (const field of enabledFields) {
    const incoming = dynamicFieldsValues?.[field.key];
    const hasValue = incoming !== undefined && incoming !== null && incoming !== '';
    const valueToValidate = hasValue ? incoming : field.defaultValue;

    if (field.required && (valueToValidate === undefined || valueToValidate === null || valueToValidate === '')) {
      throw new Error(`El campo ${field.label} es obligatorio.`);
    }

    if (valueToValidate === undefined || valueToValidate === null || valueToValidate === '') {
      continue;
    }

    if (field.type === 'number') {
      const numericValue = Number(valueToValidate);
      if (!Number.isFinite(numericValue)) {
        throw new Error(`El campo ${field.label} debe ser numérico.`);
      }
      if (field.rules?.min !== undefined && numericValue < field.rules.min) {
        throw new Error(`El campo ${field.label} no puede ser menor a ${field.rules.min}.`);
      }
      if (field.rules?.max !== undefined && numericValue > field.rules.max) {
        throw new Error(`El campo ${field.label} no puede ser mayor a ${field.rules.max}.`);
      }
      sanitizedValues[field.key] = numericValue;
      continue;
    }

    if (field.type === 'short_text') {
      const textValue = String(valueToValidate).trim();
      if (field.required && textValue.length === 0) {
        throw new Error(`El campo ${field.label} es obligatorio.`);
      }
      if (field.rules?.maxLength !== undefined && textValue.length > field.rules.maxLength) {
        throw new Error(`El campo ${field.label} supera el máximo de ${field.rules.maxLength} caracteres.`);
      }
      sanitizedValues[field.key] = textValue;
      continue;
    }

    const options = field.options || [];
    if (field.type === 'select') {
      const selected = String(valueToValidate);
      if (!options.includes(selected)) {
        throw new Error(`El valor de ${field.label} no está en las opciones permitidas.`);
      }
      sanitizedValues[field.key] = selected;
      continue;
    }

    if (field.type === 'multi_select') {
      if (!Array.isArray(valueToValidate)) {
        throw new Error(`El campo ${field.label} debe ser una lista.`);
      }
      const selectedValues = Array.from(new Set(valueToValidate.map((item) => String(item))));
      const invalid = selectedValues.find((value) => !options.includes(value));
      if (invalid) {
        throw new Error(`El valor ${invalid} no es válido para ${field.label}.`);
      }
      if (field.required && selectedValues.length === 0) {
        throw new Error(`El campo ${field.label} es obligatorio.`);
      }
      sanitizedValues[field.key] = selectedValues;
      continue;
    }
  }

  return sanitizedValues;
};

const updateUserDisplayNamesInRecords = async (userId: string, newName: string) => {
  await pool.query('UPDATE production_records SET operator = $1 WHERE operator_user_id = $2', [newName, userId]);
  await pool.query('UPDATE production_records SET boss = $1 WHERE boss_user_id = $2', [newName, userId]);
};

// Helper to log audit events
async function logAudit(userId: string | null, action: string, details: any, ipAddress: string | null = null) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [userId, action, JSON.stringify(details), ipAddress]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

const expireInactiveSessionOnce = async (userId: string, sessionVersion: number) => {
  const result = await pool.query(
    `UPDATE users
     SET session_version = session_version + 1
     WHERE id = $1
       AND session_version = $2
       AND last_activity < NOW() - ($3::int * INTERVAL '1 minute')
     RETURNING session_version`,
    [userId, sessionVersion, SESSION_TIMEOUT_MINUTES]
  );

  return result.rowCount > 0;
};

const getUserSocketRoom = (userId: string) => `user:${userId}`;

const parseCookieHeader = (cookieHeader?: string) => {
  if (!cookieHeader) return new Map<string, string>();

  return cookieHeader.split(';').reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) return cookies;
    cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
    return cookies;
  }, new Map<string, string>());
};

const getSocketAuthenticatedUser = async (cookieHeader?: string) => {
  const token = parseCookieHeader(cookieHeader).get('token');
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    const userResult = await pool.query('SELECT id, status, session_version FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];

    if (!user || user.status !== 'active' || !isSessionTokenCurrent(decoded.sv, user.session_version)) {
      return null;
    }

    return { id: user.id };
  } catch {
    return null;
  }
};

const notifySessionReplaced = (userId: string, sessionVersion: number) => {
  io.to(getUserSocketRoom(userId)).emit('session_replaced', { userId, sessionVersion });
};

// Middleware: Authenticate
export const authenticate = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];

    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (user.status === 'locked') return res.status(403).json({ error: 'Cuenta bloqueada. Contacte a un administrador.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Cuenta pendiente de aprobación.' });
    if (!isSessionTokenCurrent(decoded.sv, user.session_version)) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Sesión cerrada por un nuevo inicio de sesión', reason: 'session_replaced' });
    }

    // Check timeout
    const lastActivity = new Date(user.last_activity).getTime();
    const now = Date.now();
    if (now - lastActivity > SESSION_TIMEOUT_MINUTES * 60 * 1000) {
      const expiredNow = await expireInactiveSessionOnce(user.id, Number(user.session_version ?? 0));
      res.clearCookie('token');
      if (expiredNow) {
        await logAudit(
          user.id,
          'session_timeout',
          {
            reason: 'inactivity',
            last_activity_at: new Date(user.last_activity).toISOString()
          },
          req.ip || ''
        );
      }
      return res.status(401).json({ error: 'Sesión expirada por inactividad', reason: 'inactivity' });
    }

    // Update last activity
    await pool.query('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    
    (req as any).user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware: Require Role
export const requireRole = (roles: string[]) => {
  return (req, res, next) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
};

const splitPermissionKey = (permissionKey: string) => {
  const parts = permissionKey.split('.');
  return {
    module: parts.slice(0, -1).join('.') || 'general',
    action: parts[parts.length - 1] || 'access'
  };
};

const getRolePermissions = async (role: string) => {
  if (role === 'admin') return new Set<string>(PERMISSION_KEYS);

  const result = await pool.query(
    'SELECT permission_key FROM role_permissions WHERE role = $1 AND allowed = TRUE',
    [role]
  );

  return new Set<string>(result.rows.map((r: any) => r.permission_key));
};

export const requirePermission = (permissionKey: string) => {
  return async (req, res, next) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'No autorizado' });

    if (user.role === 'admin') {
      return next();
    }

    try {
      const result = await pool.query(
        `SELECT allowed
         FROM role_permissions
         WHERE role = $1 AND permission_key = $2
         LIMIT 1`,
        [user.role, permissionKey]
      );

      if (result.rows[0]?.allowed !== true) {
        return res.status(403).json({ error: 'Permiso denegado' });
      }

      next();
    } catch (err) {
      return res.status(500).json({ error: 'Error validando permisos' });
    }
  };
};

// Register
app.post('/api/auth/register', requireDB, async (req, res) => {
  const operatorCode = normalizeOptionalString(req.body?.operator_code);
  const pin = normalizeOptionalString(req.body?.pin);
  const name = normalizeOptionalString(req.body?.name);
  const role = normalizeOptionalString(req.body?.role);

  if (!operatorCode || !pin || !name || !role) return res.status(400).json({ error: 'Faltan datos' });
  if (!isNumericOnly(operatorCode)) return res.status(400).json({ error: 'El código de operario debe contener solo números' });
  if (!isNumericOnly(pin)) return res.status(400).json({ error: 'El PIN debe contener solo números' });
  if (!hasValidPinLength(pin)) return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });
  if (!APP_ROLES.includes(role as AppRole)) return res.status(400).json({ error: 'Rol inválido' });

  try {
    // Check if it's the first user
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const isFirstUser = parseInt(countResult.rows[0].count) === 0;

    const assignedRole = isFirstUser ? 'admin' : role;
    const assignedStatus = isFirstUser ? 'active' : 'pending';

    const pinHash = await bcrypt.hash(pin.toString(), 10);

    const result = await pool.query(
      `INSERT INTO users (operator_code, pin_hash, role, status, name) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, operator_code, role, status, name`,
      [operatorCode, pinHash, assignedRole, assignedStatus, name]
    );

    const newUser = result.rows[0];
    await logAudit(newUser.id, 'user_registered', { role: assignedRole, status: assignedStatus }, req.ip || '');

    if (!isFirstUser) {
      // Notify admins via WebSocket
      io.emit('new_pending_user', newUser);
    }

    res.json({ success: true, user: newUser });
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'El código de operario ya existe' });
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// Login
app.post('/api/auth/login', requireDB, async (req, res) => {
  const operatorCode = normalizeOptionalString(req.body?.operator_code);
  const pin = normalizeOptionalString(req.body?.pin);
  if (!operatorCode || !pin) return res.status(400).json({ error: 'Faltan credenciales' });
  if (!isNumericOnly(operatorCode)) return res.status(400).json({ error: 'El código de operario debe contener solo números' });
  if (!isNumericOnly(pin)) return res.status(400).json({ error: 'El PIN debe contener solo números' });
  if (!hasValidPinLength(pin)) return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE operator_code = $1', [operatorCode]);
    const user = result.rows[0];

    if (!user) {
      await logAudit(null, 'login_failed', { operator_code: operatorCode, reason: 'user_not_found' }, req.ip || '');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (user.status === 'locked') {
      await logAudit(user.id, 'login_failed', { reason: 'account_locked' }, req.ip || '');
      return res.status(403).json({ error: 'Cuenta bloqueada por múltiples intentos fallidos. Contacte a un administrador.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Su cuenta está pendiente de aprobación.' });
    }

    const isValidPin = await bcrypt.compare(pin.toString(), user.pin_hash);

    if (!isValidPin) {
      const newAttempts = user.failed_attempts + 1;
      let newStatus = user.status;
      
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        newStatus = 'locked';
        await logAudit(user.id, 'account_locked', { reason: 'max_failed_attempts' }, req.ip || '');
      }

      await pool.query('UPDATE users SET failed_attempts = $1, status = $2 WHERE id = $3', [newAttempts, newStatus, user.id]);
      await logAudit(user.id, 'login_failed', { reason: 'invalid_pin', attempts: newAttempts }, req.ip || '');
      
      return res.status(401).json({ error: newStatus === 'locked' ? 'Cuenta bloqueada por seguridad.' : 'PIN incorrecto.' });
    }

    // Success
    const updatedUserResult = await pool.query(
      `UPDATE users
       SET failed_attempts = 0,
           last_login = CURRENT_TIMESTAMP,
           last_activity = CURRENT_TIMESTAMP,
           session_version = session_version + 1
       WHERE id = $1
       RETURNING id, operator_code, name, role, session_version`,
      [user.id]
    );
    const updatedUser = updatedUserResult.rows[0];
    await logAudit(user.id, 'login_success', {}, req.ip || '');

    notifySessionReplaced(updatedUser.id, updatedUser.session_version);

    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role, sv: updatedUser.session_version },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    
    (res as any).cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    } as any);

    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        operator_code: updatedUser.operator_code,
        name: updatedUser.name,
        role: updatedUser.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error en el login' });
  }
});

// Logout (Cambio de Turno)
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const user = (req as any).user;
  await logAudit(user.id, 'logout', { reason: 'manual_shift_change' }, req.ip || '');
  res.clearCookie('token');
  res.json({ success: true });
});

// Get Current User (Me)
app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ authenticated: false, user: null });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];

    if (!user || user.status !== 'active' || !isSessionTokenCurrent(decoded.sv, user.session_version)) {
      res.clearCookie('token');
      return res.json({ authenticated: false, user: null });
    }

    await pool.query('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // Fetch permissions and visibility
    const rolePermissions = await getRolePermissions(user.role);
    const permissions = Array.from(rolePermissions).map((permissionKey) => {
      const parsed = splitPermissionKey(permissionKey);
      return {
        key: permissionKey,
        module: parsed.module,
        action: parsed.action
      };
    });
    const visResult = await pool.query('SELECT target_id FROM user_visibility WHERE observer_id = $1', [user.id]);

    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        operator_code: user.operator_code,
        name: user.name,
        role: user.role,
        permissions,
        visible_users: visResult.rows.map(r => r.target_id)
      }
    });
  } catch {
    res.clearCookie('token');
    return res.json({ authenticated: false, user: null });
  }
});

app.put('/api/auth/profile', authenticate, requireDB, async (req, res) => {
  const currentUser = (req as any).user;
  const operatorCode = normalizeOptionalString(req.body?.operator_code);
  const name = normalizeOptionalString(req.body?.name);
  const newPin = normalizeOptionalString(req.body?.pin);
  const currentPin = normalizeOptionalString(req.body?.current_pin);

  if (!operatorCode && !name && !newPin) {
    return res.status(400).json({ error: 'No hay cambios para guardar' });
  }

  if (operatorCode && !isNumericOnly(operatorCode)) {
    return res.status(400).json({ error: 'El código de operario debe contener solo números' });
  }

  if (newPin && !hasValidPinLength(newPin)) {
    return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });
  }

  if (newPin && !isNumericOnly(newPin)) {
    return res.status(400).json({ error: 'El PIN debe contener solo números' });
  }

  if (currentPin && !isNumericOnly(currentPin)) {
    return res.status(400).json({ error: 'El PIN actual debe contener solo números' });
  }

  if (newPin && !currentPin) {
    return res.status(400).json({ error: 'Debes ingresar tu PIN actual para cambiarlo' });
  }

  try {
    const latestResult = await pool.query('SELECT id, operator_code, name, pin_hash FROM users WHERE id = $1', [currentUser.id]);
    const latestUser = latestResult.rows[0];
    if (!latestUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (newPin) {
      const isCurrentPinValid = await bcrypt.compare(currentPin!, latestUser.pin_hash);
      if (!isCurrentPinValid) {
        return res.status(400).json({ error: 'El PIN actual no es correcto' });
      }
    }

    const finalOperatorCode = operatorCode || latestUser.operator_code;
    const finalName = name || latestUser.name;
    const finalPinHash = newPin ? await bcrypt.hash(newPin, 10) : latestUser.pin_hash;

    const result = await pool.query(
      `UPDATE users
       SET operator_code = $1,
           name = $2,
           pin_hash = $3
       WHERE id = $4
       RETURNING id, operator_code, name, role, status`,
      [finalOperatorCode, finalName, finalPinHash, currentUser.id]
    );

    if (name && name !== latestUser.name) {
      await updateUserDisplayNamesInRecords(currentUser.id, finalName);
      io.emit('records_changed');
    }

    await logAudit(currentUser.id, 'user_profile_updated', {
      target_user_id: currentUser.id,
      updated_fields: {
        operator_code: operatorCode ? true : false,
        name: name ? true : false,
        pin: newPin ? true : false
      }
    }, req.ip || '');

    io.emit('settings_changed');
    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El código de operario ya está en uso' });
    }
    res.status(500).json({ error: 'Error actualizando perfil' });
  }
});

app.put('/api/admin/users/:id/profile', authenticate, requireRole(['admin']), requireDB, async (req, res) => {
  const admin = (req as any).user;
  const targetUserId = String(req.params.id || '').trim();

  if (!targetUserId) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  const operatorCode = normalizeOptionalString(req.body?.operator_code);
  const name = normalizeOptionalString(req.body?.name);
  const newPin = normalizeOptionalString(req.body?.pin);
  const role = normalizeOptionalString(req.body?.role);
  const status = normalizeOptionalString(req.body?.status);

  if (!operatorCode && !name && !newPin && !role && !status) {
    return res.status(400).json({ error: 'No hay cambios para guardar' });
  }

  if (operatorCode && !isNumericOnly(operatorCode)) {
    return res.status(400).json({ error: 'El código de operario debe contener solo números' });
  }

  if (newPin && !hasValidPinLength(newPin)) {
    return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });
  }

  if (newPin && !isNumericOnly(newPin)) {
    return res.status(400).json({ error: 'El PIN debe contener solo números' });
  }

  if (role && !APP_ROLES.includes(role as AppRole)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  if (status && !USER_STATUSES.includes(status as UserStatus)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const targetResult = await pool.query('SELECT id, operator_code, name, role, status, pin_hash FROM users WHERE id = $1', [targetUserId]);
    const targetUser = targetResult.rows[0];
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    const nextRole = (role || targetUser.role) as AppRole;
    if (targetUser.role === 'admin' && nextRole !== 'admin') {
      const adminsCountResult = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'");
      const adminsCount = adminsCountResult.rows[0]?.total || 0;
      if (adminsCount <= 1) {
        return res.status(400).json({ error: 'No se puede quitar el rol al último administrador del sistema.' });
      }
    }

    const finalOperatorCode = operatorCode || targetUser.operator_code;
    const finalName = name || targetUser.name;
    const finalStatus = (status || targetUser.status) as UserStatus;
    const finalPinHash = newPin ? await bcrypt.hash(newPin, 10) : targetUser.pin_hash;

    const result = await pool.query(
      `UPDATE users
       SET operator_code = $1,
           name = $2,
           pin_hash = $3,
           role = $4,
           status = $5,
           failed_attempts = CASE WHEN $5 = 'active' THEN 0 ELSE failed_attempts END
       WHERE id = $6
       RETURNING id, operator_code, name, role, status`,
      [finalOperatorCode, finalName, finalPinHash, nextRole, finalStatus, targetUserId]
    );

    if (name && name !== targetUser.name) {
      await updateUserDisplayNamesInRecords(targetUserId, finalName);
      io.emit('records_changed');
    }

    await logAudit(admin.id, 'admin_user_profile_updated', {
      target_user_id: targetUserId,
      updated_fields: {
        operator_code: operatorCode ? true : false,
        name: name ? true : false,
        pin: newPin ? true : false,
        role: role ? true : false,
        status: status ? true : false
      }
    }, req.ip || '');

    io.emit('user_status_changed', { userId: targetUserId, status: finalStatus });
    io.emit('settings_changed');
    res.json({ success: true, user: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El código de operario ya está en uso' });
    }
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', authenticate, requirePermission('admin.users.read'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, operator_code, name, role, status, failed_attempts, created_at, last_login FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.post('/api/admin/users', authenticate, requirePermission('admin.users.create'), requireDB, async (req, res) => {
  const admin = (req as any).user;
  const operatorCode = normalizeOptionalString(req.body?.operator_code);
  const pin = normalizeOptionalString(req.body?.pin);
  const name = normalizeOptionalString(req.body?.name);
  const role = normalizeOptionalString(req.body?.role);

  if (!operatorCode || !pin || !name || !role) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  if (!isNumericOnly(operatorCode)) {
    return res.status(400).json({ error: 'El código de operario debe contener solo números' });
  }

  if (!isNumericOnly(pin)) {
    return res.status(400).json({ error: 'El PIN debe contener solo números' });
  }

  if (!hasValidPinLength(pin)) {
    return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });
  }

  if (!APP_ROLES.includes(role as AppRole)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  try {
    const pinHash = await bcrypt.hash(pin, 10);
    const result = await pool.query(
      `INSERT INTO users (operator_code, pin_hash, role, status, name)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id, operator_code, role, status, name`,
      [operatorCode, pinHash, role, name]
    );

    const newUser = result.rows[0];

    await logAudit(admin.id, 'admin_user_created', {
      target_user_id: newUser.id,
      target_operator_code: newUser.operator_code,
      target_name: newUser.name,
      target_role: newUser.role,
      target_status: newUser.status
    }, req.ip || '');

    io.emit('settings_changed');
    io.emit('user_status_changed', { userId: newUser.id, status: newUser.status });
    res.json({ success: true, user: newUser });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El código de operario ya existe' });
    }
    res.status(500).json({ error: 'Error creando usuario desde administración' });
  }
});

app.post('/api/admin/users/:id/approve', authenticate, requirePermission('admin.users.approve'), async (req, res) => {
  const admin = (req as any).user;
  const { id } = req.params;
  try {
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING id, operator_code, status', ['active', id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    await logAudit(admin.id, 'user_approved', { target_user_id: id }, req.ip || '');
    io.emit('user_status_changed', { userId: id, status: 'active' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error approving user' });
  }
});

app.post('/api/admin/users/:id/unlock', authenticate, requirePermission('admin.users.unlock'), async (req, res) => {
  const admin = (req as any).user;
  const { id } = req.params;
  try {
    const result = await pool.query('UPDATE users SET status = $1, failed_attempts = 0 WHERE id = $2 RETURNING id', ['active', id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    await logAudit(admin.id, 'user_unlocked', { target_user_id: id }, req.ip || '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error unlocking user' });
  }
});

app.delete('/api/admin/users/:id', authenticate, requireRole(['admin']), requirePermission('admin.users.delete'), async (req, res) => {
  const admin = (req as any).user;
  const { id } = req.params;

  try {
    if (admin.id === id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
    }

    const targetResult = await pool.query('SELECT id, operator_code, name, role, status FROM users WHERE id = $1', [id]);
    const targetUser = targetResult.rows[0];
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (targetUser.role === 'admin') {
      const adminsCountResult = await pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'");
      const adminsCount = adminsCountResult.rows[0]?.total || 0;
      if (adminsCount <= 1) {
        return res.status(400).json({ error: 'No se puede eliminar el último administrador del sistema.' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    await logAudit(admin.id, 'user_deleted', {
      target_user_id: targetUser.id,
      target_operator_code: targetUser.operator_code,
      target_name: targetUser.name,
      target_role: targetUser.role,
      target_status: targetUser.status
    }, req.ip || '');

    io.emit('user_deleted', { userId: id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting user' });
  }
});

app.patch('/api/admin/users/:id/password', authenticate, requirePermission('admin.users.change_password'), requireDB, async (req, res) => {
  const admin = (req as any).user;
  const targetUserId = String(req.params.id || '').trim();

  if (!targetUserId) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  const newPin = normalizeOptionalString(req.body?.pin);

  if (!newPin) {
    return res.status(400).json({ error: 'El nuevo PIN es obligatorio' });
  }

  if (!hasValidPinLength(newPin)) {
    return res.status(400).json({ error: 'El PIN debe tener 4 dígitos' });
  }

  if (!isNumericOnly(newPin)) {
    return res.status(400).json({ error: 'El PIN debe contener solo números' });
  }

  try {
    const targetResult = await pool.query('SELECT id, name FROM users WHERE id = $1', [targetUserId]);
    const targetUser = targetResult.rows[0];
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    const pinHash = await bcrypt.hash(newPin, 10);
    await pool.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [pinHash, targetUserId]);

    await logAudit(admin.id, 'admin_user_password_changed', {
      target_user_id: targetUserId,
      target_name: targetUser.name
    }, req.ip || '');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

app.get('/api/admin/audit-logs', authenticate, requirePermission('admin.audit.read'), async (req, res) => {
  const {
    q = '',
    action = '',
    userId = '',
    startDate = '',
    endDate = '',
    page = '1',
    pageSize = '25'
  } = req.query as Record<string, string>;

  const parsedPage = Math.max(parseInt(page || '1', 10) || 1, 1);
  const parsedPageSize = Math.min(Math.max(parseInt(pageSize || '25', 10) || 25, 1), 100);
  const offset = (parsedPage - 1) * parsedPageSize;

  const conditions: string[] = [];
  const params: any[] = [];

  if (action) {
    params.push(action);
    conditions.push(`a.action = $${params.length}`);
  }

  if (userId) {
    params.push(userId);
    conditions.push(`a.user_id = $${params.length}`);
  }

  if (startDate) {
    params.push(`${startDate} 00:00:00`);
    conditions.push(`a.created_at >= $${params.length}`);
  }

  if (endDate) {
    params.push(`${endDate} 23:59:59`);
    conditions.push(`a.created_at <= $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const termParam = `$${params.length}`;
    conditions.push(`(
      COALESCE(u.name, '') ILIKE ${termParam}
      OR COALESCE(u.operator_code, '') ILIKE ${termParam}
      OR a.action ILIKE ${termParam}
      OR COALESCE(a.details::text, '') ILIKE ${termParam}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereClause}`,
      params
    );

    const total = countResult.rows[0]?.total || 0;

    const logsResult = await pool.query(
      `SELECT
         a.id,
         a.user_id,
         a.action,
         a.details,
         a.created_at,
         u.name AS user_name,
         u.operator_code AS user_operator_code,
         u.role AS user_role
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parsedPageSize, offset]
    );

    const actionsResult = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
    const usersResult = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.operator_code, u.role
       FROM audit_logs a
       INNER JOIN users u ON u.id = a.user_id
       ORDER BY u.name ASC`
    );

    res.json({
      logs: logsResult.rows,
      total,
      page: parsedPage,
      pageSize: parsedPageSize,
      totalPages: Math.max(Math.ceil(total / parsedPageSize), 1),
      filters: {
        actions: actionsResult.rows.map((r: any) => r.action),
        users: usersResult.rows
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching audit logs' });
  }
});

app.get('/api/admin/role-permissions', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT role, permission_key, allowed FROM role_permissions ORDER BY role ASC, permission_key ASC'
    );

    const matrix: Record<string, Record<string, boolean>> = {};
    for (const role of APP_ROLES) {
      matrix[role] = {};
      for (const key of PERMISSION_KEYS) {
        matrix[role][key] = DEFAULT_ROLE_PERMISSIONS[role].includes(key);
      }
    }

    for (const row of result.rows) {
      if (!matrix[row.role]) continue;
      matrix[row.role][row.permission_key] = row.allowed === true;
    }

    res.json({
      roles: APP_ROLES,
      permissionKeys: PERMISSION_KEYS,
      matrix
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching role permissions' });
  }
});

app.put('/api/admin/role-permissions/:role', authenticate, requireRole(['admin']), async (req, res) => {
  const admin = (req as any).user;
  const role = req.params.role as AppRole;
  const incoming = req.body?.permissions as Record<string, boolean>;

  if (!APP_ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (role === 'admin') return res.status(400).json({ error: 'El rol admin no puede modificarse en esta matriz.' });
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Formato inválido de permisos' });

  try {
    await pool.query('BEGIN');
    for (const key of PERMISSION_KEYS) {
      await pool.query(
        `INSERT INTO role_permissions (role, permission_key, allowed)
         VALUES ($1, $2, $3)
         ON CONFLICT (role, permission_key)
         DO UPDATE SET allowed = EXCLUDED.allowed`,
        [role, key, incoming[key] === true]
      );
    }
    await pool.query('COMMIT');

    await logAudit(admin.id, 'role_permissions_updated', { role, permissions: incoming }, req.ip || '');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Error updating role permissions' });
  }
});

// --- RECORDS ---
app.get('/api/records', authenticate, requirePermission('records.read'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    let query = 'SELECT id, timestamp, recorded_at as "recordedAt", created_by_user_id as "createdByUserId", last_modified_by_user_id as "lastModifiedByUserId", date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, boss_user_id as "bossUserId", operator, operator_user_id as "operatorUserId", dynamic_fields_values as "dynamicFieldsValues", schema_version_used as "schemaVersionUsed" FROM production_records';
    let params: any[] = [];

    const canViewAllRecords = user.role === 'admin' || user.role === 'jefe_planta';

    if (!canViewAllRecords) {
      const visResult = await pool.query('SELECT target_id FROM user_visibility WHERE observer_id = $1', [user.id]);
      const visibleUserIds = [user.id, ...visResult.rows.map((r: any) => r.target_id)];
      
      const visibleUsersResult = await pool.query('SELECT name FROM users WHERE id = ANY($1)', [visibleUserIds]);
      const visibleNames = visibleUsersResult.rows.map((r: any) => r.name);

      query += ` WHERE (
        operator_user_id = ANY($1)
        OR created_by_user_id = ANY($1)
        OR (
          operator_user_id IS NULL
          AND created_by_user_id IS NULL
          AND operator = ANY($2)
        )
      )`;
      params.push(visibleUserIds);
      params.push(visibleNames);
    }

    query += ' ORDER BY timestamp DESC';

    const result = await pool.query(query, params);
    const rows = result.rows.map(row => ({
      ...row,
      timestamp: Number(row.timestamp)
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

app.post('/api/records', authenticate, requirePermission('records.write'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const {
    id,
    date,
    machine,
    meters,
    changesCount,
    changesComment,
    shift,
    boss,
    bossUserId,
    operator,
    operatorUserId,
    dynamicFieldsValues,
    schemaVersionUsed
  } = req.body;
  const persistedTimestamp = Date.now();
  try {
    const requestSchemaVersion = Number(schemaVersionUsed ?? 0);
    console.info('[records.save] incoming', {
      id,
      machine,
      requestSchemaVersion,
      persistedTimestamp,
      meters,
      changesCount,
    });

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'ID de registro inválido.' });
    }
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Fecha inválida.' });
    }
    if (!MACHINE_VALUES.includes(machine)) {
      return res.status(400).json({ error: 'Máquina inválida.' });
    }
    if (!SHIFT_VALUES.includes(shift)) {
      return res.status(400).json({ error: 'Turno inválido.' });
    }

    const normalizedMeters = Number(meters ?? 0);
    const normalizedChanges = Number(changesCount ?? 0);
    if (!Number.isFinite(normalizedMeters) || normalizedMeters < 0) {
      return res.status(400).json({ error: 'Metros inválidos.' });
    }
    if (!Number.isFinite(normalizedChanges) || normalizedChanges < 0) {
      return res.status(400).json({ error: 'Cantidad de cambios inválida.' });
    }

    const effectiveSchema = await getEffectiveMachineSchema(machine);
    const currentSchemaVersion = effectiveSchema.version;
    const schemaFields = effectiveSchema.fields;

    console.info('[records.save] schema-check', {
      id,
      machine,
      requestSchemaVersion,
      currentSchemaVersion,
      fieldCount: schemaFields.length,
    });

    if (schemaFields.length > 0 && requestSchemaVersion !== currentSchemaVersion) {
      return res.status(409).json({
        error: 'El formulario cambió. Recarga para usar la versión vigente.',
        code: 'SCHEMA_VERSION_MISMATCH',
        machine,
        currentSchemaVersion,
        receivedSchemaVersion: requestSchemaVersion,
      });
    }

    const validatedDynamicFields = validateDynamicFieldsAgainstSchema(
      schemaFields,
      dynamicFieldsValues && typeof dynamicFieldsValues === 'object' ? dynamicFieldsValues : {}
    );

    const existingRecordResult = await pool.query(
      `SELECT id, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, boss_user_id as "bossUserId", operator, operator_user_id as "operatorUserId", dynamic_fields_values as "dynamicFieldsValues", schema_version_used as "schemaVersionUsed"
       FROM production_records WHERE id = $1`,
      [id]
    );
    const existingRecord = existingRecordResult.rows[0] || null;

    const resolvedOperatorResult = operatorUserId
      ? await pool.query('SELECT id, name FROM users WHERE id = $1 LIMIT 1', [operatorUserId])
      : operator
        ? await pool.query('SELECT id, name FROM users WHERE name = $1 ORDER BY last_activity DESC NULLS LAST, created_at DESC LIMIT 1', [operator])
        : { rows: [] };

    const resolvedBossResult = bossUserId
      ? await pool.query('SELECT id, name FROM users WHERE id = $1 LIMIT 1', [bossUserId])
      : boss
        ? await pool.query('SELECT id, name FROM users WHERE name = $1 ORDER BY last_activity DESC NULLS LAST, created_at DESC LIMIT 1', [boss])
        : { rows: [] };

    const resolvedOperator = resolvedOperatorResult.rows[0] || null;
    const resolvedBoss = resolvedBossResult.rows[0] || null;

    const operatorName = resolvedOperator?.name || operator || '';
    const operatorId = resolvedOperator?.id || null;
    const bossName = resolvedBoss?.name || boss || '';
    const finalBossId = resolvedBoss?.id || null;
    const normalizedComment = normalizeOptionalString(changesComment) || '';

    const currentSnapshot = buildRecordAuditSnapshot({
      date,
      machine,
      shift,
      boss: bossName,
      bossUserId: finalBossId,
      operator: operatorName,
      operatorUserId: operatorId,
      meters: Math.round(normalizedMeters),
      changesCount: Math.round(normalizedChanges),
      changesComment: normalizedComment,
      dynamicFieldsValues: validatedDynamicFields,
      schemaVersionUsed: currentSchemaVersion
    });

    const beforeSnapshot = existingRecord
      ? buildRecordAuditSnapshot({
          date: existingRecord.date,
          machine: existingRecord.machine,
          shift: existingRecord.shift,
          boss: existingRecord.boss,
          bossUserId: existingRecord.bossUserId,
          operator: existingRecord.operator,
          operatorUserId: existingRecord.operatorUserId,
          meters: existingRecord.meters,
          changesCount: existingRecord.changesCount,
          changesComment: existingRecord.changesComment,
          dynamicFieldsValues: existingRecord.dynamicFieldsValues,
          schemaVersionUsed: existingRecord.schemaVersionUsed
        })
      : null;

    const changedFields = beforeSnapshot
      ? getRecordAuditChangedFields(beforeSnapshot, currentSnapshot)
      : [];

    if (beforeSnapshot && changedFields.length === 0) {
      return res.json({ success: true, skipped: true });
    }

    await pool.query(
      `INSERT INTO production_records (id, timestamp, recorded_at, created_by_user_id, last_modified_by_user_id, date, machine, meters, changesCount, changesComment, shift, boss, boss_user_id, operator, operator_user_id, dynamic_fields_values, schema_version_used)
       VALUES ($1, $2, TO_TIMESTAMP($3 / 1000.0), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
       timestamp = EXCLUDED.timestamp, recorded_at = EXCLUDED.recorded_at, last_modified_by_user_id = EXCLUDED.last_modified_by_user_id, date = EXCLUDED.date, machine = EXCLUDED.machine, meters = EXCLUDED.meters,
       changesCount = EXCLUDED.changesCount, changesComment = EXCLUDED.changesComment, shift = EXCLUDED.shift,
       boss = EXCLUDED.boss, boss_user_id = EXCLUDED.boss_user_id, operator = EXCLUDED.operator, operator_user_id = EXCLUDED.operator_user_id,
       dynamic_fields_values = EXCLUDED.dynamic_fields_values, schema_version_used = EXCLUDED.schema_version_used`,
      [
        id,
        persistedTimestamp,
        persistedTimestamp,
        user.id,
        user.id,
        date,
        machine,
        Math.round(normalizedMeters),
        Math.round(normalizedChanges),
        normalizedComment,
        shift,
        bossName,
        finalBossId,
        operatorName,
        operatorId,
        JSON.stringify(validatedDynamicFields),
        currentSchemaVersion
      ]
    );

    if (normalizedComment) {
      await pool.query(
        'INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [normalizedComment]
      );
    }

    if (beforeSnapshot) {
      await logAudit(
        user.id,
        'record_updated',
        {
          record_id: id,
          before: beforeSnapshot,
          after: currentSnapshot,
          changed_fields: changedFields
        },
        req.ip || ''
      );
    } else {
      await logAudit(
        user.id,
        'record_created',
        { record_id: id, ...currentSnapshot },
        req.ip || ''
      );
    }

    io.emit('records_changed');
    if (normalizedComment) {
      io.emit('settings_changed');
    }
    io.emit('record_dynamic_fields_saved', { id, machine, schemaVersionUsed: currentSchemaVersion });
    res.json({ success: true });
  } catch (err) {
    console.error('[records.save] failed', {
      id,
      machine,
      schemaVersionUsed,
      persistedTimestamp,
      meters,
      changesCount,
      message: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to save record' });
  }
});

app.delete('/api/records/:id', authenticate, requirePermission('records.delete'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const existingRecordResult = await pool.query(
      `SELECT id, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, operator
       FROM production_records WHERE id = $1`,
      [req.params.id]
    );
    const existingRecord = existingRecordResult.rows[0] || null;

    await pool.query('DELETE FROM production_records WHERE id = $1', [req.params.id]);
    await logAudit(
      user.id,
      'record_deleted',
      existingRecord
        ? {
            record_id: req.params.id,
            deleted: {
              date: existingRecord.date,
              machine: existingRecord.machine,
              shift: existingRecord.shift,
              boss: existingRecord.boss,
              operator: existingRecord.operator,
              meters: existingRecord.meters,
              changesCount: existingRecord.changesCount,
              changesComment: existingRecord.changesComment
            }
          }
        : { record_id: req.params.id },
      req.ip || ''
    );
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.delete('/api/records', authenticate, requirePermission('records.delete_all'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    await pool.query('DELETE FROM production_records');
    await logAudit(user.id, 'records_cleared', {}, req.ip || '');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear records' });
  }
});

// --- SETTINGS (MACHINE DYNAMIC FIELDS) ---
app.get('/api/settings/machine-fields/:machine', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  const machine = String(req.params.machine || '');
  if (!MACHINE_VALUES.includes(machine as typeof MACHINE_VALUES[number])) {
    return res.status(400).json({ error: 'Máquina inválida.' });
  }

  try {
    const effectiveSchema = await getEffectiveMachineSchema(machine);
    res.json({
      machine,
      version: effectiveSchema.version,
      fields: effectiveSchema.fields,
      updatedByUserId: effectiveSchema.updatedByUserId,
      updatedAt: effectiveSchema.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch machine field schema' });
  }
});

app.put('/api/settings/machine-fields/:machine', authenticate, requirePermission('settings.field_schemas'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const machine = String(req.params.machine || '');
  const expectedVersion = Number(req.body?.expectedVersion || 1);
  let hasOpenTransaction = false;
  if (!MACHINE_VALUES.includes(machine as typeof MACHINE_VALUES[number])) {
    return res.status(400).json({ error: 'Máquina inválida.' });
  }

  try {
    const sanitizedFields = sanitizeMachineFieldDefinitions(req.body?.fields || []);

    await pool.query('BEGIN');
    hasOpenTransaction = true;
    const currentResult = await pool.query(
      'SELECT schema_version, fields_json FROM machine_field_schemas WHERE machine = $1 FOR UPDATE',
      [machine]
    );

    const currentVersion = currentResult.rowCount ? Number(currentResult.rows[0].schema_version || 1) : 1;
    if (currentVersion !== expectedVersion) {
      await pool.query('ROLLBACK');
      return res.status(409).json({
        error: 'Otro usuario actualizó este esquema. Recarga y vuelve a intentar.',
        code: 'SCHEMA_WRITE_CONFLICT',
        currentVersion,
        expectedVersion
      });
    }

    const previousFields = currentResult.rowCount
      ? parseMachineSchema({ fields_json: currentResult.rows[0].fields_json })
      : [];
    const nextVersion = currentVersion + 1;

    await pool.query(
      `INSERT INTO machine_field_schemas (machine, schema_version, fields_json, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (machine) DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         fields_json = EXCLUDED.fields_json,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = CURRENT_TIMESTAMP`,
      [machine, nextVersion, JSON.stringify(sanitizedFields), user.id]
    );

    await logAudit(
      user.id,
      'machine_schema_updated',
      {
        machine,
        previousVersion: currentVersion,
        nextVersion,
        fieldsBefore: previousFields,
        fieldsAfter: sanitizedFields
      },
      req.ip || ''
    );

    await pool.query('COMMIT');
    hasOpenTransaction = false;

    io.emit('machine_schema_changed', {
      machine,
      version: nextVersion,
      updatedByUserId: user.id,
      updatedAt: new Date().toISOString()
    });
    io.emit('settings_changed');

    res.json({
      machine,
      version: nextVersion,
      fields: sanitizedFields,
      updatedByUserId: user.id,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    if (hasOpenTransaction) {
      await pool.query('ROLLBACK');
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to save machine field schema' });
  }
});

app.get('/api/settings/machine-fields/:machine/history', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  const machine = req.params.machine;
  if (!MACHINE_VALUES.includes(machine as typeof MACHINE_VALUES[number])) {
    return res.status(400).json({ error: 'Máquina inválida.' });
  }

  try {
    const history = await pool.query(
      `SELECT a.id,
              a.user_id as "userId",
              u.name as "userName",
              a.action,
              a.details,
              a.created_at as "createdAt"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action = 'machine_schema_updated'
         AND a.details->>'machine' = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [machine]
    );

    res.json(history.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch machine schema history' });
  }
});

// --- FIELD CATALOG ---
app.get('/api/settings/field-catalog', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  try {
    await normalizeFieldCatalogDisplayOrder(pool);
    const result = await pool.query(`
      SELECT fc.id, fc.key, fc.label, fc.type, fc.required,
             fc.display_order as "displayOrder",
             fc.options, fc.default_value as "defaultValue", fc.rules,
             fc.created_at as "createdAt", fc.updated_at as "updatedAt",
             COALESCE(
               json_agg(
                 json_build_object('machine', fca.machine, 'enabled', fca.enabled, 'sortOrder', fca.sort_order)
                 ORDER BY fca.sort_order
               ) FILTER (WHERE fca.machine IS NOT NULL),
               '[]'::json
             ) AS assignments
      FROM field_catalog fc
      LEFT JOIN field_catalog_assignments fca ON fc.id = fca.field_id
      GROUP BY fc.id
      ORDER BY fc.display_order ASC, fc.label ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cargar el catálogo de campos.' });
  }
});

app.post('/api/settings/field-catalog', authenticate, requirePermission('settings.field_schemas'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { key, label, type, required, options, defaultValue, rules, machines } = req.body;
  if (!key || !label || !FIELD_TYPES.includes(type as any)) {
    return res.status(400).json({ error: 'Datos inválidos: clave, etiqueta y tipo son obligatorios.' });
  }
  try {
    const normalizedKey = String(key).trim();
    const normalizedLabel = String(label).trim();
    ensureCatalogFieldKeyAllowed(normalizedKey);
    await ensureCatalogFieldKeyIsUniqueCaseInsensitive(normalizedKey);

    await pool.query('BEGIN');
    const maxOrderResult = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order
       FROM field_catalog`
    );
    const nextDisplayOrder = Number(maxOrderResult.rows[0]?.next_order ?? 0);
    const fieldResult = await pool.query(
      `INSERT INTO field_catalog (key, label, type, required, display_order, options, default_value, rules, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       RETURNING id, key, label, type, required, options,
                 display_order as "displayOrder", default_value as "defaultValue", rules,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        normalizedKey, normalizedLabel, type, required ?? false, nextDisplayOrder,
        JSON.stringify(options ?? []),
        defaultValue !== undefined && defaultValue !== null ? JSON.stringify(defaultValue) : null,
        JSON.stringify(rules ?? {}),
        user.id,
      ]
    );
    const field = fieldResult.rows[0];
    const validMachines = Array.isArray(machines)
      ? Array.from(new Set(machines.filter((m: string) => MACHINE_VALUES.includes(m as any))))
      : [];
    for (let i = 0; i < validMachines.length; i++) {
      await pool.query(
        `INSERT INTO field_catalog_assignments (field_id, machine, enabled, sort_order) VALUES ($1, $2, TRUE, $3)`,
        [field.id, validMachines[i], i]
      );
    }
    await logAudit(user.id, 'field_catalog_created', { key: field.key, label: field.label, machines: validMachines }, req.ip || '');
    await pool.query('COMMIT');
    validMachines.forEach((m: string) => io.emit('machine_schema_changed', { machine: m }));
    io.emit('settings_changed');
    res.status(201).json({ ...field, assignments: validMachines.map((m: string, i: number) => ({ machine: m, enabled: true, sortOrder: i })) });
  } catch (err: any) {
    await pool.query('ROLLBACK').catch(() => {});
    if (err instanceof Error && err.message) return res.status(400).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un campo con esa clave técnica.' });
    res.status(500).json({ error: 'No se pudo crear el campo.' });
  }
});

app.put('/api/settings/field-catalog/reorder', authenticate, requirePermission('settings.field_schemas'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];

  try {
    await pool.query('BEGIN');

    await normalizeFieldCatalogDisplayOrder(pool);
    const existingIds = await getOrderedFieldCatalogIds(pool);

    if (orderedIds.length !== existingIds.length) {
      await pool.query('ROLLBACK');
      return res.status(409).json({ error: 'El orden enviado no coincide con el catálogo actual. Recarga e intenta nuevamente.' });
    }

    const expected = new Set(existingIds);
    const incoming = new Set(orderedIds);
    if (incoming.size !== orderedIds.length || expected.size !== incoming.size || existingIds.some((id) => !incoming.has(id))) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Lista de IDs inválida para reordenar campos.' });
    }

    await applyFieldCatalogDisplayOrder(pool, orderedIds);
    await normalizeFieldCatalogDisplayOrder(pool);

    await logAudit(user.id, 'field_catalog_reordered', { orderedIds }, req.ip || '');
    await pool.query('COMMIT');

    io.emit('machine_schema_changed', {});
    io.emit('settings_changed');

    const updated = await pool.query(`
      SELECT fc.id, fc.key, fc.label, fc.type, fc.required,
             fc.display_order as "displayOrder",
             fc.options, fc.default_value as "defaultValue", fc.rules,
             fc.created_at as "createdAt", fc.updated_at as "updatedAt",
             COALESCE(
               json_agg(
                 json_build_object('machine', fca.machine, 'enabled', fca.enabled, 'sortOrder', fca.sort_order)
                 ORDER BY fca.sort_order
               ) FILTER (WHERE fca.machine IS NOT NULL),
               '[]'::json
             ) AS assignments
      FROM field_catalog fc
      LEFT JOIN field_catalog_assignments fca ON fc.id = fca.field_id
      GROUP BY fc.id
      ORDER BY fc.display_order ASC, fc.label ASC
    `);

    res.json(updated.rows);
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'No se pudo reordenar el catálogo de campos.' });
  }
});

app.put('/api/settings/field-catalog/:id', authenticate, requirePermission('settings.field_schemas'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id || '').trim();
  const { key, label, type, required, options, defaultValue, rules, machines } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID de campo inválido.' });
  }
  if (!key || !label || !FIELD_TYPES.includes(type as any)) {
    return res.status(400).json({ error: 'Datos inválidos: clave, etiqueta y tipo son obligatorios.' });
  }
  try {
    const normalizedKey = String(key).trim();
    const normalizedLabel = String(label).trim();
    ensureCatalogFieldKeyAllowed(normalizedKey);
    await ensureCatalogFieldKeyIsUniqueCaseInsensitive(normalizedKey, id);

    const currentFieldResult = await pool.query('SELECT key FROM field_catalog WHERE id = $1 LIMIT 1', [id]);
    if (currentFieldResult.rowCount === 0) {
      return res.status(404).json({ error: 'Campo no encontrado.' });
    }
    const previousKey = String(currentFieldResult.rows[0]?.key || '').trim();

    await pool.query('BEGIN');
    const fieldResult = await pool.query(
      `UPDATE field_catalog
       SET key=$1, label=$2, type=$3, required=$4, options=$5::jsonb,
           default_value=$6::jsonb, rules=$7::jsonb, updated_at=NOW()
       WHERE id=$8
       RETURNING id, key, label, type, required, options,
                 display_order as "displayOrder", default_value as "defaultValue", rules,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        normalizedKey, normalizedLabel, type, required ?? false,
        JSON.stringify(options ?? []),
        defaultValue !== undefined && defaultValue !== null ? JSON.stringify(defaultValue) : null,
        JSON.stringify(rules ?? {}),
        id,
      ]
    );
    if (fieldResult.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Campo no encontrado.' });
    }
    const field = fieldResult.rows[0];

    await migrateProductionRecordDynamicFieldKey(pool, previousKey, normalizedKey);
    await migrateDashboardConfigDynamicFieldKey(pool, previousKey, normalizedKey);

    const oldRows = await pool.query('SELECT machine FROM field_catalog_assignments WHERE field_id = $1', [id]);
    const oldMachines = oldRows.rows.map((r: any) => r.machine);
    await pool.query('DELETE FROM field_catalog_assignments WHERE field_id = $1', [id]);
    const validMachines = Array.isArray(machines)
      ? Array.from(new Set(machines.filter((m: string) => MACHINE_VALUES.includes(m as any))))
      : [];
    for (let i = 0; i < validMachines.length; i++) {
      await pool.query(
        `INSERT INTO field_catalog_assignments (field_id, machine, enabled, sort_order) VALUES ($1, $2, TRUE, $3)`,
        [id, validMachines[i], i]
      );
    }
    await logAudit(
      user.id,
      'field_catalog_updated',
      { previousKey, key: field.key, label: field.label, machines: validMachines },
      req.ip || ''
    );
    await pool.query('COMMIT');
    const affected = new Set([...oldMachines, ...validMachines]);
    affected.forEach((m: string) => io.emit('machine_schema_changed', { machine: m }));
    io.emit('settings_changed');
    res.json({ ...field, assignments: validMachines.map((m: string, i: number) => ({ machine: m, enabled: true, sortOrder: i })) });
  } catch (err: any) {
    await pool.query('ROLLBACK').catch(() => {});
    if (err instanceof Error && err.message) return res.status(400).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un campo con esa clave técnica.' });
    res.status(500).json({ error: 'No se pudo actualizar el campo.' });
  }
});

app.delete('/api/settings/field-catalog/:id', authenticate, requirePermission('settings.field_schemas'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { id } = req.params;
  try {
    const info = await pool.query('SELECT key, label FROM field_catalog WHERE id = $1', [id]);
    if (info.rowCount === 0) return res.status(404).json({ error: 'Campo no encontrado.' });
    const asgn = await pool.query('SELECT machine FROM field_catalog_assignments WHERE field_id = $1', [id]);
    const machines = asgn.rows.map((r: any) => r.machine);
    await pool.query('BEGIN');
    await pool.query('DELETE FROM field_catalog WHERE id = $1', [id]);
    await normalizeFieldCatalogDisplayOrder(pool);
    await pool.query('COMMIT');
    await logAudit(user.id, 'field_catalog_deleted', { ...info.rows[0], machines }, req.ip || '');
    machines.forEach((m: string) => io.emit('machine_schema_changed', { machine: m }));
    io.emit('settings_changed');
    res.json({ deleted: true });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'No se pudo eliminar el campo.' });
  }
});

// --- DASHBOARD CONFIGS ---
app.get('/api/settings/dashboard-configs', authenticate, requirePermission('settings.read'), requireDB, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, base_field as "baseField", related_fields as "relatedFields",
              widgets, is_default as "isDefault", updated_by_user_id as "updatedByUserId",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM dashboard_configs
       ORDER BY is_default DESC, updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron cargar los dashboards.' });
  }
});

app.get('/api/settings/dashboard-configs/:id', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, base_field as "baseField", related_fields as "relatedFields",
              widgets, is_default as "isDefault", updated_by_user_id as "updatedByUserId",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM dashboard_configs
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cargar el dashboard.' });
  }
});

app.post('/api/settings/dashboard-configs', authenticate, requirePermission('settings.dashboards'), requireDB, async (req, res) => {
  const user = (req as any).user;
  let hasOpenTransaction = false;
  try {
    const payload = sanitizeDashboardConfigPayload(req.body);

    await pool.query('BEGIN');
    hasOpenTransaction = true;

    if (payload.isDefault) {
      await pool.query('UPDATE dashboard_configs SET is_default = FALSE');
    }

    const result = await pool.query(
      `INSERT INTO dashboard_configs (name, description, base_field, related_fields, widgets, is_default, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())
       RETURNING id, name, description, base_field as "baseField", related_fields as "relatedFields",
                 widgets, is_default as "isDefault", updated_by_user_id as "updatedByUserId",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        payload.name,
        payload.description || null,
        payload.baseField,
        JSON.stringify(payload.relatedFields),
        JSON.stringify(payload.widgets),
        payload.isDefault,
        user.id,
      ]
    );

    await logAudit(user.id, 'dashboard_config_created', {
      dashboard_id: result.rows[0].id,
      name: payload.name,
      isDefault: payload.isDefault,
    }, req.ip || '');

    await pool.query('COMMIT');
    hasOpenTransaction = false;

    io.emit('settings_changed');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (hasOpenTransaction) {
      await pool.query('ROLLBACK').catch(() => {});
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'No se pudo crear el dashboard.' });
  }
});

app.put('/api/settings/dashboard-configs/:id', authenticate, requirePermission('settings.dashboards'), requireDB, async (req, res) => {
  const user = (req as any).user;
  let hasOpenTransaction = false;
  try {
    const payload = sanitizeDashboardConfigPayload(req.body);

    await pool.query('BEGIN');
    hasOpenTransaction = true;

    if (payload.isDefault) {
      await pool.query('UPDATE dashboard_configs SET is_default = FALSE WHERE id <> $1', [req.params.id]);
    }

    const result = await pool.query(
      `UPDATE dashboard_configs
       SET name = $1,
           description = $2,
           base_field = $3,
           related_fields = $4::jsonb,
           widgets = $5::jsonb,
           is_default = $6,
           updated_by_user_id = $7,
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, description, base_field as "baseField", related_fields as "relatedFields",
                 widgets, is_default as "isDefault", updated_by_user_id as "updatedByUserId",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        payload.name,
        payload.description || null,
        payload.baseField,
        JSON.stringify(payload.relatedFields),
        JSON.stringify(payload.widgets),
        payload.isDefault,
        user.id,
        req.params.id,
      ]
    );

    if (result.rowCount === 0) {
      await pool.query('ROLLBACK');
      hasOpenTransaction = false;
      return res.status(404).json({ error: 'Dashboard no encontrado.' });
    }

    await logAudit(user.id, 'dashboard_config_updated', {
      dashboard_id: req.params.id,
      name: payload.name,
      isDefault: payload.isDefault,
    }, req.ip || '');

    await pool.query('COMMIT');
    hasOpenTransaction = false;

    io.emit('settings_changed');
    res.json(result.rows[0]);
  } catch (err) {
    if (hasOpenTransaction) {
      await pool.query('ROLLBACK').catch(() => {});
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'No se pudo actualizar el dashboard.' });
  }
});

app.delete('/api/settings/dashboard-configs/:id', authenticate, requirePermission('settings.dashboards'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const existing = await pool.query('SELECT id, name FROM dashboard_configs WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado.' });
    }

    await pool.query('DELETE FROM dashboard_configs WHERE id = $1', [req.params.id]);
    await logAudit(user.id, 'dashboard_config_deleted', {
      dashboard_id: req.params.id,
      name: existing.rows[0].name,
    }, req.ip || '');

    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el dashboard.' });
  }
});

// --- SETTINGS (COMMENTS) ---
app.get('/api/settings/comments', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_comments ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/settings/comments', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const skipAudit = Boolean(req.body?.skipAudit);
    const insertResult = await pool.query(
      'INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING name',
      [req.body.name]
    );
    if (!skipAudit && insertResult.rowCount && insertResult.rowCount > 0) {
      await logAudit(user.id, 'comment_added', { name: req.body.name }, req.ip || '');
    }
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

app.delete('/api/settings/comments/:name', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const deleteResult = await pool.query('DELETE FROM custom_comments WHERE name = $1 RETURNING name', [req.params.name]);
    if (deleteResult.rowCount && deleteResult.rowCount > 0) {
      await logAudit(user.id, 'comment_deleted', { name: req.params.name }, req.ip || '');
    }
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.put('/api/settings/comments/:oldName', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { oldName } = req.params;
  const { newName } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM custom_comments WHERE name = $1', [oldName]);
    await pool.query('INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING', [newName]);
    await pool.query('UPDATE production_records SET changescomment = $1 WHERE changescomment = $2', [newName, oldName]);
    await pool.query('COMMIT');
    await logAudit(user.id, 'comment_renamed', { oldName, newName }, req.ip || '');
    io.emit('settings_changed');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to rename comment' });
  }
});

app.get('/api/settings/user-options', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, role
       FROM users
       WHERE status = 'active'
       ORDER BY name ASC`
    );

    const bosses = result.rows
      .filter((row: any) => row.role === 'jefe_turno' || row.role === 'jefe_planta')
      .map((row: any) => row.name);

    const bossOptions = result.rows
      .filter((row: any) => row.role === 'jefe_turno' || row.role === 'jefe_planta')
      .map((row: any) => ({ id: row.id, name: row.name, role: row.role }));

    const operators = result.rows
      .filter((row: any) => row.role === 'operario' || row.role === 'jefe_turno' || row.role === 'jefe_planta')
      .map((row: any) => row.name);

    const operatorOptions = result.rows
      .filter((row: any) => row.role === 'operario' || row.role === 'jefe_turno' || row.role === 'jefe_planta')
      .map((row: any) => ({ id: row.id, name: row.name, role: row.role }));

    res.json({
      bosses,
      operators,
      bossOptions,
      operatorOptions
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch selectable users' });
  }
});

// --- SETTINGS (OPERATORS) ---
app.get('/api/settings/operators', authenticate, requirePermission('settings.read'), requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_operators ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch operators' });
  }
});

app.post('/api/settings/operators', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const skipAudit = Boolean(req.body?.skipAudit);
    const insertResult = await pool.query(
      'INSERT INTO custom_operators (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING name',
      [req.body.name]
    );
    if (!skipAudit && insertResult.rowCount && insertResult.rowCount > 0) {
      await logAudit(user.id, 'operator_added', { name: req.body.name }, req.ip || '');
    }
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add operator' });
  }
});

app.delete('/api/settings/operators/:name', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const deleteResult = await pool.query('DELETE FROM custom_operators WHERE name = $1 RETURNING name', [req.params.name]);
    if (deleteResult.rowCount && deleteResult.rowCount > 0) {
      await logAudit(user.id, 'operator_deleted', { name: req.params.name }, req.ip || '');
    }
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete operator' });
  }
});

app.put('/api/settings/operators/:oldName', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { oldName } = req.params;
  const { newName } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM custom_operators WHERE name = $1', [oldName]);
    await pool.query('INSERT INTO custom_operators (name) VALUES ($1) ON CONFLICT DO NOTHING', [newName]);
    await pool.query('UPDATE production_records SET operator = $1 WHERE operator = $2', [newName, oldName]);
    await pool.query('COMMIT');
    await logAudit(user.id, 'operator_renamed', { oldName, newName }, req.ip || '');
    io.emit('settings_changed');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to rename operator' });
  }
});

// --- IMPORT / EXPORT ---
app.get('/api/export', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('backup.export'), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const records = await pool.query('SELECT id, timestamp, recorded_at as "recordedAt", created_by_user_id as "createdByUserId", last_modified_by_user_id as "lastModifiedByUserId", date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, boss_user_id as "bossUserId", operator, operator_user_id as "operatorUserId", dynamic_fields_values as "dynamicFieldsValues", schema_version_used as "schemaVersionUsed" FROM production_records');
    const comments = await pool.query('SELECT name FROM custom_comments');
    const operators = await pool.query('SELECT name FROM custom_operators');
    const machineFieldSchemas = await pool.query(
      'SELECT machine, schema_version as version, fields_json as fields, updated_by_user_id as "updatedByUserId", updated_at as "updatedAt" FROM machine_field_schemas'
    );
    const dashboardConfigs = await pool.query(
      `SELECT id, name, description, base_field as "baseField", related_fields as "relatedFields", widgets,
              is_default as "isDefault", updated_by_user_id as "updatedByUserId", created_at as "createdAt", updated_at as "updatedAt"
       FROM dashboard_configs`
    );
    
    res.json({
      records: records.rows.map(row => ({ ...row, timestamp: Number(row.timestamp) })),
      comments: comments.rows.map((r: any) => r.name),
      operators: operators.rows.map((r: any) => r.name),
      machineFieldSchemas: machineFieldSchemas.rows,
      dashboardConfigs: dashboardConfigs.rows
    });
    await logAudit(user.id, 'backup_exported', { records: records.rowCount }, req.ip || '');
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.post('/api/import', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('backup.import'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { records, comments, operators, machineFieldSchemas, dashboardConfigs } = req.body;
  try {
    await pool.query('BEGIN');
    
    if (records && Array.isArray(records)) {
      for (const r of records) {
        const importTimestamp = Number(r.timestamp || Date.now());
        await pool.query(
          `INSERT INTO production_records (id, timestamp, recorded_at, created_by_user_id, last_modified_by_user_id, date, machine, meters, changesCount, changesComment, shift, boss, boss_user_id, operator, operator_user_id, dynamic_fields_values, schema_version_used)
           VALUES ($1, $2, TO_TIMESTAMP($3 / 1000.0), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (id) DO UPDATE SET
           timestamp = EXCLUDED.timestamp, recorded_at = EXCLUDED.recorded_at, created_by_user_id = COALESCE(production_records.created_by_user_id, EXCLUDED.created_by_user_id), last_modified_by_user_id = EXCLUDED.last_modified_by_user_id, date = EXCLUDED.date, machine = EXCLUDED.machine, meters = EXCLUDED.meters,
           changesCount = EXCLUDED.changesCount, changesComment = EXCLUDED.changesComment, shift = EXCLUDED.shift,
           boss = EXCLUDED.boss, boss_user_id = EXCLUDED.boss_user_id, operator = EXCLUDED.operator, operator_user_id = EXCLUDED.operator_user_id,
           dynamic_fields_values = EXCLUDED.dynamic_fields_values, schema_version_used = EXCLUDED.schema_version_used`,
          [
            r.id,
            importTimestamp,
            importTimestamp,
            r.createdByUserId || null,
            r.lastModifiedByUserId || null,
            r.date,
            r.machine,
            r.meters,
            r.changesCount,
            r.changesComment,
            r.shift,
            r.boss,
            r.bossUserId || null,
            r.operator,
            r.operatorUserId || null,
            JSON.stringify(r.dynamicFieldsValues || {}),
            Number(r.schemaVersionUsed || 1)
          ]
        );
      }
    }
    
    if (comments && Array.isArray(comments)) {
      for (const c of comments) {
        await pool.query('INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING', [c]);
      }
    }
    
    if (operators && Array.isArray(operators)) {
      for (const o of operators) {
        await pool.query('INSERT INTO custom_operators (name) VALUES ($1) ON CONFLICT DO NOTHING', [o]);
      }
    }

    if (machineFieldSchemas && Array.isArray(machineFieldSchemas)) {
      for (const schema of machineFieldSchemas) {
        if (!schema?.machine || !MACHINE_VALUES.includes(schema.machine)) {
          continue;
        }
        const version = Number(schema.version || 1);
        const normalizedVersion = Number.isFinite(version) && version > 0 ? version : 1;
        const sanitizedFields = sanitizeMachineFieldDefinitions(schema.fields || []);

        await pool.query(
          `INSERT INTO machine_field_schemas (machine, schema_version, fields_json, updated_by_user_id, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (machine) DO UPDATE SET
             schema_version = EXCLUDED.schema_version,
             fields_json = EXCLUDED.fields_json,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_at = CURRENT_TIMESTAMP`,
          [schema.machine, normalizedVersion, JSON.stringify(sanitizedFields), schema.updatedByUserId || user.id]
        );
      }
    }

    if (dashboardConfigs && Array.isArray(dashboardConfigs)) {
      for (const config of dashboardConfigs) {
        const payload = sanitizeDashboardConfigPayload(config);
        const incomingId = normalizeOptionalString(config?.id);

        await pool.query(
          `INSERT INTO dashboard_configs (id, name, description, base_field, related_fields, widgets, is_default, updated_by_user_id, created_at, updated_at)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, COALESCE($9::timestamptz, NOW()), COALESCE($10::timestamptz, NOW()))
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             base_field = EXCLUDED.base_field,
             related_fields = EXCLUDED.related_fields,
             widgets = EXCLUDED.widgets,
             is_default = EXCLUDED.is_default,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_at = NOW()`,
          [
            incomingId,
            payload.name,
            payload.description || null,
            payload.baseField,
            JSON.stringify(payload.relatedFields),
            JSON.stringify(payload.widgets),
            payload.isDefault,
            config?.updatedByUserId || user.id,
            config?.createdAt || null,
            config?.updatedAt || null,
          ]
        );
      }
    }

    await pool.query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY is_default DESC, updated_at DESC, created_at DESC) AS rn
         FROM dashboard_configs
       )
       UPDATE dashboard_configs dc
       SET is_default = (ranked.rn = 1)
       FROM ranked
       WHERE dc.id = ranked.id`
    );
    
    await pool.query('COMMIT');
    await logAudit(
      user.id,
      'backup_imported',
      {
        records: Array.isArray(records) ? records.length : 0,
        comments: Array.isArray(comments) ? comments.length : 0,
        operators: Array.isArray(operators) ? operators.length : 0,
        dashboards: Array.isArray(dashboardConfigs) ? dashboardConfigs.length : 0
      },
      req.ip || ''
    );
    io.emit('records_changed');
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to import data' });
  }
});

async function startServer() {
  await initDB();

  const loadViteModule = new Function("return import('vite')") as () => Promise<RuntimeViteModule>;

  io.on('connection', async (socket) => {
    const authenticatedUser = await getSocketAuthenticatedUser(socket.handshake.headers.cookie);
    if (!authenticatedUser) {
      return;
    }

    socket.join(getUserSocketRoom(authenticatedUser.id));
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await loadViteModule();
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    (app as any).use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(distPath, 'assets');

    // Hashed assets can be cached aggressively.
    (app as any).use('/assets', express.static(assetsPath, { immutable: true, maxAge: '1y' }));

    // Other static files may change between deploys.
    (app as any).use(express.static(distPath, { maxAge: '1h' }));

    // Always serve the SPA shell without cache to avoid stale bundle references.
    app.get('*all', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

