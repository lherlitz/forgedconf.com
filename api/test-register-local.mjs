// Local harness: exercises functions/api/register.js with mocked Request/env
// against the LIVE Planning Center API, then cleans up.
import { readFileSync } from 'node:fs';
import { onRequestPost as handler } from '/Users/lucasherlitz/Code/forged/functions/api/register.js';

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

// 4) Valid kit registration -> 200 + real PCO write
results.push(await run('VALID KIT REGISTRATION', new Request('http://x/api/register', {
  method: 'POST',
  body: JSON.stringify({ first_name: 'Luc', last_name: 'Herlitz', email: LUC_EMAIL, phone: '555-0123', path: 'kit' })
})));

// 5) Repeat same registration -> 200 (idempotency path, no duplicate datum)
results.push(await run('IDEMPOTENT REPEAT', new Request('http://x/api/register', {
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
console.log('    EXPECTED exactly one: Forged Kit');

for (const d of forged) {
  await pco(`/people/${pid}/field_data/${d.id}`, 'DELETE');
}
const after = await pco(`/people/${pid}/field_data`);
const remaining = after.data.filter(d => d.relationships.field_definition.data.id === '1104573');
console.log('=== CLEANUP: remaining Forged data =', remaining.length === 0 ? 'none (clean)' : remaining);

const ok =
  results[0].status === 422 && results[1].status === 422 &&
  results[2].status === 200 && JSON.parse(results[2].body).ok === true &&
  results[3].status === 200 && JSON.parse(results[3].body).ok === true &&
  results[4].status === 200 && remaining.length === 0 &&
  results[5] && results[5].noListRun === true &&
  results[6] && results[6].listRunStatus === 204;
console.log('\n' + (ok ? 'ALL HARNESS TESTS PASSED' : 'HARNESS FAILURES PRESENT'));
process.exit(ok ? 0 : 1);