drop table if exists public.opening_drill_progress cascade;
drop table if exists public.opening_edges cascade;
drop table if exists public.opening_nodes cascade;
drop table if exists public.opening_catalog cascade;
drop table if exists public.opening_graphs cascade;
drop table if exists public.opening_trees cascade;

create table if not exists public.opening_graphs (
  id text primary key,
  owner_profile_id uuid not null references public.training_profiles(id) on delete cascade,
  library text not null check (library in ('e4', 'd4', 'c4', 'nf3', 'other')),
  train_side text not null check (train_side in ('white', 'black')),
  root_fen_key text not null,
  target_depth integer not null default 22,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  catalog_version integer not null default 0,
  built_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_profile_id, library, train_side)
);

create table if not exists public.opening_nodes (
  id text primary key,
  graph_id text not null references public.opening_graphs(id) on delete cascade,
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
  unique (graph_id, fen_key)
);

create table if not exists public.opening_edges (
  id text primary key,
  graph_id text not null references public.opening_graphs(id) on delete cascade,
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
  unique (graph_id, from_node_id, uci)
);

create table if not exists public.opening_catalog (
  id text primary key,
  owner_profile_id uuid not null references public.training_profiles(id) on delete cascade,
  graph_id text not null references public.opening_graphs(id) on delete cascade,
  entry_node_id text not null references public.opening_nodes(id) on delete cascade,
  catalog_ply integer not null default 4,
  library text not null check (library in ('e4', 'd4', 'c4', 'nf3', 'other')),
  fen_key text not null,
  name text not null,
  display_san text[] not null default '{}',
  display_uci text[] not null default '{}',
  source_count integer not null default 0,
  subgraph_node_count integer not null default 0,
  target_depth integer not null default 22,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (graph_id, fen_key, catalog_ply)
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

create index if not exists opening_graphs_owner_idx on public.opening_graphs(owner_profile_id, library, train_side);
create index if not exists opening_nodes_graph_ply_idx on public.opening_nodes(graph_id, ply);
create index if not exists opening_nodes_graph_fen_idx on public.opening_nodes(graph_id, fen_key);
create index if not exists opening_nodes_owner_fen_idx on public.opening_nodes(fen_key);
create index if not exists opening_edges_graph_from_idx on public.opening_edges(graph_id, from_node_id);
create index if not exists opening_catalog_owner_idx on public.opening_catalog(owner_profile_id, catalog_ply);
create index if not exists opening_catalog_graph_idx on public.opening_catalog(graph_id);
create index if not exists opening_catalog_fen_idx on public.opening_catalog(fen_key);
create index if not exists opening_drill_progress_profile_idx on public.opening_drill_progress(profile_id);

alter table public.opening_graphs enable row level security;
alter table public.opening_nodes enable row level security;
alter table public.opening_edges enable row level security;
alter table public.opening_catalog enable row level security;
alter table public.opening_drill_progress enable row level security;

drop policy if exists "Opening graphs are API owned" on public.opening_graphs;
create policy "Opening graphs are API owned"
on public.opening_graphs for select
using (false);

drop policy if exists "Opening nodes are API owned" on public.opening_nodes;
create policy "Opening nodes are API owned"
on public.opening_nodes for select
using (false);

drop policy if exists "Opening edges are API owned" on public.opening_edges;
create policy "Opening edges are API owned"
on public.opening_edges for select
using (false);

drop policy if exists "Opening catalog are API owned" on public.opening_catalog;
create policy "Opening catalog are API owned"
on public.opening_catalog for select
using (false);

drop policy if exists "Opening drill progress is API owned" on public.opening_drill_progress;
create policy "Opening drill progress is API owned"
on public.opening_drill_progress for select
using (false);
