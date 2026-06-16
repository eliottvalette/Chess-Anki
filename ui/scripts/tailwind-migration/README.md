# Tailwind migration probes (read-only)

Three non-destructive scripts to estimate how painful a CSS-module → Tailwind migration would be on the Chess Lab UI.

Inspired by common practice from:

- Tailwind upgrade guide: commit first, review diffs, test visually ([upgrade guide](https://tailwindcss.com/docs/upgrade-guide))
- `@vyeos/css-to-tailwind-react`: `--dry-run --diff` before writing files
- Tailwind v4 `@theme` for design tokens ([theme docs](https://tailwindcss.com/docs/theme))

## Run

From `ui/`:

```bash
npm run migrate:tailwind:audit
```

Or individually:

```bash
npm run migrate:tailwind:audit-css
npm run migrate:tailwind:audit-jsx
npm run migrate:tailwind:dry-run
```

Add `--json` to any script for machine-readable stdout.

Reports are written to `ui/reports/tailwind-migration/`.

## Scripts

| Script | Purpose |
| --- | --- |
| `audit-css-module.mjs` | Classifies CSS rules into `auto / review / manual / keep_css` |
| `audit-jsx-usage.mjs` | Maps `styles.*` usage per file and suggests migration order |
| `dry-run-convert.mjs` | Simulates conversion on isolated `.class` rules only |

Nothing in this folder modifies source files.

## Optional sharper dry-run

`dry-run-convert.mjs` auto-uses `transform-to-tailwindcss-core` if installed:

```bash
npm i -D transform-to-tailwindcss-core
npm run migrate:tailwind:dry-run
```

For a full JSX+CSS migrator preview (still dry-run):

```bash
npx @vyeos/css-to-tailwind-react --dry-run --diff ./components
```

## How to read results

- **auto > 60%** at rule level: incremental migration is realistic
- **keep_css > 15%**: keep a thin global CSS layer (`@utility`, React Flow overrides)
- **chess-lab-panels.tsx** usually scores highest destructiveness: migrate it last
- Move `.page` CSS variables to `@theme` before touching JSX
