# Tristan Drummond · Web

React, TypeScript and Vite application for [tristdrum.com](https://tristdrum.com). The public portfolio is a founder’s practice folio: specific work, verifiable engineering evidence and a direct invitation to get in touch.

## Public experience

- `/`: introduction, WorkWeek and Tech Local, working principles and contact links.
- `/artwork/:id`: existing public artwork IDs, images and audio, with loading, missing, connection-error and media-error states.
- Unknown routes: a useful recovery page linking to the homepage.
- Public styling lives in `src/pages/PublicSite.css`. Commissioner and Source Sans 3 are self-hosted; asset origins and font licences are in [public/ASSETS.md](public/ASSETS.md).
- [PRODUCT.md](../PRODUCT.md) records positioning and sources; [DESIGN.md](../DESIGN.md) records the built visual system.

## Development and validation

Run from the repository root:

```sh
npm --prefix web install
npm --prefix web run dev
npm --prefix web run lint
npm --prefix web run build
npm run airbnb:web:test
npm run airbnb:release:test
```

Use a supported Node release (Node 20 or later). The local app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in an ignored `web/.env.local` or the process environment. Do not commit credentials. Never use a service-role key in a browser variable.

The full release check uses the local database on port 54322 and needs OrbStack on the configured Mac. Never substitute a production database. See [AGENTS.md](../AGENTS.md) for component-specific validation. `npm --prefix web run preview` serves the built bundle.

## Application structure

- `src/App.tsx`: route composition and access gates. Secondary routes load on demand so public visitors do not download internal tools or spreadsheet code. Its explicit `App.css` import preserves internal styles independently of the homepage.
- `src/pages/HomePage.tsx`, `PublicArtwork.tsx`, `NotFoundPage.tsx`: public routes.
- `src/pages/PublicSite.css`: public visual system; unique selectors keep routine public changes from unintentionally restyling operational tools.
- `src/auth/`: session, admin and household access checks.
- `src/App.css`, `src/index.css`: legacy application styles and base defaults.
- `public/`: shipped fonts, images, favicon and social preview.
- `design/social-preview.html`: editable source for the 1200 × 630 social image; preview through Vite at `/design/social-preview.html`, render at that viewport with fonts loaded, and export to `public/social-preview.png`.
- `scripts/build.mjs`: type check, Vite bundle and `dist/version.json` containing only the source commit identifier.

## Task Pulse dashboard

The app now includes a local operations route at `http://localhost:5173/task-pulse`.

- It reads watcher files through a Vite dev API endpoint: `GET /api/task-pulse/state`.
- The endpoint normalizes message-watch state, unresolved summaries, and worker runs into one payload for the UI.
- The page shows:
  - summary cards (`Active claim`, `Pending`, `Done`, `Dead`)
  - a searchable/filterable message list (`message_id`, `status`, `source`)
  - derived status pills (`pending`, `claimed`, `working`, `done`, `dead`)
  - selected-message details (raw excerpt + timeline fields)
  - auto-refresh every 10 seconds plus manual refresh

If the local watcher files are missing, the API returns empty/fallback values so the page still renders.

## Auth + private dashboard

The site now has an intended split:

- `/` and public content stay public
- `/login` handles owner sign-in via password or magic link
- `/dashboard` is the private owner shell for internal tools and future assistant views
- existing sensitive routes should live behind auth/admin gating instead of hidden URLs alone

To finish the Supabase side cleanly:

1. Apply the latest migrations so `site_admins`, `is_site_admin()`, and bootstrap helpers exist.
2. In the hosted Supabase project, disable public self-signup for email auth.
3. Create or invite the owner user.
4. Sign in once and claim the first site-admin slot if prompted.
5. Confirm magic-link redirect URLs include the production `/login` path.

## Household finance hub

The invite-only finance workspace lives at `/dashboard/finance` behind both session and active-household membership checks.

- Read-only V1 views cover source health, the anomaly inbox, current effective ledger allocations, evidence hashes/mirror state, versioned tax scenarios, and accountant-pack status.
- Browser queries select only the columns each screen needs. Evidence filesystem and Storage paths are never requested by the client.
- The interface exposes no finance delete action. Superseded, void, duplicate, private, and not-relevant records remain preserved while current totals use only effective allocations.
- Source, ledger, evidence, review, and scenario panels each handle empty data. Database setup, access denial, loading, refresh, and query failures have explicit states.

## Deployment

The existing Vercel project builds this repository with `web` as its root. GitHub pull requests receive Vercel previews; changes merged into `main` publish to the existing `tristdrum.com` domain. Use this route rather than creating a replacement project or running an unrelated CLI deployment.

1. Run the applicable tests, lint and build. For releases, run `npm run airbnb:release:test`; record any failure accurately and establish whether it predates the change.
2. Visually inspect desktop and phone layouts, keyboard focus, reduced motion, public links, artwork states and anonymous private-route redirects. Keep test fixtures local and out of production.
3. Open a draft PR first. Review the diff, exact remote head and available CI/Vercel checks before marking it ready and merging under the task's release authorization.
4. Verify the merged commit and successful production deployment. Fetch `https://www.tristdrum.com/version.json` and require its `commit` to equal the merge commit; inspect the live public pages and assets before reporting the release as live.

The build reads `VERCEL_GIT_COMMIT_SHA` on Vercel and the local Git HEAD otherwise. Local manifests identify the checkout commit, not uncommitted working-tree changes. Deployment environment variables remain managed by the existing project; a design change does not authorize credential or permission changes.
