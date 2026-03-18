import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import http from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = 3000;
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
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
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS created_by_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS last_modified_by_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS boss_user_id UUID');
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS operator_user_id UUID');
    await pool.query(`ALTER TABLE production_records
      ADD COLUMN IF NOT EXISTS dynamic_fields_values JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await pool.query('ALTER TABLE production_records ADD COLUMN IF NOT EXISTS schema_version_used INTEGER');

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
    console.error('Failed to connect to PostgreSQL. API will return 503 for database operations.');
    isDbConnected = false;
  }
}

// Middleware to check DB connection
const requireDB = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  'admin.users.read',
  'admin.users.approve',
  'admin.users.unlock',
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
    'admin.users.read',
    'admin.users.approve',
    'admin.users.unlock',
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

const MACHINE_VALUES = ['WH1', 'Giave', 'WH3', 'NEXUS', 'SL2', '21', '22', 'S2DT', 'PROSLIT'] as const;
const SHIFT_VALUES = ['Mañana', 'Tarde', 'Noche'] as const;
const FIELD_TYPES = ['number', 'short_text', 'select', 'multi_select'] as const;

type DynamicFieldType = typeof FIELD_TYPES[number];

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

// Middleware: Authenticate
export const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];

    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (user.status === 'locked') return res.status(403).json({ error: 'Cuenta bloqueada. Contacte a un administrador.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Cuenta pendiente de aprobación.' });

    // Check timeout
    const lastActivity = new Date(user.last_activity).getTime();
    const now = Date.now();
    if (now - lastActivity > SESSION_TIMEOUT_MINUTES * 60 * 1000) {
      res.clearCookie('token');
      await logAudit(user.id, 'session_timeout', { reason: 'inactivity' }, req.ip || '');
      return res.status(401).json({ error: 'Sesión expirada por inactividad' });
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
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  const { operator_code, pin, name, role } = req.body;
  if (!operator_code || !pin || !name || !role) return res.status(400).json({ error: 'Faltan datos' });

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
      [operator_code, pinHash, assignedRole, assignedStatus, name]
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
  const { operator_code, pin } = req.body;
  if (!operator_code || !pin) return res.status(400).json({ error: 'Faltan credenciales' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE operator_code = $1', [operator_code]);
    const user = result.rows[0];

    if (!user) {
      await logAudit(null, 'login_failed', { operator_code, reason: 'user_not_found' }, req.ip || '');
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
    await pool.query('UPDATE users SET failed_attempts = 0, last_login = CURRENT_TIMESTAMP, last_activity = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    await logAudit(user.id, 'login_success', {}, req.ip || '');

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        operator_code: user.operator_code,
        name: user.name,
        role: user.role
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
app.get('/api/auth/me', authenticate, async (req, res) => {
  const user = (req as any).user;
  
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
  
  res.json({
    user: {
      id: user.id,
      operator_code: user.operator_code,
      name: user.name,
      role: user.role,
      permissions,
      visible_users: visResult.rows.map(r => r.target_id)
    }
  });
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

  if (newPin && newPin.length < 4) {
    return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });
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

  if (newPin && newPin.length < 4) {
    return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });
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
app.get('/api/admin/users', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('admin.users.read'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, operator_code, name, role, status, failed_attempts, created_at, last_login FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.post('/api/admin/users/:id/approve', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('admin.users.approve'), async (req, res) => {
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

app.post('/api/admin/users/:id/unlock', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('admin.users.unlock'), async (req, res) => {
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

app.get('/api/admin/audit-logs', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('admin.audit.read'), async (req, res) => {
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

    if (user.role !== 'admin') {
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

    const normalizedMeters = Number(meters);
    const normalizedChanges = Number(changesCount ?? 0);
    if (!Number.isFinite(normalizedMeters) || normalizedMeters < 0) {
      return res.status(400).json({ error: 'Metros inválidos.' });
    }
    if (!Number.isFinite(normalizedChanges) || normalizedChanges < 0) {
      return res.status(400).json({ error: 'Cantidad de cambios inválida.' });
    }

    const schemaResult = await pool.query(
      `SELECT machine, schema_version, fields_json
       FROM machine_field_schemas
       WHERE machine = $1
       LIMIT 1`,
      [machine]
    );
    const schemaRow = schemaResult.rows[0] || null;
    const currentSchemaVersion = schemaRow?.schema_version ? Number(schemaRow.schema_version) : 1;
    const schemaFields = parseMachineSchema(schemaRow);

    if (schemaFields.length > 0 && Number(schemaVersionUsed ?? 0) !== currentSchemaVersion) {
      return res.status(409).json({
        error: 'El formulario cambió. Recarga para usar la versión vigente.',
        code: 'SCHEMA_VERSION_MISMATCH',
        machine,
        currentSchemaVersion,
        receivedSchemaVersion: Number(schemaVersionUsed ?? 0),
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
        normalizeOptionalString(changesComment) || '',
        shift,
        bossName,
        finalBossId,
        operatorName,
        operatorId,
        JSON.stringify(validatedDynamicFields),
        currentSchemaVersion
      ]
    );

    const normalizeValue = (value: any) => {
      if (value === null || value === undefined) return '';
      return String(value).trim();
    };

    const toComparable = (source: any) => ({
      date: normalizeValue(source?.date),
      machine: normalizeValue(source?.machine),
      shift: normalizeValue(source?.shift),
      boss: normalizeValue(source?.boss),
      bossUserId: normalizeValue(source?.bossUserId),
      operator: normalizeValue(source?.operator),
      operatorUserId: normalizeValue(source?.operatorUserId),
      meters: Number(source?.meters || 0),
      changesCount: Number(source?.changesCount || 0),
      changesComment: normalizeValue(source?.changesComment),
      dynamicFieldsValues: source?.dynamicFieldsValues || {},
      schemaVersionUsed: Number(source?.schemaVersionUsed || 0)
    });

    const currentSnapshot = {
      date,
      machine,
      shift,
      boss: bossName,
      bossUserId: finalBossId,
      operator: operatorName,
      operatorUserId: operatorId,
      meters: Math.round(normalizedMeters),
      changesCount: Math.round(normalizedChanges),
      changesComment: normalizeOptionalString(changesComment) || '',
      dynamicFieldsValues: validatedDynamicFields,
      schemaVersionUsed: currentSchemaVersion
    };
    const currentComparable = toComparable(currentSnapshot);

    if (existingRecord) {
      const beforeSnapshot = {
        date: existingRecord.date,
        machine: existingRecord.machine,
        shift: existingRecord.shift,
        boss: existingRecord.boss,
        bossUserId: existingRecord.bossUserId,
        operator: existingRecord.operator,
        operatorUserId: existingRecord.operatorUserId,
        meters: existingRecord.meters,
        changesCount: existingRecord.changesCount,
        changesComment: existingRecord.changesComment
      };
      const beforeComparable = toComparable(beforeSnapshot);

      if (JSON.stringify(beforeComparable) !== JSON.stringify(currentComparable)) {
        await logAudit(
          user.id,
          'record_updated',
          {
            record_id: id,
            before: beforeSnapshot,
            after: currentSnapshot
          },
          req.ip || ''
        );
      }
    } else {
      await logAudit(
        user.id,
        'record_created',
        { record_id: id, ...currentSnapshot },
        req.ip || ''
      );
    }

    io.emit('records_changed');
    io.emit('record_dynamic_fields_saved', { id, machine, schemaVersionUsed: currentSchemaVersion });
    res.json({ success: true });
  } catch (err) {
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
  const machine = req.params.machine;
  if (!MACHINE_VALUES.includes(machine as typeof MACHINE_VALUES[number])) {
    return res.status(400).json({ error: 'Máquina inválida.' });
  }

  try {
    const result = await pool.query(
      `SELECT machine, schema_version as version, fields_json as fields,
              updated_by_user_id as "updatedByUserId", updated_at as "updatedAt"
       FROM machine_field_schemas
       WHERE machine = $1
       LIMIT 1`,
      [machine]
    );

    if (result.rowCount === 0) {
      return res.json({
        machine,
        version: 1,
        fields: [],
        updatedByUserId: null,
        updatedAt: null
      });
    }

    const row = result.rows[0];
    const fields = parseMachineSchema({ fields_json: row.fields });
    res.json({ ...row, fields });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch machine field schema' });
  }
});

app.put('/api/settings/machine-fields/:machine', authenticate, requirePermission('settings.manage'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const machine = req.params.machine;
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
    
    res.json({
      records: records.rows.map(row => ({ ...row, timestamp: Number(row.timestamp) })),
      comments: comments.rows.map((r: any) => r.name),
      operators: operators.rows.map((r: any) => r.name),
      machineFieldSchemas: machineFieldSchemas.rows
    });
    await logAudit(user.id, 'backup_exported', { records: records.rowCount }, req.ip || '');
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.post('/api/import', authenticate, requireRole(['admin', 'jefe_planta']), requirePermission('backup.import'), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { records, comments, operators, machineFieldSchemas } = req.body;
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
    
    await pool.query('COMMIT');
    await logAudit(
      user.id,
      'backup_imported',
      {
        records: Array.isArray(records) ? records.length : 0,
        comments: Array.isArray(comments) ? comments.length : 0,
        operators: Array.isArray(operators) ? operators.length : 0
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

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(distPath, 'assets');

    // Hashed assets can be cached aggressively.
    app.use('/assets', express.static(assetsPath, { immutable: true, maxAge: '1y' }));

    // Other static files may change between deploys.
    app.use(express.static(distPath, { maxAge: '1h' }));

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
