create schema if not exists private;

create table if not exists public.rewarded_ad_daily_usage(
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_date date not null,
  completed_count integer not null default 0 check(completed_count >= 0 and completed_count <= 10),
  earned_amount numeric(12,2) not null default 0 check(earned_amount >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,reward_date)
);

create table if not exists public.rewarded_ad_claims(
  claim_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_date date not null,
  reward_amount numeric(12,2) not null default 5 check(reward_amount = 5),
  status text not null default 'pending' check(status in ('pending','completed','expired','rejected')),
  transaction_id text unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists rewarded_ad_claims_user_date_idx
on public.rewarded_ad_claims(user_id,reward_date,status);

create or replace function public.start_rewarded_ad()
returns table(claim_id uuid,reward_date date,ads_completed integer,ads_remaining integer)
language plpgsql
as $f$
declare
  uid uuid := auth.uid();
  d date := (now() at time zone 'Asia/Kolkata')::date;
  completed integer;
  pending integer;
  new_claim uuid;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;

  insert into public.rewarded_ad_daily_usage(user_id,reward_date)
  values(uid,d) on conflict (user_id,reward_date) do nothing;

  select completed_count into completed
  from public.rewarded_ad_daily_usage
  where user_id=uid and reward_date=d
  for update;

  select count(*)::integer into pending
  from public.rewarded_ad_claims
  where user_id=uid
    and reward_date=d
    and status='pending'
    and created_at > now()-interval '15 minutes';

  if completed + pending >= 10 then
    raise exception 'DAILY_AD_LIMIT_REACHED';
  end if;

  insert into public.rewarded_ad_claims(user_id,reward_date)
  values(uid,d)
  returning rewarded_ad_claims.claim_id into new_claim;

  return query select new_claim,d,completed,10-completed-pending-1;
end$f$;

create or replace function public.cancel_rewarded_ad(p_claim_id uuid)
returns boolean
language plpgsql
as $f$
begin
  update public.rewarded_ad_claims
  set status='expired'
  where claim_id=p_claim_id
    and user_id=auth.uid()
    and status='pending';
  return found;
end$f$;

create or replace function private.complete_rewarded_ad(
  p_claim_id uuid,
  p_transaction_id text,
  p_reward_amount numeric default 5
)
returns table(ok boolean,user_id uuid,ads_completed integer,ads_remaining integer)
language plpgsql
security definer
set search_path=public
as $f$
declare
  c public.rewarded_ad_claims%rowtype;
  new_count integer;
begin
  if p_reward_amount <> 5 then raise exception 'INVALID_REWARD_AMOUNT'; end if;
  if p_transaction_id is null or length(trim(p_transaction_id)) < 3 then
    raise exception 'INVALID_TRANSACTION_ID';
  end if;

  select * into c
  from public.rewarded_ad_claims
  where claim_id=p_claim_id
  for update;

  if not found then raise exception 'CLAIM_NOT_FOUND'; end if;

  if c.status='completed' then
    select completed_count into new_count
    from public.rewarded_ad_daily_usage
    where user_id=c.user_id and reward_date=c.reward_date;
    return query select true,c.user_id,new_count,10-new_count;
    return;
  end if;

  if c.status <> 'pending' then raise exception 'CLAIM_NOT_PENDING'; end if;

  if c.created_at < now()-interval '15 minutes' then
    update public.rewarded_ad_claims set status='expired'
    where claim_id=c.claim_id;
    raise exception 'CLAIM_EXPIRED';
  end if;

  if exists(
    select 1 from public.rewarded_ad_claims
    where transaction_id=p_transaction_id and claim_id<>c.claim_id
  ) then
    raise exception 'DUPLICATE_TRANSACTION';
  end if;

  insert into public.rewarded_ad_daily_usage(user_id,reward_date)
  values(c.user_id,c.reward_date)
  on conflict (user_id,reward_date) do nothing;

  update public.rewarded_ad_daily_usage
  set completed_count=completed_count+1,
      earned_amount=earned_amount+5,
      updated_at=now()
  where user_id=c.user_id
    and reward_date=c.reward_date
    and completed_count < 10
  returning completed_count into new_count;

  if new_count is null then raise exception 'DAILY_AD_LIMIT_REACHED'; end if;

  update public.rewarded_ad_claims
  set status='completed',
      transaction_id=p_transaction_id,
      completed_at=now()
  where claim_id=c.claim_id;

  update public.wallets
  set available_balance=available_balance+5,
      total_earned=total_earned+5,
      ad_earnings=ad_earnings+5,
      updated_at=now()
  where user_id=c.user_id;

  insert into public.earning_transactions(user_id,type,amount,status,reference_id)
  values(c.user_id,'rewarded_ad',5,'approved',p_transaction_id);

  return query select true,c.user_id,new_count,10-new_count;
end$f$;

alter table public.rewarded_ad_daily_usage enable row level security;
alter table public.rewarded_ad_claims enable row level security;

drop policy if exists "ad daily own read" on public.rewarded_ad_daily_usage;
create policy "ad daily own read"
on public.rewarded_ad_daily_usage
for select to authenticated
using((select auth.uid())=user_id);

drop policy if exists "ad daily own insert" on public.rewarded_ad_daily_usage;
create policy "ad daily own insert"
on public.rewarded_ad_daily_usage
for insert to authenticated
with check((select auth.uid())=user_id);

drop policy if exists "ad claims own read" on public.rewarded_ad_claims;
create policy "ad claims own read"
on public.rewarded_ad_claims
for select to authenticated
using((select auth.uid())=user_id);

drop policy if exists "ad claims own insert" on public.rewarded_ad_claims;
create policy "ad claims own insert"
on public.rewarded_ad_claims
for insert to authenticated
with check((select auth.uid())=user_id);

grant select,insert on public.rewarded_ad_daily_usage,public.rewarded_ad_claims to authenticated;
grant execute on function public.start_rewarded_ad() to authenticated;
grant execute on function public.cancel_rewarded_ad(uuid) to authenticated;
revoke all on function private.complete_rewarded_ad(uuid,text,numeric) from public,anon,authenticated;
