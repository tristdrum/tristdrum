set lock_timeout = '5s';
set statement_timeout = '60s';

drop policy if exists "airbnb cleaner household access" on airbnb.evidence;
drop policy if exists "airbnb stock household access" on airbnb.evidence;
drop policy if exists "airbnb support household access" on airbnb.evidence;

create policy "airbnb cleaner evidence access"
  on airbnb.evidence for all to airbnb_cleaner_worker
  using (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('confirmed', 'cancelled', 'supplemental', 'ignored')
  )
  with check (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('confirmed', 'cancelled', 'supplemental', 'ignored')
  );
create policy "airbnb stock evidence access"
  on airbnb.evidence for all to airbnb_stock_worker
  using (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('order', 'invoice')
  )
  with check (
    household_id = airbnb.current_household_id()
    and evidence_kind in ('order', 'invoice')
  );
create policy "airbnb support evidence access"
  on airbnb.evidence for all to airbnb_support_worker
  using (
    household_id = airbnb.current_household_id()
    and evidence_kind = 'conversation'
  )
  with check (
    household_id = airbnb.current_household_id()
    and evidence_kind = 'conversation'
  );

drop policy if exists "airbnb cleaner household access" on airbnb.alerts;
drop policy if exists "airbnb stock household access" on airbnb.alerts;
drop policy if exists "airbnb support household access" on airbnb.alerts;

create policy "airbnb cleaner alert access"
  on airbnb.alerts for all to airbnb_cleaner_worker
  using (
    household_id = airbnb.current_household_id()
    and alert_type in ('cleaner_failure', 'confidence_blocked')
  )
  with check (
    household_id = airbnb.current_household_id()
    and alert_type in ('cleaner_failure', 'confidence_blocked')
  );
create policy "airbnb stock alert access"
  on airbnb.alerts for all to airbnb_stock_worker
  using (
    household_id = airbnb.current_household_id()
    and alert_type in ('stock_low', 'order_update')
  )
  with check (
    household_id = airbnb.current_household_id()
    and alert_type in ('stock_low', 'order_update')
  );
create policy "airbnb support alert access"
  on airbnb.alerts for all to airbnb_support_worker
  using (
    household_id = airbnb.current_household_id()
    and alert_type in ('guest_escalation', 'guest_overdue')
  )
  with check (
    household_id = airbnb.current_household_id()
    and alert_type in ('guest_escalation', 'guest_overdue')
  );

drop policy if exists "airbnb cleaner household access" on airbnb.job_runs;
drop policy if exists "airbnb stock household access" on airbnb.job_runs;
drop policy if exists "airbnb support household access" on airbnb.job_runs;

create policy "airbnb cleaner job access"
  on airbnb.job_runs for all to airbnb_cleaner_worker
  using (household_id = airbnb.current_household_id() and service = 'cleaner')
  with check (household_id = airbnb.current_household_id() and service = 'cleaner');
create policy "airbnb stock job access"
  on airbnb.job_runs for all to airbnb_stock_worker
  using (household_id = airbnb.current_household_id() and service = 'stock')
  with check (household_id = airbnb.current_household_id() and service = 'stock');
create policy "airbnb support job access"
  on airbnb.job_runs for all to airbnb_support_worker
  using (household_id = airbnb.current_household_id() and service = 'support')
  with check (household_id = airbnb.current_household_id() and service = 'support');

drop policy if exists "airbnb cleaner household access" on airbnb.audit_events;
drop policy if exists "airbnb stock household access" on airbnb.audit_events;
drop policy if exists "airbnb support household access" on airbnb.audit_events;
revoke all on table airbnb.audit_events
  from airbnb_cleaner_worker, airbnb_stock_worker, airbnb_support_worker;
