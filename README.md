# Tristan Drummond

South African founder and technologist, based in East London. Co-founder and CTO at [WorkWeek](https://www.workweek.tech/), and co-founder at [Tech Local](https://www.techlocal.co.za/).

This repository powers [tristdrum.com](https://tristdrum.com), along with private dashboards and personal application services. The public website introduces my work, the thinking behind it, and ways to get in touch.

## Repository guide

Start with [AGENTS.md](AGENTS.md) for the component map, operating safeguards and validation commands. The [web README](web/README.md) covers the React application and its GitHub-connected Vercel publishing route.

- [Public website brief](PRODUCT.md): audience, positioning and verified content sources.
- [Public design system](DESIGN.md): typography, colour, layout and accessibility conventions.
- [Web application](web/): public portfolio, artwork viewer and authenticated tools.
- [Airbnb applications](apps/): cleaner, stock and support workers; these have separate operational safeguards.
- [Shared packages](packages/): domain logic, database access and finance ingestion.
- [Supabase](supabase/): schema, migrations, generated types and database tests.

## Local website development

From the repository root:

```sh
npm --prefix web install
npm --prefix web run dev
npm --prefix web run lint
npm --prefix web run build
```

See the web README for environment configuration and the full release checks. Keep credentials, raw operational data and finance evidence out of Git.

## Public links

[Website](https://tristdrum.com) · [LinkedIn](https://www.linkedin.com/in/tristdrum/) · [GitHub](https://github.com/tristdrum)
