alter table public.opening_drill_progress
add column if not exists last_attempt_id uuid;

create or replace function public.record_opening_drill_attempt_atomic(
  p_profile_id uuid,
  p_node_id text,
  p_correct boolean,
  p_attempt_id uuid
)
returns table(node_id text, mastery_score integer, applied boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.opening_drill_progress (
    profile_id,
    node_id,
    seen_count,
    correct_count,
    miss_count,
    mastery_score,
    last_attempt_id,
    last_seen_at,
    updated_at
  )
  values (
    p_profile_id,
    p_node_id,
    1,
    case when p_correct then 1 else 0 end,
    case when p_correct then 0 else 1 end,
    case when p_correct then 18 else 0 end,
    p_attempt_id,
    now(),
    now()
  )
  on conflict on constraint opening_drill_progress_pkey do update
  set
    seen_count = opening_drill_progress.seen_count + 1,
    correct_count = opening_drill_progress.correct_count + case when p_correct then 1 else 0 end,
    miss_count = opening_drill_progress.miss_count + case when p_correct then 0 else 1 end,
    mastery_score = greatest(
      0,
      least(100, opening_drill_progress.mastery_score + case when p_correct then 18 else -22 end)
    ),
    last_attempt_id = p_attempt_id,
    last_seen_at = now(),
    updated_at = now()
  where opening_drill_progress.last_attempt_id is distinct from p_attempt_id
  returning opening_drill_progress.node_id, opening_drill_progress.mastery_score, true;

  if not found then
    return query
    select progress.node_id, progress.mastery_score, false
    from public.opening_drill_progress as progress
    where progress.profile_id = p_profile_id and progress.node_id = p_node_id;
  end if;
end;
$$;

revoke all on function public.record_opening_drill_attempt_atomic(uuid, text, boolean, uuid) from public;
grant execute on function public.record_opening_drill_attempt_atomic(uuid, text, boolean, uuid) to service_role;
