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
  const permsResult = await pool.query('SELECT module, action FROM permissions WHERE user_id = $1', [user.id]);
  const visResult = await pool.query('SELECT target_id FROM user_visibility WHERE observer_id = $1', [user.id]);
  
  res.json({
    user: {
      id: user.id,
      operator_code: user.operator_code,
      name: user.name,
      role: user.role,
      permissions: permsResult.rows,
      visible_users: visResult.rows.map(r => r.target_id)
    }
  });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', authenticate, requireRole(['admin', 'jefe_planta']), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, operator_code, name, role, status, created_at, last_login FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.post('/api/admin/users/:id/approve', authenticate, requireRole(['admin', 'jefe_planta']), async (req, res) => {
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

app.post('/api/admin/users/:id/unlock', authenticate, requireRole(['admin', 'jefe_planta', 'jefe_turno']), async (req, res) => {
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

app.get('/api/admin/audit-logs', authenticate, requireRole(['admin', 'jefe_planta']), async (req, res) => {
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

// --- RECORDS ---
app.get('/api/records', authenticate, requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    let query = 'SELECT id, timestamp, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, operator FROM production_records';
    let params: any[] = [];

    if (user.role !== 'admin') {
      const visResult = await pool.query('SELECT target_id FROM user_visibility WHERE observer_id = $1', [user.id]);
      const visibleUserIds = visResult.rows.map(r => r.target_id);
      
      let visibleNames = [user.name]; // Always see own records
      if (visibleUserIds.length > 0) {
        const visibleUsersResult = await pool.query('SELECT name FROM users WHERE id = ANY($1)', [visibleUserIds]);
        visibleNames = visibleNames.concat(visibleUsersResult.rows.map(r => r.name));
      }

      query += ' WHERE operator = ANY($1)';
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

app.post('/api/records', authenticate, requireDB, async (req, res) => {
  const user = (req as any).user;
  const { id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator } = req.body;
  try {
    const existingRecordResult = await pool.query(
      `SELECT id, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, operator
       FROM production_records WHERE id = $1`,
      [id]
    );
    const existingRecord = existingRecordResult.rows[0] || null;

    await pool.query(
      `INSERT INTO production_records (id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
       timestamp = EXCLUDED.timestamp, date = EXCLUDED.date, machine = EXCLUDED.machine, meters = EXCLUDED.meters,
       changesCount = EXCLUDED.changesCount, changesComment = EXCLUDED.changesComment, shift = EXCLUDED.shift,
       boss = EXCLUDED.boss, operator = EXCLUDED.operator`,
      [id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator]
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
      operator: normalizeValue(source?.operator),
      meters: Number(source?.meters || 0),
      changesCount: Number(source?.changesCount || 0),
      changesComment: normalizeValue(source?.changesComment)
    });

    const currentSnapshot = { date, machine, shift, boss, operator, meters, changesCount, changesComment };
    const currentComparable = toComparable(currentSnapshot);

    if (existingRecord) {
      const beforeSnapshot = {
        date: existingRecord.date,
        machine: existingRecord.machine,
        shift: existingRecord.shift,
        boss: existingRecord.boss,
        operator: existingRecord.operator,
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save record' });
  }
});

app.delete('/api/records/:id', authenticate, requireDB, async (req, res) => {
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

app.delete('/api/records', authenticate, requireDB, async (req, res) => {
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

// --- SETTINGS (COMMENTS) ---
app.get('/api/settings/comments', authenticate, requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_comments ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/settings/comments', authenticate, requireDB, async (req, res) => {
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

app.delete('/api/settings/comments/:name', authenticate, requireDB, async (req, res) => {
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

app.put('/api/settings/comments/:oldName', authenticate, requireDB, async (req, res) => {
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

// --- SETTINGS (OPERATORS) ---
app.get('/api/settings/operators', authenticate, requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_operators ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch operators' });
  }
});

app.post('/api/settings/operators', authenticate, requireDB, async (req, res) => {
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

app.delete('/api/settings/operators/:name', authenticate, requireDB, async (req, res) => {
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

app.put('/api/settings/operators/:oldName', authenticate, requireDB, async (req, res) => {
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
app.get('/api/export', authenticate, requireRole(['admin', 'jefe_planta']), requireDB, async (req, res) => {
  const user = (req as any).user;
  try {
    const records = await pool.query('SELECT id, timestamp, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, operator FROM production_records');
    const comments = await pool.query('SELECT name FROM custom_comments');
    const operators = await pool.query('SELECT name FROM custom_operators');
    
    res.json({
      records: records.rows.map(row => ({ ...row, timestamp: Number(row.timestamp) })),
      comments: comments.rows.map((r: any) => r.name),
      operators: operators.rows.map((r: any) => r.name)
    });
    await logAudit(user.id, 'backup_exported', { records: records.rowCount }, req.ip || '');
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.post('/api/import', authenticate, requireRole(['admin', 'jefe_planta']), requireDB, async (req, res) => {
  const user = (req as any).user;
  const { records, comments, operators } = req.body;
  try {
    await pool.query('BEGIN');
    
    if (records && Array.isArray(records)) {
      for (const r of records) {
        await pool.query(
          `INSERT INTO production_records (id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
           timestamp = EXCLUDED.timestamp, date = EXCLUDED.date, machine = EXCLUDED.machine, meters = EXCLUDED.meters,
           changesCount = EXCLUDED.changesCount, changesComment = EXCLUDED.changesComment, shift = EXCLUDED.shift,
           boss = EXCLUDED.boss, operator = EXCLUDED.operator`,
          [r.id, r.timestamp, r.date, r.machine, r.meters, r.changesCount, r.changesComment, r.shift, r.boss, r.operator]
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
