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
| `apply-inline.mjs` | Writes Tailwind `className="..."` into TSX (does **not** touch CSS) |

Audit scripts are read-only. `apply-inline.mjs` modifies TSX only.

## Inline migration (what you actually want)

```bash
npm i -D transform-to-tailwindcss-core
node scripts/tailwind-migration/apply-inline.mjs --dry-run components/lab/lab-icons.tsx
node scripts/tailwind-migration/apply-inline.mjs --write components/lab/board/BoardPlayerBar.tsx
```

Avoid `css-to-tailwind-react` big-bang: it strips the CSS module without writing JSX classes.

## Optional sharper dry-run

`dry-run-convert.mjs` auto-uses `transform-to-tailwindcss-core` if installed:

```bash
npm i -D transform-to-tailwindcss-core
npm run migrate:tailwind:dry-run
```

For a full JSX+CSS migrator preview (still dry-run):

```bash
npx css-to-tailwind-react --dry-run ./components
```

Do **not** run without `--dry-run` on this codebase.

## How to read results

- **auto > 60%** at rule level: incremental migration is realistic
- **keep_css > 15%**: keep a thin global CSS layer (`@utility`, React Flow overrides)
- **chess-lab-panels.tsx** usually scores highest destructiveness: migrate it last
- Move `.page` CSS variables to `@theme` before touching JSX
