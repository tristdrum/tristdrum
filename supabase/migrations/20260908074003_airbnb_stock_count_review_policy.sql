begin;
set lock_timeout = '5s';
set statement_timeout = '60s';

alter policy "airbnb stock alert access" on airbnb.alerts
  using (
    household_id = airbnb.current_household_id()
    and alert_type in ('stock_low', 'stock_count_review', 'order_update')
  )
  with check (
    household_id = airbnb.current_household_id()
    and alert_type in ('stock_low', 'stock_count_review', 'order_update')
  );

commit;
