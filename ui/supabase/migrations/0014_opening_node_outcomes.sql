alter table public.opening_nodes
  add column if not exists win_count integer not null default 0,
  add column if not exists loss_count integer not null default 0,
  add column if not exists draw_count integer not null default 0;
