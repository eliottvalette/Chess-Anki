drop table if exists public.repertoire_line_cards cascade;
drop table if exists public.repertoire_variations cascade;
drop table if exists public.repertoire_lines cascade;

create table if not exists public.opening_trees (
  id text primary key,
  owner_profile_id uuid not null references public.training_profiles(id) on delete cascade,
  library text not null check (library in ('white', 'black_vs_e4', 'black_vs_d4', 'black_vs_c4', 'black_vs_n_f3', 'black_other')),
  name text not null,
  root_fen_key text not null,
  root_ply integer not null default 4,
  root_san text[] not null default '{}',
  root_uci text[] not null default '{}',
  source_count integer not null default 0,
  target_depth integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_profile_id, library, root_fen_key)
);

create table if not exists public.opening_nodes (
  id text primary key,
  tree_id text not null references public.opening_trees(id) on delete cascade,
  fen text not null,
  fen_key text not null,
  ply integer not null,
  side_to_move text not null check (side_to_move in ('white', 'black')),
  train_side text not null check (train_side in ('white', 'black')),
  best_uci text,
  best_san text,
  eval_cp integer,
  masters_games integer not null default 0,
  recent_games integer not null default 0,
  card_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tree_id, fen_key)
);

create table if not exists public.opening_edges (
  id text primary key,
  tree_id text not null references public.opening_trees(id) on delete cascade,
  from_node_id text not null references public.opening_nodes(id) on delete cascade,
  to_node_id text not null references public.opening_nodes(id) on delete cascade,
  uci text not null,
  san text not null,
  move_by text not null check (move_by in ('white', 'black')),
  source text not null check (source in ('recent_game', 'card', 'lichess_masters', 'engine_best', 'mixed')),
  recent_count integer not null default 0,
  card_count integer not null default 0,
  masters_games integer not null default 0,
  priority numeric not null default 0,
  is_engine_best boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tree_id, from_node_id, uci)
);

create table if not exists public.opening_drill_progress (
  profile_id uuid not null references public.training_profiles(id) on delete cascade,
  node_id text not null references public.opening_nodes(id) on delete cascade,
  seen_count integer not null default 0,
  correct_count integer not null default 0,
  miss_count integer not null default 0,
  mastery_score integer not null default 0,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, node_id)
);

create index if not exists opening_trees_owner_library_idx on public.opening_trees(owner_profile_id, library);
create index if not exists opening_nodes_tree_ply_idx on public.opening_nodes(tree_id, ply);
create index if not exists opening_nodes_tree_side_idx on public.opening_nodes(tree_id, side_to_move);
create index if not exists opening_edges_tree_from_idx on public.opening_edges(tree_id, from_node_id);
create index if not exists opening_edges_priority_idx on public.opening_edges(tree_id, priority desc);
create index if not exists opening_drill_progress_profile_idx on public.opening_drill_progress(profile_id);

alter table public.opening_trees enable row level security;
alter table public.opening_nodes enable row level security;
alter table public.opening_edges enable row level security;
alter table public.opening_drill_progress enable row level security;

drop policy if exists "Opening trees are API owned" on public.opening_trees;
create policy "Opening trees are API owned"
on public.opening_trees for select
using (false);

drop policy if exists "Opening nodes are API owned" on public.opening_nodes;
create policy "Opening nodes are API owned"
on public.opening_nodes for select
using (false);

drop policy if exists "Opening edges are API owned" on public.opening_edges;
create policy "Opening edges are API owned"
on public.opening_edges for select
using (false);

drop policy if exists "Opening drill progress is API owned" on public.opening_drill_progress;
create policy "Opening drill progress is API owned"
on public.opening_drill_progress for select
using (false);
