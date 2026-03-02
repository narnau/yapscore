-- Daily API call counter on profiles
alter table public.profiles
  add column api_calls_today   integer     not null default 0,
  add column api_calls_reset_at timestamptz not null default now();

-- Atomic check-and-increment: resets counter when a new UTC day starts,
-- returns true if the call is allowed, false if the daily limit is reached.
create or replace function public.check_and_increment_api_calls(
  p_user_id    uuid,
  p_daily_limit integer
)
returns boolean as $$
declare
  v_reset_date date;
  v_current    integer;
begin
  select
    date(api_calls_reset_at at time zone 'UTC'),
    api_calls_today
  into v_reset_date, v_current
  from public.profiles
  where id = p_user_id
  for update;

  -- New UTC day — reset counter and allow the call
  if v_reset_date < current_date then
    update public.profiles
    set api_calls_today    = 1,
        api_calls_reset_at = now()
    where id = p_user_id;
    return true;
  end if;

  -- Over daily limit
  if v_current >= p_daily_limit then
    return false;
  end if;

  -- Increment and allow
  update public.profiles
  set api_calls_today = api_calls_today + 1
  where id = p_user_id;

  return true;
end;
$$ language plpgsql security definer;
