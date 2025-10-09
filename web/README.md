# Tristan Drummond · Web

A black, cinematic single-page React experience for [tristdrum.com](https://tristdrum.com). The site blends floating gradients, glassmorphism cards, and humble copy to reflect Tristan’s calm-yet-epic craft.

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

## Deployment

1. `npm run build` to populate `dist/`.
2. Upload the folder to a static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages).
3. Point `tristdrum.com` to the deployment and confirm HTTPS + OG previews render.
