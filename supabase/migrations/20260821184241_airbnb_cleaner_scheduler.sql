create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists http with schema extensions;

create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

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

  select decrypted_secret
  into scheduler_secret
  from vault.decrypted_secrets
  where name = 'tristdrum_airbnb_cleaner_scheduler_secret'
  order by created_at desc
  limit 1;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '10000');

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

  if (
    coalesce(receipt -> 'failureAlert' ->> 'sent', 'false') = 'true'
    and receipt_started_at >= window_started_at
  ) or (
    coalesce(receipt_status, '') <> 'blocked'
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
      'Airbnb cleaner cloud '
      || window_name
      || ' schedule is missing after all retries for '
      || target_date::text
      || '. Check Fly and Supabase before the cleaning window.'
  end;
  idempotency_key := 'airbnb-cleaner-monitor:' || window_name || ':' || target_date::text;

  for alert_attempt in 1..3 loop
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
          ('Idempotency-Key', idempotency_key || ':attempt-' || alert_attempt)::extensions.http_header
        ],
        'application/json',
        pg_catalog.jsonb_build_object('text', alert_text)::text
      )::extensions.http_request) as response;

      if alert_response.status < 200 or alert_response.status >= 300 then
        raise exception 'Airbnb cleaner monitor alert failed with HTTP %.', alert_response.status;
      end if;

      exit;
    exception when others then
      perform pg_catalog.pg_sleep(alert_attempt * 2);
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
          'verifiedFromChat', true
        );
      end if;
      if alert_attempt = 3 then
        raise exception 'Airbnb cleaner monitor alert failed after all retries.';
      end if;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'targetDate', target_date,
    'receiptStatus', receipt_status,
    'alerted', true
  );
end;
$function$;

revoke all on function internal.monitor_airbnb_cleaner(integer, text) from public, anon, authenticated;

do $migration$
declare
  scheduler record;
  job_id bigint;
begin
  for scheduler in
    select *
    from (
      values
        ('airbnb-cleaner-today-1000-utc', '0 10 * * *', 'today', false),
        ('airbnb-cleaner-today-1010-utc', '10 10 * * *', 'today', false),
        ('airbnb-cleaner-today-1020-utc-final', '20 10 * * *', 'today', true),
        ('airbnb-cleaner-tomorrow-1130-utc', '30 11 * * *', 'tomorrow', false),
        ('airbnb-cleaner-tomorrow-1140-utc', '40 11 * * *', 'tomorrow', false),
        ('airbnb-cleaner-tomorrow-1150-utc-final', '50 11 * * *', 'tomorrow', true)
    ) as jobs(job_name, cron_schedule, target_name, final_attempt)
  loop
    job_id := cron.schedule(
      scheduler.job_name,
      scheduler.cron_schedule,
      format(
        $command$
          select net.http_post(
            url := 'https://tristdrum-airbnb-cleaner.fly.dev/run',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Airbnb-Cleaner-Scheduler-Secret', (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'tristdrum_airbnb_cleaner_scheduler_secret'
                order by created_at desc
                limit 1
              )
            ),
            body := jsonb_build_object(
              'mode', 'live',
              'target', %L,
              'finalAttempt', %s
            ),
            timeout_milliseconds := 180000
          ) as request_id;
        $command$,
        scheduler.target_name,
        case when scheduler.final_attempt then 'true' else 'false' end
      )
    );
    perform cron.alter_job(job_id, active := false);
  end loop;
end
$migration$;

do $migration$
declare
  monitor record;
  job_id bigint;
begin
  for monitor in
    select *
    from (
      values
        ('airbnb-cleaner-today-monitor-1050-utc', '50 10 * * *', 0, 'today'),
        ('airbnb-cleaner-tomorrow-monitor-1220-utc', '20 12 * * *', 1, 'tomorrow')
    ) as monitors(job_name, cron_schedule, target_offset, window_name)
  loop
    job_id := cron.schedule(
      monitor.job_name,
      monitor.cron_schedule,
      format(
        'select internal.monitor_airbnb_cleaner(%s, %L);',
        monitor.target_offset,
        monitor.window_name
      )
    );
    perform cron.alter_job(job_id, active := false);
  end loop;
end
$migration$;
