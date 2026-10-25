// Local harness: exercises functions/api/register.js with mocked Request/env
// against the LIVE Planning Center API, then cleans up.
import { readFileSync, existsSync } from 'node:fs';
import { onRequestPost as handler } from '../functions/api/register.js';

const SOLD_OUT_ERROR = 'The Forged Kit is sold out. Please register for the Free path.';

// No Planning Center credentials in this environment: prove kit is rejected
// with zero network calls, and that free / sponsorship still reach the write path.
if (!existsSync(process.env.HOME + '/.pco-env')) {
  const failures = [];
  function check(name, cond) {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
    if (!cond) failures.push(name);
  }

  const source = readFileSync(new URL('../functions/api/register.js', import.meta.url), 'utf8');
  check('list ids unchanged', source.includes("free: '5315047'") && source.includes("kit: '5315090'") && source.includes("sponsorship: '5373556'"));

  async function post(path, extra = {}) {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body || '' });
      const u = String(url);
      const method = opts.method || 'GET';
      if (u.includes('/emails?')) {
        return new Response(JSON.stringify({ data: [{ id: 'e1' }] }), { status: 200 });
      }
      if (u.includes('/emails/e1/person')) {
        return new Response(JSON.stringify({ data: { id: 'p1' } }), { status: 200 });
      }
      if (u.includes('/field_data') && method === 'GET') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (method === 'POST' || method === 'PATCH') {
        return new Response(JSON.stringify({ data: { id: 'new1' } }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    };
    const resp = await handler({
      request: new Request('http://x/api/register', {
        method: 'POST',
        body: JSON.stringify({
          first_name: 'Luc',
          last_name: 'Herlitz',
          email: 'lucasherlitz@me.com',
          phone: '555-0123',
          path,
          ...extra,
        }),
      }),
      env: { PCO_PAT_ID: 'id', PCO_PAT_SECRET: 'secret' },
      waitUntil: (p) => p,
    });
    const body = JSON.parse(await resp.text());
    return { status: resp.status, body, calls };
  }

  const kit = await post('kit');
  check('kit rejected', kit.status === 409 && kit.body.ok === false && kit.body.error === SOLD_OUT_ERROR);
  check('kit makes no Planning Center call', kit.calls.length === 0);

  const kitAgain = await post('kit');
  check('repeat kit still rejected', kitAgain.status === 409 && kitAgain.calls.length === 0);

  const free = await post('free');
  const freeWrites = free.calls.filter((c) => c.method === 'POST' && c.body.includes('"Free"'));
  check('free succeeds', free.status === 200 && free.body.ok === true && freeWrites.length === 1);
  check('free does not write Forged Kit', !free.calls.some((c) => String(c.body).includes('Forged Kit')));

  const sponsorMissing = await post('sponsorship');
  check('sponsorship still requires a display name', sponsorMissing.status === 422 && sponsorMissing.calls.length === 0);

  const sponsor = await post('sponsorship', { sponsorship_name: 'Smith Family' });
  const sponsorWrites = sponsor.calls.filter((c) => c.method === 'POST');
  check(
    'sponsorship succeeds',
    sponsor.status === 200 &&
      sponsor.body.ok === true &&
      sponsorWrites.some((c) => c.body.includes('"Sponsorship"')) &&
      sponsorWrites.some((c) => c.body.includes('Smith Family'))
  );
  check('sponsorship does not write Forged Kit', !sponsor.calls.some((c) => String(c.body).includes('Forged Kit')));

  console.log(failures.length ? 'HARNESS FAILURES PRESENT' : 'ALL HARNESS TESTS PASSED');
  process.exit(failures.length ? 1 : 0);
}

for (const line of readFileSync(process.env.HOME + '/.pco-env', 'utf8').trim().split('\n')) {
  const [k, ...v] = line.split('=');
  process.env[k] = v.join('=');
}
const env = { PCO_PAT_ID: process.env.PCO_PAT_ID, PCO_PAT_SECRET: process.env.PCO_PAT_SECRET };

async function run(name, req) {
  const resp = await handler({ request: req, env, waitUntil: (p) => p });
  const body = await resp.text();
  console.log(`\n=== ${name} -> HTTP ${resp.status}`);
  console.log('   ', body);
  return { status: resp.status, body };
}

const LUC_EMAIL = 'lucasherlitz@me.com';
const results = [];

// Wipes any Forged-tab checkbox on Luc's profile so the next registration
// is a fresh (non-idempotent) write.
async function pcoCleanupForged() {
  const auth = 'Basic ' + Buffer.from(process.env.PCO_PAT_ID + ':' + process.env.PCO_PAT_SECRET).toString('base64');
  const H = { Authorization: auth, Accept: 'application/json' };
  const B = 'https://api.planningcenteronline.com/people/v2';
  const hits = await (await fetch(B + '/emails?where[address]=' + encodeURIComponent(LUC_EMAIL) + '&per_page=1', { headers: H })).json();
  const person = await (await fetch(B + '/emails/' + hits.data[0].id + '/person', { headers: H })).json();
  const fd = await (await fetch(B + '/people/' + person.data.id + '/field_data?per_page=100', { headers: H })).json();
  for (const d of fd.data || []) {
    if (d.relationships.field_definition.data.id === '1104573') {
      await fetch(B + '/people/' + person.data.id + '/field_data/' + d.id, { method: 'DELETE', headers: H });
    }
  }
}

