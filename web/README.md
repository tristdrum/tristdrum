# Tristan Drummond · Web

A black single-page React experience for [tristdrum.com](https://tristdrum.com). The site blends floating gradients, glassmorphism cards, and humble copy to reflect Tristan’s calm-yet-epic craft.

## Features

- Layered hero with stat badges, motion-driven halos, and dual CTAs.
- Focus, labs, timeline, and signal sections powered by structured TypeScript arrays for quick edits and deep links (WorkWeek, Tech Local, Champ Foundation).
- Accurate storytelling for WorkWeek, Tech Local, Champ Foundation, and ongoing lab experiments.
- Responsive CSS grid layout with glassmorphism accents, plus reduced-motion safeguards.
- SEO-ready metadata plus typography via Space Grotesk and Manrope.

## Quick start

```bash
cd web
npm install
npm run dev
```

Visit `http://localhost:5173` to explore the site locally. Vite 5 supports Node `>=18`, so Node `20.18` runs smoothly without extra steps.

## Scripts

| Command            | Description                                |
| ------------------ | ------------------------------------------ |
| `npm run dev`      | Start the development server with HMR.     |
| `npm run build`    | Type-check and emit a production bundle.   |
| `npm run test`     | Run Task Pulse status derivation tests.    |
| `npm run preview`  | Preview the built bundle locally.          |
| `npm run lint`     | Run ESLint with the shared configuration.  |

## Project structure

```
web/
├── public/         # static assets (favicons, og images)
├── src/
│   ├── App.tsx     # page composition & content data
│   ├── App.css     # layout, gradients, animations
│   ├── index.css   # base tokens & typography
│   └── main.tsx    # React entrypoint
└── dist/           # production output (gitignored)
```

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

## Deployment

1. `npm run build` to populate `dist/`.
2. Upload the folder to a static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages).
3. Point `tristdrum.com` to the deployment and confirm HTTPS + OG previews render.
