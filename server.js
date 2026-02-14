const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

// ---------------------------------------------------------------------------
// PostgreSQL connection (auto-injected by api-database template)
// DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD are set by ECS
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 5000,
  max: 5,
});

// Simulate realistic startup delay
const STARTUP_DELAY_MS = 3000;
let ready = false;

app.use(express.json());

// ---------------------------------------------------------------------------
// Bootstrap — create a sample table on startup
// ---------------------------------------------------------------------------
async function bootstrap() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[demo-app] Database table "notes" ready');
  } catch (err) {
    console.error('[demo-app] Failed to bootstrap database:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /health — ALB health check target
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  if (!ready) {
    return res.status(503).json({ status: 'starting' });
  }

  let dbOk = false;
  try {
    const result = await pool.query('SELECT 1 AS check');
    dbOk = result.rows[0]?.check === 1;
  } catch (_) {
    dbOk = false;
  }

  const uptimeSeconds = Math.floor(process.uptime());
  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    uptime_seconds: uptimeSeconds,
    database: dbOk ? 'connected' : 'unreachable',
    started_at: startedAt,
  });
});

// ---------------------------------------------------------------------------
// GET /db — show database connection info (non-sensitive)
// ---------------------------------------------------------------------------
app.get('/db', async (_req, res) => {
  try {
    const versionResult = await pool.query('SELECT version()');
    const tablesResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);

    res.json({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      pg_version: versionResult.rows[0]?.version,
      tables: tablesResult.rows.map((r) => r.table_name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /notes — list all notes
// ---------------------------------------------------------------------------
app.get('/notes', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notes ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /notes — create a note
// ---------------------------------------------------------------------------
app.post('/notes', async (req, res) => {
  const { title, body } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING *',
      [title, body || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /env — injected environment variables
// ---------------------------------------------------------------------------
app.get('/env', (_req, res) => {
  const safeKeys = Object.keys(process.env).filter(
    (k) =>
      k.startsWith('APP_') ||
      k.startsWith('NODE_') ||
      k.startsWith('DB_HOST') ||
      k.startsWith('DB_PORT') ||
      k.startsWith('DB_NAME') ||
      ['PORT', 'LOG_LEVEL'].includes(k)
  );

  const env = {};
  for (const key of safeKeys) {
    env[key] = process.env[key];
  }

  res.json({
    node_version: process.version,
    platform: process.platform,
    injected_vars: env,
  });
});

// ---------------------------------------------------------------------------
// GET / — landing page
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    service: 'mini-idp-demo-app',
    description: 'Demo API with PostgreSQL — deployed via mini-idp preview environment',
    endpoints: [
      'GET  /health  — health check with DB connectivity',
      'GET  /db      — database connection info',
      'GET  /notes   — list notes from DB',
      'POST /notes   — create a note (JSON: {title, body})',
      'GET  /env     — injected environment variables',
    ],
    started_at: startedAt,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[demo-app] Listening on port ${PORT}`);
  console.log(`[demo-app] Simulating ${STARTUP_DELAY_MS}ms startup delay...`);

  setTimeout(async () => {
    await bootstrap();
    ready = true;
    console.log('[demo-app] Ready to serve traffic');
  }, STARTUP_DELAY_MS);
});

process.on('SIGTERM', () => {
  console.log('[demo-app] SIGTERM received, shutting down...');
  pool.end();
  server.close(() => process.exit(0));
});
