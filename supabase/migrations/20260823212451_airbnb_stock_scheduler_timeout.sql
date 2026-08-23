set lock_timeout = '5s';
set statement_timeout = '60s';

do $scheduler$
declare
  scheduler record;
begin
  for scheduler in
    select jobid, command
    from cron.job
    where jobname in (
      'airbnb-stock-email-poll-30m',
      'airbnb-stock-email-poll-1900-utc',
      'airbnb-stock-weekly-review-0700-utc',
      'airbnb-stock-management-alerts-10-40'
    )
  loop
    if position('timeout_milliseconds := 180000' in scheduler.command) = 0 then
      raise exception 'Unexpected Airbnb stock scheduler command for job %', scheduler.jobid;
    end if;
    perform cron.alter_job(
      scheduler.jobid,
      command := replace(
        scheduler.command,
        'timeout_milliseconds := 180000',
        'timeout_milliseconds := 600000'
      )
    );
  end loop;
end
$scheduler$;
