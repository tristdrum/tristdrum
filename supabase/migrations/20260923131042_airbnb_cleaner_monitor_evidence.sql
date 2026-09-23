set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function internal.airbnb_cleaner_delivery_evidence(
  target_household_id uuid,
  target_date date,
  window_started_at timestamptz,
  checked_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  latest airbnb.job_runs%rowtype;
  matching_plan_id uuid;
  evidence_state text;
begin
  select job.* into latest
  from airbnb.job_runs job
  where job.household_id = target_household_id
    and job.service = 'cleaner'
    and job.target_date = airbnb_cleaner_delivery_evidence.target_date
    and job.receipt ->> 'mode' = 'live'
    and job.started_at >= window_started_at
    and job.started_at <= checked_at
  order by job.started_at desc, job.run_id desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('state', 'missing');
  end if;
  if latest.completed_at is null or latest.completed_at > checked_at then
    evidence_state := 'running';
  elsif latest.status = 'blocked' or latest.receipt ->> 'status' = 'blocked'
    or latest.receipt -> 'confidence' -> 'ok' = 'false'::jsonb then
    evidence_state := 'blocked';
  elsif latest.status = 'error' or latest.receipt ->> 'status' = 'error' then
    evidence_state := 'error';
  else
    evidence_state := 'unverified';
    if latest.status in ('sent', 'duplicate_skipped')
      and latest.receipt ->> 'status' = latest.status
      and latest.receipt ->> 'targetDate' = target_date::text
      and latest.receipt -> 'confidence' -> 'ok' = 'true'::jsonb
      and latest.receipt -> 'databaseSync' ->> 'status' = 'synced'
      and latest.receipt -> 'whatsappVerification' -> 'found' = 'true'::jsonb then
      select plan.id into matching_plan_id
      from airbnb.cleaner_plans plan
      where plan.household_id = target_household_id
        and plan.target_date = airbnb_cleaner_delivery_evidence.target_date
        and plan.mode = 'live'
        and plan.id::text = latest.receipt -> 'databaseSync' ->> 'cleanerPlanId'
        and plan.message_hash = latest.receipt ->> 'messageHash'
        and plan.delivery_status in ('sent', 'duplicate_skipped')
        and plan.confidence -> 'ok' = 'true'::jsonb
        and plan.sent_at is not null and plan.sent_at <= checked_at
      limit 1;
      if found then evidence_state := 'verified'; end if;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'state', evidence_state, 'runId', latest.run_id, 'startedAt', latest.started_at,
    'completedAt', latest.completed_at, 'planId', matching_plan_id, 'receipt', latest.receipt
  );
end;
$function$;

