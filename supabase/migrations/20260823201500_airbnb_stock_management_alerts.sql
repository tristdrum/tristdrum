set lock_timeout = '5s';
set statement_timeout = '60s';

alter table airbnb.alerts
  drop constraint alerts_alert_type_check,
  add constraint alerts_alert_type_check check (
    alert_type in (
      'cleaner_failure', 'confidence_blocked', 'guest_escalation', 'guest_overdue',
      'stock_low', 'stock_count_review', 'order_update'
    )
  );

update airbnb.alerts
set status = 'resolved', resolved_at = now(), updated_at = now()
where status = 'suppressed'
  and alert_type in ('stock_low', 'order_update');

create policy "airbnb stock audit insert"
  on airbnb.audit_events for insert to airbnb_stock_worker
  with check (
    household_id = airbnb.current_household_id()
    and actor_type = 'worker'
    and actor_id = 'stock'
  );

grant insert on table airbnb.audit_events to airbnb_stock_worker;

do $scheduler$
declare
  job_id bigint;
begin
  job_id := cron.schedule(
    'airbnb-stock-management-alerts-10-40',
    '10,40 5-19 * * *',
    format(
      $command$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Airbnb-Stock-Scheduler-Secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'tristdrum_airbnb_stock_scheduler_secret'
              order by created_at desc
              limit 1
            )
          ),
          body := '{"mode":"live","fullReview":false}'::jsonb,
          timeout_milliseconds := 180000
        ) as request_id;
      $command$,
      'https://tristdrum-airbnb-stock.fly.dev/run'
    )
  );
  perform cron.alter_job(job_id, active := false);
end
$scheduler$;
