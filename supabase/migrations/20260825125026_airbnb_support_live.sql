set lock_timeout = '5s';
set statement_timeout = '60s';

do $migration$
declare
  shadow_job_id bigint;
  live_job_id bigint;
  live_command text;
begin
  select jobid
  into shadow_job_id
  from cron.job
  where jobname = 'airbnb-support-shadow-poll-5m'
  limit 1;

  if shadow_job_id is null then
    raise exception 'The Airbnb support scheduler job is missing.';
  end if;

  live_command := $command$
    select net.http_post(
      url := 'https://tristdrum-airbnb-support.fly.dev/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Airbnb-Support-Scheduler-Secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'tristdrum_airbnb_support_scheduler_secret'
          order by created_at desc
          limit 1
        )
      ),
      body := '{"mode":"live"}'::jsonb,
      timeout_milliseconds := 180000
    ) as request_id;
  $command$;

  perform cron.alter_job(shadow_job_id, active := false);

  select jobid
  into live_job_id
  from cron.job
  where jobname = 'airbnb-support-live-poll-5m'
  limit 1;

  if live_job_id is null then
    live_job_id := cron.schedule(
      'airbnb-support-live-poll-5m',
      '*/5 * * * *',
      live_command
    );
  end if;

  perform cron.alter_job(
    live_job_id,
    schedule := '*/5 * * * *',
    command := live_command,
    active := true
  );
end
$migration$;
