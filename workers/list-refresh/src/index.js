// Backstop: refresh both Forged lists every 15 minutes so PCO list
// automations (Registrations + confirmation email) fire even when a
// registration didn't trigger the on-write refresh (or someone checked
// the box manually in PCO).
const PCO = 'https://api.planningcenteronline.com/people/v2';
const LIST_IDS = ['5315047', '5315090']; // 2026 Forged Free, 2026 Forged Kit

export default {
  async scheduled(controller, env, ctx) {
    const auth = 'Basic ' + btoa(env.PCO_PAT_ID + ':' + env.PCO_PAT_SECRET);
    ctx.waitUntil((async () => {
      for (const id of LIST_IDS) {
        try {
          const r = await fetch(`${PCO}/lists/${id}/run`, {
            method: 'POST',
            headers: { Authorization: auth, Accept: 'application/json' },
          });
          console.log(`list ${id} run -> ${r.status}`);
        } catch (e) {
          console.error(`list ${id} run failed: ${e && e.message}`);
        }
      }
    })());
  },
};