// Cloudflare Pages Function: POST /api/register
// Writes the "2026" checkbox (Free / Forged Kit) on the person's Forged tab
// in Planning Center People after a forgedconf.com registration.
//
// Required project env vars (Pages project -> Settings -> Variables & Secrets):
//   PCO_PAT_ID      Planning Center Personal Access Token client ID
//   PCO_PAT_SECRET  Planning Center Personal Access Token secret
// The PAT never reaches the browser; this function is the only caller.

const PCO = 'https://api.planningcenteronline.com/people/v2';
const FORGED_FIELD_ID = '1104573'; // People > Fields tab "Forged" > checkboxes field "2026"
const PATH_VALUES = { free: 'Free', kit: 'Forged Kit' }; // must match field_options exactly
const FORGED_LIST_IDS = { free: '5315047', kit: '5315090' }; // 2026 Forged Free / 2026 Forged Kit
const LIST_RUN_DELAY_MS = 15000; // let PCO index the new field_data before refreshing lists

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Refresh the Forged list so PCO list automations (Registrations +
// confirmation email) fire within seconds/minutes of a registration.
async function scheduleListRun(auth, listId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(LIST_RUN_DELAY_MS);
  try {
    const resp = await fetch(PCO + '/lists/' + listId + '/run', {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    console.log('[register] list run ' + listId + ' -> ' + resp.status);
  } catch (err) {
    console.error('[register] list run ' + listId + ' failed: ' + (err && err.message));
  }
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request body.' });
  }

  // Honeypot: the "website" input is hidden from humans; bots fill it.
  if (body.website) {
    return json(200, { ok: true });
  }

  const first = String(body.first_name || '').trim().slice(0, 50);
  const last = String(body.last_name || '').trim().slice(0, 50);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 100);
  const path = body.path;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!first || !last || !emailOk || !PATH_VALUES[path]) {
    return json(422, { ok: false, error: 'Missing or invalid registration details.' });
  }

  if (!env.PCO_PAT_ID || !env.PCO_PAT_SECRET) {
    console.error('[register] Missing PCO_PAT_ID / PCO_PAT_SECRET env vars');
    return json(502, {
      ok: false,
      error: 'We could not save your registration. Please try again in a moment.',
    });
  }

  const auth = 'Basic ' + btoa(env.PCO_PAT_ID + ':' + env.PCO_PAT_SECRET);

  async function pco(pathAndQuery, options = {}) {
    const resp = await fetch(PCO + pathAndQuery, {
      ...options,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error('PCO ' + resp.status + ' on ' + pathAndQuery + ': ' + text.slice(0, 300));
    }
    return resp.json();
  }

  try {
    // 1) Resolve the person by email address. Prefer the profile where this
    //    is the PRIMARY email (the person most likely registering), then
    //    fall back to any profile holding the address (shared inboxes).
    const q = encodeURIComponent(email);
    let hits = await pco('/emails?where[address]=' + q + '&where[primary]=true&per_page=1');
    if (!hits || !hits.data || !hits.data.length) {
      hits = await pco('/emails?where[address]=' + q + '&per_page=1');
    }
    let personId = null;

    if (hits && hits.data && hits.data.length) {
      const person = await pco('/emails/' + hits.data[0].id + '/person');
      personId = person && person.data ? person.data.id : null;
    }

    if (!personId) {
      // 2) No profile with that email: create one.
      const created = await pco('/people', {
        method: 'POST',
        body: JSON.stringify({
          data: { type: 'Person', attributes: { first_name: first, last_name: last } },
        }),
      });
      personId = created.data.id;
    }

    // 3) Idempotency: skip if this value is already checked on the Forged tab.
    const existing = await pco('/people/' + personId + '/field_data?per_page=100');
    const alreadyChecked =
      existing &&
      existing.data &&
      existing.data.some(
        (d) =>
          d.attributes &&
          d.attributes.value === PATH_VALUES[path] &&
          d.relationships &&
          d.relationships.field_definition &&
          d.relationships.field_definition.data &&
          d.relationships.field_definition.data.id === FORGED_FIELD_ID
      );

    let newlyChecked = false;
    if (!alreadyChecked) {
      // 4) Check the box. A POST with an exact existing option value never
      //    creates a new field option; it links the option to this person.
      await pco('/people/' + personId + '/field_data', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'FieldDatum',
            attributes: {
              field_definition_id: FORGED_FIELD_ID,
              value: PATH_VALUES[path],
            },
          },
        }),
      });
      newlyChecked = true;
    }

    if (newlyChecked && env.RUN_LIST_REFRESH === 'true') {
      (waitUntil || ((p) => p))(scheduleListRun(auth, FORGED_LIST_IDS[path]));
    }

    return json(200, { ok: true, person_id: personId });
  } catch (err) {
    console.error('[register] ' + (err && err.message));
    return json(502, {
      ok: false,
      error: 'We could not save your registration. Please try again in a moment.',
    });
  }
}