revoke all on function internal.airbnb_cleaner_delivery_evidence(uuid, date, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function internal.monitor_airbnb_cleaner(
  target_offset integer,
  window_name text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  target_date date;
  scheduler_secret text;
  monitor_config jsonb;
  target_household_id uuid;
  database_evidence jsonb;
  database_state text;
  status_response extensions.http_response;
  alert_response extensions.http_response;
  alert_read_response extensions.http_response;
  receipt jsonb;
  receipt_status text;
  receipt_started_at timestamptz;
  successful_receipt jsonb;
  successful_receipt_started_at timestamptz;
  window_started_at timestamptz;
  alert_text text;
  alert_url text;
  idempotency_key text;
  alert_found boolean;
  alert_accepted boolean;
  alert_attempt integer;
begin
  if target_offset not in (0, 1) or window_name not in ('today', 'tomorrow') then
    raise exception 'Invalid Airbnb cleaner monitor target.';
  end if;

  target_date := (pg_catalog.now() at time zone 'Africa/Johannesburg')::date + target_offset;
  window_started_at := case window_name
    when 'today' then
      (target_date::timestamp + time '12:00') at time zone 'Africa/Johannesburg'
    else
      ((target_date - 1)::timestamp + time '13:30') at time zone 'Africa/Johannesburg'
  end;

  -- A confirmed database receipt survives a stopped Fly machine or a failed HTTP read.
  select case when count(distinct identity.household_id) = 1
      then (pg_catalog.array_agg(distinct identity.household_id))[1] else null end
  into target_household_id
  from airbnb.worker_identities identity
  where identity.service = 'cleaner';
  begin
    if target_household_id is not null then
      database_evidence := internal.airbnb_cleaner_delivery_evidence(
        target_household_id, target_date, window_started_at, pg_catalog.now()
      );
      database_state := database_evidence ->> 'state';
    end if;
  exception when others then
    database_state := 'unavailable';
  end;

  if database_state = 'verified' then
    return pg_catalog.jsonb_build_object(
      'targetDate', target_date, 'receiptStatus', database_evidence -> 'receipt' ->> 'status',
      'evidenceSource', 'database', 'runId', database_evidence ->> 'runId',
      'planId', database_evidence ->> 'planId', 'alerted', false
    );
  end if;

  select decrypted_secret
  into scheduler_secret
  from vault.decrypted_secrets
  where name = 'tristdrum_airbnb_cleaner_scheduler_secret'
  order by created_at desc
  limit 1;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');

  if database_state in ('blocked', 'error', 'unverified', 'running') then
    receipt := database_evidence -> 'receipt';
    receipt_status := database_state;
    receipt_started_at := nullif(database_evidence ->> 'startedAt', '')::timestamptz;
  else
  begin
    select response.*
    into status_response
    from extensions.http((
      'GET',
      'https://tristdrum-airbnb-cleaner.fly.dev/status?date=' || target_date::text,
      array[
        ('X-Airbnb-Cleaner-Scheduler-Secret', coalesce(scheduler_secret, ''))::extensions.http_header
      ],
      null,
      null
    )::extensions.http_request) as response;

    if status_response.status = 200 then
      receipt := status_response.content::jsonb;
      receipt_status := receipt ->> 'status';
      receipt_started_at := nullif(receipt ->> 'startedAt', '')::timestamptz;
      successful_receipt := case
        when receipt_status in ('sent', 'duplicate_skipped') then receipt
        else receipt -> 'previousSuccess'
      end;
      successful_receipt_started_at := nullif(successful_receipt ->> 'startedAt', '')::timestamptz;
    end if;
  exception when others then
    receipt := null;
    receipt_status := null;
    receipt_started_at := null;
    successful_receipt := null;
    successful_receipt_started_at := null;
  end;
  end if;

  if (
    coalesce(receipt -> 'failureAlert' ->> 'verifiedFromChat', 'false') = 'true'
    and receipt_started_at >= window_started_at
  ) or (
    coalesce(receipt_status, '') not in ('blocked', 'error', 'unverified', 'running')
    and coalesce(successful_receipt ->> 'status', '') in ('sent', 'duplicate_skipped')
    and successful_receipt_started_at >= window_started_at
  )
  then
    return pg_catalog.jsonb_build_object(
      'targetDate', target_date,
      'receiptStatus', receipt_status,
      'alerted', false
    );
  end if;

  select decrypted_secret::jsonb
  into monitor_config
  from vault.decrypted_secrets
  where name = 'tristdrum_airbnb_cleaner_monitor_config'
  order by created_at desc
  limit 1;

  if monitor_config is null
    or coalesce(monitor_config ->> 'baseUrl', '') = ''
    or coalesce(monitor_config ->> 'apiKey', '') = ''
    or coalesce(monitor_config ->> 'accountId', '') = ''
    or coalesce(monitor_config ->> 'alertChatId', '') = ''
    or coalesce(monitor_config ->> 'cleanersChatId', '') = ''
  then
    raise exception 'Airbnb cleaner monitor configuration is incomplete.';
  end if;

  if monitor_config ->> 'alertChatId' = monitor_config ->> 'cleanersChatId' then
    raise exception 'Airbnb cleaner monitor must not alert the cleaners chat.';
  end if;

  alert_url :=
    pg_catalog.rtrim(monitor_config ->> 'baseUrl', '/')
    || '/api/v1/whatsapp/accounts/'
    || (monitor_config ->> 'accountId')
    || '/chats/'
    || (monitor_config ->> 'alertChatId')
    || '/messages';
  alert_text := case
    when receipt_status = 'blocked' then
      'Airbnb cleaner plan is blocked by an occupancy confidence check for '
      || target_date::text
      || '. Check the reservation evidence before cleaning.'
    else
      'The cleaner plan for ' || target_date::text
      || ' needs checking: a successful, verified delivery for this cleaning window could not be confirmed. '
      || 'Check the delivery records before sending another plan.'
  end;
  idempotency_key := 'airbnb-cleaner-monitor:' || window_name || ':' || target_date::text;

  for alert_attempt in 1..3 loop
    alert_accepted := false;
    begin
      select response.*
      into alert_response
      from extensions.http((
        'POST',
        alert_url || '?dry_run=true',
        array[
          ('Content-Type', 'application/json')::extensions.http_header,
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header,
          ('Idempotency-Key', idempotency_key || ':dry-run')::extensions.http_header
        ],
        'application/json',
        pg_catalog.jsonb_build_object('text', alert_text)::text
      )::extensions.http_request) as response;

      if alert_response.status < 200 or alert_response.status >= 300 then
        raise exception 'Airbnb cleaner monitor alert dry-run failed with HTTP %.', alert_response.status;
      end if;

      select response.*
      into alert_response
      from extensions.http((
        'POST',
        alert_url,
        array[
          ('Content-Type', 'application/json')::extensions.http_header,
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header,
          ('Idempotency-Key', idempotency_key)::extensions.http_header
        ],
        'application/json',
        pg_catalog.jsonb_build_object('text', alert_text)::text
      )::extensions.http_request) as response;

      alert_accepted := alert_response.status >= 200 and alert_response.status < 300;
    exception when others then
      alert_accepted := false;
    end;

    perform pg_catalog.pg_sleep(alert_attempt);
    begin
      select response.*
      into alert_read_response
      from extensions.http((
        'GET',
        alert_url || '?limit=20',
        array[
          ('X-Min-API-Key', monitor_config ->> 'apiKey')::extensions.http_header
        ],
        null,
        null
      )::extensions.http_request) as response;

      if alert_read_response.status < 200 or alert_read_response.status >= 300 then
        raise exception 'Airbnb cleaner monitor readback failed with HTTP %.', alert_read_response.status;
      end if;

      select exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          coalesce(alert_read_response.content::jsonb -> 'messages', '[]'::jsonb)
        ) as outbound(message)
        where coalesce(outbound.message ->> 'from_me', 'false') = 'true'
          and outbound.message ->> 'text' = alert_text
      ) into alert_found;
    exception when others then
      alert_found := false;
    end;

    if alert_found then
      return pg_catalog.jsonb_build_object(
        'targetDate', target_date,
        'receiptStatus', receipt_status,
        'alerted', true,
        'transportAccepted', alert_accepted,
        'verifiedFromChat', true,
        'attempts', alert_attempt
      );
    end if;
  end loop;

  raise exception 'Airbnb cleaner monitor alert was not found in chat after all retries.';
end;
$function$;

revoke all on function internal.monitor_airbnb_cleaner(integer, text) from public, anon, authenticated;
