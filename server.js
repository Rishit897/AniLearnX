// ── Bootstrap ─────────────────────────────────────────────────────────────────
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const bcrypt   = require('bcryptjs');

// ── Startup env validation ────────────────────────────────────────────────────
// Warn clearly about every missing/placeholder variable before the server binds.
// The server still starts in demo/simulation mode — it does NOT crash — but every
// gap is printed so Render logs make the problem immediately visible.
const ENV_CHECKS = [
  { key: 'SUPABASE_URL',                  sentinel: 'YOUR_PROJECT_ID' },
  { key: 'SUPABASE_KEY',                  sentinel: 'YOUR_SUPABASE_ANON_KEY' },
  { key: 'GEMINI_API_KEY',               sentinel: 'YOUR_' },
  { key: 'GOOGLE_WORKSPACE_WEBHOOK_URL', sentinel: 'YOUR_' }
];

const envStatus = {};
ENV_CHECKS.forEach(({ key, sentinel }) => {
  const val = process.env[key];
  const live = val && !val.includes(sentinel);
  envStatus[key] = live ? 'live' : 'simulation';
  if (!live) console.warn(`[AniLearn.X] ⚠  ${key} not configured — running in simulation mode`);
});

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  GEMINI_API_KEY,
  GOOGLE_WORKSPACE_WEBHOOK_URL,
  CORS_ORIGIN,
  PORT
} = process.env;

// ── App init ──────────────────────────────────────────────────────────────────
const app = express();

// CORS — restrict to explicit origin in production; fall back to open for local dev
app.use(cors({
  origin: CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser with 100 kb hard limit to prevent payload flooding
app.use(express.json({ limit: '100kb' }));

// ── Helper: is a given env var live (not placeholder / missing)? ──────────────
function isLive(val, sentinel) {
  return val && !val.includes(sentinel);
}

// ── Helper: hash password ─────────────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

// ── Helper: Supabase POST ─────────────────────────────────────────────────────
async function supabasePost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const err = new Error(`Supabase HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

// ── Helper: Supabase GET (single row by column match) ────────────────────────
async function supabaseGet(table, column, value) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const err = new Error(`Supabase HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : null;
}

// ── Helper: Supabase DELETE ───────────────────────────────────────────────────
async function supabaseDelete(table, column, value) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`;
  const res = await fetch(url, {
    method:  'DELETE',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation'
    }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    const err = new Error(`Supabase HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── GET / — serve the frontend ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── GET /health — basic liveness probe ───────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'AniLearn.X' });
});

// ── GET /api/status — per-service env health check ───────────────────────────
// Returns which integrations are live vs simulation without exposing key values.
app.get('/api/status', (req, res) => {
  res.json({
    server:    'running',
    port:      PORT || 3000,
    services: {
      supabase:          envStatus['SUPABASE_URL'],
      gemini:            envStatus['GEMINI_API_KEY'],
      workspace_webhook: envStatus['GOOGLE_WORKSPACE_WEBHOOK_URL']
    }
  });
});

// ── POST /api/register ────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Simulation mode
  if (!isLive(SUPABASE_URL, 'YOUR_PROJECT_ID')) {
    return res.status(200).json({
      simulated: true,
      message:   'Demo mode execution successful',
      email
    });
  }

  try {
    const hashed = await hashPassword(password);
    const user   = await supabasePost('users', {
      email,
      password_hash: hashed,
      streak:        0,
      created_at:    new Date().toISOString()
    });
    return res.status(201).json({ success: true, user: { email: user.email, id: user.id } });
  } catch (err) {
    // Supabase 409 = unique violation (email already registered)
    if (err.status === 409) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    return res.status(500).json({ error: 'Server error during registration.', message: err.message });
  }
});

// ── POST /api/login ───────────────────────────────────────────────────────────
// Verifies email + password against the stored bcrypt hash.
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  // Simulation mode
  if (!isLive(SUPABASE_URL, 'YOUR_PROJECT_ID')) {
    return res.status(200).json({
      simulated: true,
      message:   'Demo mode login successful',
      email
    });
  }

  try {
    const user = await supabaseGet('users', 'email', email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return res.status(200).json({
      success: true,
      user:    { email: user.email, id: user.id, streak: user.streak }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error during login.', message: err.message });
  }
});

// ── DELETE /api/account ───────────────────────────────────────────────────────
// Permanently removes a user row. Requires email + password confirmation.
app.delete('/api/account', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required for account deletion.' });
  }

  // Simulation mode
  if (!isLive(SUPABASE_URL, 'YOUR_PROJECT_ID')) {
    return res.status(200).json({
      simulated: true,
      message:   'Demo mode — account deletion simulated.',
      email
    });
  }

  try {
    const user = await supabaseGet('users', 'email', email);
    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Password confirmation failed.' });
    }
    await supabaseDelete('users', 'email', email);
    return res.status(200).json({ success: true, message: `Account ${email} permanently deleted.` });
  } catch (err) {
    return res.status(500).json({ error: 'Server error during account deletion.', message: err.message });
  }
});

// ── POST /api/chat — Gemini ───────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message field is required.' });
  }

  // Simulation mode
  if (!isLive(GEMINI_API_KEY, 'YOUR_')) {
    return res.status(200).json({
      simulated: true,
      reply: `Gemini Simulation: You asked about "${message.trim()}". In anime terms, think of this concept as the protagonist's hidden power — waiting to be unlocked through study and determination!`
    });
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const geminiRes = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: message.trim() }] }] })
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text().catch(() => '(no body)');
      return res.status(geminiRes.status).json({
        error:  `Gemini API responded with HTTP ${geminiRes.status}`,
        detail
      });
    }

    const data  = await geminiRes.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return res.status(502).json({ error: 'Gemini returned an empty response.' });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(500).json({ error: 'Server error contacting Gemini API.', message: err.message });
  }
});

// ── POST /api/generate-video — Google Workspace pipeline ─────────────────────
app.post('/api/generate-video', async (req, res) => {
  const { prompt, audio_track, subtitles, user_email } = req.body;

  if (!prompt || !user_email) {
    return res.status(400).json({ error: 'prompt and user_email are required.' });
  }

  // Simulation mode
  if (!isLive(GOOGLE_WORKSPACE_WEBHOOK_URL, 'YOUR_')) {
    return res.status(200).json({
      simulated: true,
      status:    'Video compilation queued in background simulation framework.',
      queued_at: new Date().toISOString()
    });
  }

  try {
    const webhookRes = await fetch(GOOGLE_WORKSPACE_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prompt, audio_track, subtitles, user_email })
    });

    if (!webhookRes.ok) {
      const detail = await webhookRes.text().catch(() => '(no body)');
      return res.status(webhookRes.status).json({
        error:  `Workspace webhook responded with HTTP ${webhookRes.status}`,
        detail
      });
    }

    return res.status(202).json({
      accepted:  true,
      status:    'Video generation dispatched to Google Workspace pipeline.',
      queued_at: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error dispatching to Google Workspace.', message: err.message });
  }
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any error thrown inside a route handler that was not caught locally.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[AniLearn.X] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT_NUM = parseInt(PORT || '3000', 10);
app.listen(PORT_NUM, () => {
  console.log(`[AniLearn.X] Server running on port ${PORT_NUM}`);
  console.log(`[AniLearn.X] Frontend  → http://localhost:${PORT_NUM}/`);
  console.log(`[AniLearn.X] API       → http://localhost:${PORT_NUM}/api/*`);
  console.log(`[AniLearn.X] Status    → http://localhost:${PORT_NUM}/api/status`);
});
