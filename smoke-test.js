// smoke-test.js — run with: node smoke-test.js
// Starts the server in-process, fires one request per registered route,
// prints a pass/fail table, then exits.
// Requires the server to NOT be already running on the target port.

process.env.PORT = '3099'; // isolated port so it never conflicts with dev server
require('dotenv').config();

const http = require('http');

// ── Inline mini-requester (no external deps) ──────────────────────────────────
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port:     3099,
      path,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0
      }
    };
    const r = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── Test definitions ──────────────────────────────────────────────────────────
// Each test defines the expected HTTP status code(s) as acceptable.
// All routes run in simulation mode during smoke tests (no real env vars needed).
const TESTS = [
  {
    label:    'GET  /health',
    run:      () => req('GET', '/health'),
    expect:   [200],
    check:    r => r.body.status === 'ok'
  },
  {
    label:    'GET  /api/status',
    run:      () => req('GET', '/api/status'),
    expect:   [200],
    check:    r => r.body.services !== undefined
  },
  {
    label:    'POST /api/register — valid (simulation)',
    run:      () => req('POST', '/api/register', { email: 'test@smoke.dev', password: 'abc123' }),
    expect:   [200, 201],
    check:    r => r.body.email === 'test@smoke.dev' || r.body.simulated === true || r.body.success === true
  },
  {
    label:    'POST /api/register — missing fields → 400',
    run:      () => req('POST', '/api/register', {}),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'POST /api/register — bad email → 400',
    run:      () => req('POST', '/api/register', { email: 'not-an-email', password: 'abc123' }),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'POST /api/login — valid (simulation)',
    run:      () => req('POST', '/api/login', { email: 'test@smoke.dev', password: 'abc123' }),
    expect:   [200],
    check:    r => r.body.simulated === true || r.body.success === true
  },
  {
    label:    'POST /api/login — missing fields → 400',
    run:      () => req('POST', '/api/login', {}),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'DELETE /api/account — valid (simulation)',
    run:      () => req('DELETE', '/api/account', { email: 'test@smoke.dev', password: 'abc123' }),
    expect:   [200],
    check:    r => r.body.simulated === true || r.body.success === true
  },
  {
    label:    'DELETE /api/account — missing fields → 400',
    run:      () => req('DELETE', '/api/account', {}),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'POST /api/chat — valid (simulation)',
    run:      () => req('POST', '/api/chat', { message: 'What is photosynthesis?' }),
    expect:   [200],
    check:    r => typeof r.body.reply === 'string' || r.body.simulated === true
  },
  {
    label:    'POST /api/chat — missing message → 400',
    run:      () => req('POST', '/api/chat', {}),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'POST /api/generate-video — valid (simulation)',
    run:      () => req('POST', '/api/generate-video', { prompt: 'anime scene', user_email: 'test@smoke.dev' }),
    expect:   [200, 202],
    check:    r => r.body.simulated === true || r.body.accepted === true
  },
  {
    label:    'POST /api/generate-video — missing fields → 400',
    run:      () => req('POST', '/api/generate-video', {}),
    expect:   [400],
    check:    r => typeof r.body.error === 'string'
  },
  {
    label:    'GET  /nonexistent → 404',
    run:      () => req('GET', '/nonexistent-route-xyz'),
    expect:   [404],
    check:    r => typeof r.body.error === 'string'
  }
];

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  // Boot the server
  require('./server.js');

  // Give it 600 ms to bind
  await new Promise(r => setTimeout(r, 600));

  let passed = 0;
  let failed = 0;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           AniLearn.X — Backend Smoke Test Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const test of TESTS) {
    try {
      const result = await test.run();
      const statusOk = test.expect.includes(result.status);
      const checkOk  = test.check(result);
      if (statusOk && checkOk) {
        console.log(`  ✅  PASS  ${test.label}  (HTTP ${result.status})`);
        passed++;
      } else {
        console.log(`  ❌  FAIL  ${test.label}`);
        console.log(`           got HTTP ${result.status}, expected ${test.expect.join(' or ')}`);
        console.log(`           body: ${JSON.stringify(result.body).slice(0, 120)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  💥  ERROR ${test.label} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`  Total: ${TESTS.length}  |  Passed: ${passed}  |  Failed: ${failed}`);
  console.log(`──────────────────────────────────────────────────────────────\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Smoke test runner crashed:', err);
  process.exit(1);
});
