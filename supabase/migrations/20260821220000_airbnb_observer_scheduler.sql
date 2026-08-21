create extension if not exists pg_cron;
create extension if not exists pg_net;

do $migration$
declare
  scheduler record;
  job_id bigint;
begin
  for scheduler in
    select *
    from (
      values
        (
          'airbnb-stock-email-poll-30m',
          '0,30 5-18 * * *',
          'https://tristdrum-airbnb-stock.fly.dev/run',
          'tristdrum_airbnb_stock_scheduler_secret',
          'X-Airbnb-Stock-Scheduler-Secret',
          '{"mode":"observation","fullReview":false}'::jsonb,
          180000
        ),
        (
          'airbnb-stock-email-poll-1900-utc',
          '0 19 * * *',
          'https://tristdrum-airbnb-stock.fly.dev/run',
          'tristdrum_airbnb_stock_scheduler_secret',
          'X-Airbnb-Stock-Scheduler-Secret',
          '{"mode":"observation","fullReview":false}'::jsonb,
          180000
        ),
        (
          'airbnb-stock-weekly-review-0700-utc',
          '0 7 * * 2',
          'https://tristdrum-airbnb-stock.fly.dev/run',
          'tristdrum_airbnb_stock_scheduler_secret',
          'X-Airbnb-Stock-Scheduler-Secret',
          '{"mode":"observation","fullReview":true}'::jsonb,
          180000
        ),
        (
          'airbnb-support-shadow-poll-5m',
          '*/5 * * * *',
          'https://tristdrum-airbnb-support.fly.dev/run',
          'tristdrum_airbnb_support_scheduler_secret',
          'X-Airbnb-Support-Scheduler-Secret',
          '{"mode":"shadow"}'::jsonb,
          180000
        )
    ) as jobs(
      job_name,
      cron_schedule,
      endpoint,
      vault_secret_name,
      header_name,
      request_body,
      timeout_milliseconds
    )
  loop
    job_id := cron.schedule(
      scheduler.job_name,
      scheduler.cron_schedule,
      format(
        $command$
          select net.http_post(
            url := %L,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              %L, (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = %L
                order by created_at desc
                limit 1
              )
            ),
            body := %L::jsonb,
            timeout_milliseconds := %s
          ) as request_id;
        $command$,
        scheduler.endpoint,
        scheduler.header_name,
        scheduler.vault_secret_name,
        scheduler.request_body::text,
        scheduler.timeout_milliseconds
      )
    );
    perform cron.alter_job(job_id, active := false);
  end loop;
end
$migration$;
