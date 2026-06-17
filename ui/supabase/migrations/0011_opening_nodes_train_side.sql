do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'opening_nodes'
      and column_name = 'train_side'
  ) then
    alter table public.opening_nodes add column train_side text;
    update public.opening_nodes set train_side = side_to_move where train_side is null;
    alter table public.opening_nodes alter column train_side set not null;
    alter table public.opening_nodes
      add constraint opening_nodes_train_side_check check (train_side in ('white', 'black'));
  end if;
end $$;
