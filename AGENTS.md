# FORGED 2026: The Quest — Life Chapel Toledo Men's Conference

Static marketing + registration site for the one-day men's conference (Nov 7, 2026, 9AM-2PM, Life Chapel Toledo), live at **forgedconf.com**. Retro 8-bit / dark-fantasy identity: monochromatic green palette (Game Boy / phosphor CRT), RPG quest terminology throughout ("QUEST", "LVL", "PRESS START", "ACCEPT QUEST").

## Layout

- `index.html` — landing page (`<body class="landing">`): hero with typewriter quest dialog, about, 4 sessions, agenda timeline, speakers, activities, merch, registration pricing.
- `register.html` — multi-screen registration flow (`<body class="register">`): start → character (name/email/phone) → path (free / $35 kit) → level-up add-ons → confirm → complete. All client-side, single inline `<script>`.
- `style.css` — shared stylesheet for both pages; page-specific rules scoped under `body.landing` / `body.register`.
- `images/` — forged-og.png (OG/social), forged-thequest-logo-light.png, grant-perry.png, favicons, apple-touch-icon.
- `CNAME` — `forgedconf.com` (GitHub Pages custom domain).

## Build & test

**No build step, no package.json, no tests, no linter.** Plain HTML/CSS/vanilla JS. Verification is manual: open the files in a browser (or `python3 -m http.server` from the repo root) and click through both pages, including the full register flow and mobile widths.

## Deploy

`git push` to `origin` (github.com:lherlitz/forgedconf.com, branch `main`) — GitHub Pages serves the repo root. **Every push goes live immediately.** No staging, no CI.

## Conventions

- All styling in `style.css` using the `:root` green palette vars (`--green`, `--fg`, `--border`, etc.) — never hardcode hex greens in HTML.
- Fonts: VT323 (mono/terminal text), Cinzel (serif headings), Inter (body), and self-hosted Dogica Pixel (pixel headings/buttons via `fonts/dogicapixel.woff2`). Press Start 2P was replaced to avoid Adobe-only licensing.
- Section labels follow the pattern `- - THE QUEST - -`; buttons/CTAs are ALL-CAPS game prompts.
- Images referenced as relative `images/...` paths; OG/Twitter meta use absolute `https://forgedconf.com/...` URLs.
- JS is inline per page (no external scripts). Keep it that way — no framework.
- Commit messages: short imperative summaries of the visual/UX change (e.g. "Replace INSERT COIN with PRESS SPACE / TAP TO CONTINUE (responsive)").

## Pitfalls

- **Registration backend (real, 2026-08-27).** `register.html` POSTs to `/api/register` (Cloudflare Pages Function in `functions/api/register.js`), which resolves the person in Planning Center People by email (creates a profile if none) and checks the Free or Forged Kit box on the "Forged" tab (field definition `1104573`). Requires `PCO_PAT_ID` + `PCO_PAT_SECRET` env vars (secrets) on the Pages project. Cloudflare chosen over Vercel because its free tier permits commercial use. Payment is NOT collected online: after the list refresh (on-registration trigger + 15-min backstop cron), PCO automations email each registrant a confirmation with payment instructions; the kit is $40 at the door while supplies last.
- **Deploy is split-brained until cutover.** GitHub Pages currently serves the domain and knows nothing about `/api/register`: pushing `register.html` to `origin/main` before Cloudflare Pages serves forgedconf.com would ship a broken registration form. Deploy to Cloudflare Pages first, point forgedconf.com at Cloudflare (Namecheap nameservers -> Cloudflare, then custom domain on the Pages project), then push.
- No `.gitignore` — `.DS_Store` is untracked; don't commit it.
- The site is public and church-facing: no AI-tooling references, no ticket IDs, no dev jargon in page copy.
- Speakers/agenda facts (Grant Perry, Kristian Vaculik, Pastor Jonathan Perry; $35 kit, $40 at door, Oct 17 pre-order deadline) are real event details — verify changes with Luc before editing.
