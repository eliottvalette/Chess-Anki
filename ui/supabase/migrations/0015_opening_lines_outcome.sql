alter table public.opening_lines
  add column if not exists outcome text check (outcome in ('win', 'loss', 'draw', 'unknown'));