// 1) Invalid path value -> 422
results.push(await run('INVALID PATH', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, path: 'vip' })
})));

// 2) Missing email -> 422
results.push(await run('MISSING EMAIL', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: '', path: 'free' })
})));

// 3) Honeypot -> 200 ok, no write
results.push(await run('HONEYPOT', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, path: 'free', website: 'spam.example' })
})));

// 4) Kit path is closed -> 409, no Planning Center write
results.push(await run('KIT SOLD OUT', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, phone: '555-0123', path: 'kit' })
})));

// 5) Repeat kit registration -> still 409, still no write
results.push(await run('KIT SOLD OUT REPEAT', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, path: 'kit' })
})));

// 6) RUN_LIST_REFRESH unset -> registration succeeds, NO list run attempted
{
  await pcoCleanupForged();
  const realFetch = globalThis.fetch;
  let ranList = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/lists/') && String(url).endsWith('/run')) ranList = true;
    return realFetch(url, opts);
  };
  const envNoFlag = { PCO_PAT_ID: process.env.PCO_PAT_ID, PCO_PAT_SECRET: process.env.PCO_PAT_SECRET };
  const resp = await handler({ request: new Request('http://x/api/register', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, path: 'free' })
  }), env: envNoFlag, waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 16000));
  globalThis.fetch = realFetch;
  console.log(`\n=== NO-FLAG GUARD -> HTTP ${resp.status} listRunAttempted=${ranList}`);
  results.push({ status: resp.status, noListRun: !ranList });
}

// 7) RUN_LIST_REFRESH=true -> list run IS attempted after the 15s delay
{
  await pcoCleanupForged();
  const realFetch = globalThis.fetch;
  let runStatus = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/lists/') && String(url).endsWith('/run')) {
      runStatus = 204;
      return new Response(null, { status: 204 });
    }
    return realFetch(url, opts);
  };
  const envFlag = { PCO_PAT_ID: process.env.PCO_PAT_ID, PCO_PAT_SECRET: process.env.PCO_PAT_SECRET, RUN_LIST_REFRESH: 'true' };
  const resp = await handler({ request: new Request('http://x/api/register', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, path: 'free' })
  }), env: envFlag, waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 16000));
  globalThis.fetch = realFetch;
  console.log(`\n=== FLAG-ON TRIGGER -> HTTP ${resp.status} listRunStatus=${runStatus}`);
  results.push({ status: resp.status, listRunStatus: runStatus });
}

// Verify PCO state + cleanup via REST
const auth = 'Basic ' + Buffer.from(process.env.PCO_PAT_ID + ':' + process.env.PCO_PAT_SECRET).toString('base64');
async function pco(path, method = 'GET') {
  const r = await fetch('https://api.planningcenteronline.com/people/v2' + path, {
    method, headers: { Authorization: auth, Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.status === 204 ? null : r.json();
}

const hits = await pco('/emails?where[address]=' + encodeURIComponent(LUC_EMAIL) + '&per_page=1');
const person = await pco('/emails/' + hits.data[0].id + '/person');
const pid = person.data.id;
const fd = await pco(`/people/${pid}/field_data?include=field_definition`);
const forged = fd.data.filter(d => d.relationships.field_definition.data.id === '1104573');
console.log('\n=== PCO STATE after harness: Forged tab =', forged.map(d => `${d.id}:${d.attributes.value}`));
console.log('    EXPECTED exactly one: Free');

for (const d of forged) {
  await pco(`/people/${pid}/field_data/${d.id}`, 'DELETE');
}
const after = await pco(`/people/${pid}/field_data`);
const remaining = after.data.filter(d => d.relationships.field_definition.data.id === '1104573');
console.log('=== CLEANUP: remaining Forged data =', remaining.length === 0 ? 'none (clean)' : remaining);

const kitBody = JSON.parse(results[3].body);
const kitRepeat = JSON.parse(results[4].body);
const ok =
  results[0].status === 422 && results[1].status === 422 &&
  results[2].status === 200 && JSON.parse(results[2].body).ok === true &&
  results[3].status === 409 && kitBody.ok === false && kitBody.error === SOLD_OUT_ERROR &&
  results[4].status === 409 && kitRepeat.ok === false && kitRepeat.error === SOLD_OUT_ERROR &&
  remaining.length === 0 &&
  results[5] && results[5].noListRun === true &&
  results[6] && results[6].listRunStatus === 204;
console.log('\n' + (ok ? 'ALL HARNESS TESTS PASSED' : 'HARNESS FAILURES PRESENT'));
process.exit(ok ? 0 : 1);