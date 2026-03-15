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
import { prepareDatabase } from './scripts/database';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
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

// Initialize Database Connection
async function initDB() {
  try {
    await pool.query('SELECT 1');
    console.log('Database connection ready.');
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
async function logAudit(userId: string | null, action: string, details: any, ipAddress: string) {
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

app.get('/api/users/assignment-options', authenticate, requireDB, async (_req, res) => {
  try {
    const operatorsResult = await pool.query(
      `SELECT id, operator_code, name, role
       FROM users
       WHERE status = 'active' AND role IN ('operario', 'jefe_turno')
       ORDER BY name ASC`
    );

    const bossesResult = await pool.query(
      `SELECT id, operator_code, name, role
       FROM users
       WHERE status = 'active' AND role = 'jefe_turno'
       ORDER BY name ASC`
    );

    res.json({
      operators: operatorsResult.rows,
      bosses: bossesResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching assignment options' });
  }
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

app.delete('/api/admin/users/:id', authenticate, requireRole(['admin']), async (req, res) => {
  const admin = (req as any).user;
  const { id } = req.params;

  if (admin.id === id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta mientras estás autenticado.' });
  }

  try {
    const targetResult = await pool.query(
      'SELECT id, operator_code, name, role, status FROM users WHERE id = $1',
      [id]
    );
    const targetUser = targetResult.rows[0];

    if (!targetUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (targetUser.role === 'admin') {
      const adminCountResult = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
      );
      const adminCount = adminCountResult.rows[0]?.count ?? 0;

      if (adminCount <= 1) {
        return res.status(400).json({ error: 'No puedes eliminar al último administrador del sistema.' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    await logAudit(admin.id, 'user_deleted', {
      target_user_id: targetUser.id,
      target_operator_code: targetUser.operator_code,
      target_name: targetUser.name,
      target_role: targetUser.role,
      target_status: targetUser.status,
    }, req.ip || '');

    io.emit('user_deleted', { userId: targetUser.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting user' });
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

app.post('/api/records', requireDB, async (req, res) => {
  const { id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator } = req.body;
  try {
    await pool.query(
      `INSERT INTO production_records (id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
       timestamp = EXCLUDED.timestamp, date = EXCLUDED.date, machine = EXCLUDED.machine, meters = EXCLUDED.meters,
       changesCount = EXCLUDED.changesCount, changesComment = EXCLUDED.changesComment, shift = EXCLUDED.shift,
       boss = EXCLUDED.boss, operator = EXCLUDED.operator`,
      [id, timestamp, date, machine, meters, changesCount, changesComment, shift, boss, operator]
    );
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save record' });
  }
});

app.delete('/api/records/:id', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM production_records WHERE id = $1', [req.params.id]);
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.delete('/api/records', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM production_records');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear records' });
  }
});

// --- SETTINGS (COMMENTS) ---
app.get('/api/settings/comments', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_comments ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/settings/comments', requireDB, async (req, res) => {
  try {
    await pool.query('INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING', [req.body.name]);
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

app.delete('/api/settings/comments/:name', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM custom_comments WHERE name = $1', [req.params.name]);
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.put('/api/settings/comments/:oldName', requireDB, async (req, res) => {
  const { oldName } = req.params;
  const { newName } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM custom_comments WHERE name = $1', [oldName]);
    await pool.query('INSERT INTO custom_comments (name) VALUES ($1) ON CONFLICT DO NOTHING', [newName]);
    await pool.query('UPDATE production_records SET changescomment = $1 WHERE changescomment = $2', [newName, oldName]);
    await pool.query('COMMIT');
    io.emit('settings_changed');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to rename comment' });
  }
});

// --- SETTINGS (OPERATORS) ---
app.get('/api/settings/operators', requireDB, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM custom_operators ORDER BY name ASC');
    res.json(result.rows.map((row: any) => row.name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch operators' });
  }
});

app.post('/api/settings/operators', requireDB, async (req, res) => {
  try {
    await pool.query('INSERT INTO custom_operators (name) VALUES ($1) ON CONFLICT DO NOTHING', [req.body.name]);
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add operator' });
  }
});

app.delete('/api/settings/operators/:name', requireDB, async (req, res) => {
  try {
    await pool.query('DELETE FROM custom_operators WHERE name = $1', [req.params.name]);
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete operator' });
  }
});

app.put('/api/settings/operators/:oldName', requireDB, async (req, res) => {
  const { oldName } = req.params;
  const { newName } = req.body;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM custom_operators WHERE name = $1', [oldName]);
    await pool.query('INSERT INTO custom_operators (name) VALUES ($1) ON CONFLICT DO NOTHING', [newName]);
    await pool.query('UPDATE production_records SET operator = $1 WHERE operator = $2', [newName, oldName]);
    await pool.query('COMMIT');
    io.emit('settings_changed');
    io.emit('records_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to rename operator' });
  }
});

// --- IMPORT / EXPORT ---
app.get('/api/export', requireDB, async (req, res) => {
  try {
    const records = await pool.query('SELECT id, timestamp, date, machine, meters, changescount as "changesCount", changescomment as "changesComment", shift, boss, operator FROM production_records');
    const comments = await pool.query('SELECT name FROM custom_comments');
    const operators = await pool.query('SELECT name FROM custom_operators');
    
    res.json({
      records: records.rows.map(row => ({ ...row, timestamp: Number(row.timestamp) })),
      comments: comments.rows.map((r: any) => r.name),
      operators: operators.rows.map((r: any) => r.name)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.post('/api/import', requireDB, async (req, res) => {
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
    io.emit('records_changed');
    io.emit('settings_changed');
    res.json({ success: true });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to import data' });
  }
});

async function startServer() {
  await prepareDatabase();
  await initDB();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
