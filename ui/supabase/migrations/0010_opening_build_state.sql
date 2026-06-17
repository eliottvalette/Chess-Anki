alter table public.opening_trees drop constraint if exists opening_trees_library_check;

alter table public.opening_trees
  add constraint opening_trees_library_check
  check (library in ('e4', 'd4', 'c4', 'nf3', 'other', 'white', 'black_vs_e4', 'black_vs_d4', 'black_vs_c4', 'black_vs_n_f3', 'black_other'));

update public.opening_trees
set library = case library
  when 'white' then 'e4'
  when 'black_vs_e4' then 'e4'
  when 'black_vs_d4' then 'd4'
  when 'black_vs_c4' then 'c4'
  when 'black_vs_n_f3' then 'nf3'
  when 'black_other' then 'other'
  else library
end;

create table if not exists public.opening_build_state (
  profile_id uuid not null references public.training_profiles(id) on delete cascade,
  time_class text not null default 'all',
  last_imported_at timestamptz,
  newest_game_end_time timestamptz,
  oldest_archive_cursor text,
  processed_game_ids jsonb not null default '[]'::jsonb,
  build_mode text not null default 'normal' check (build_mode in ('fast', 'normal', 'backfill', 'extend_depth')),
  target_depth integer not null default 22,
  updated_at timestamptz not null default now(),
  primary key (profile_id, time_class)
);

create index if not exists opening_build_state_profile_idx on public.opening_build_state(profile_id);

alter table public.opening_build_state enable row level security;

drop policy if exists "Opening build state is API owned" on public.opening_build_state;
create policy "Opening build state is API owned"
on public.opening_build_state for select
using (false);
