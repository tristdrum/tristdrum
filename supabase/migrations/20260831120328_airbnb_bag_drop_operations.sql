set lock_timeout = '5s';
set statement_timeout = '60s';

alter table airbnb.guest_time_requests
  drop constraint guest_time_requests_request_type_check,
  add constraint guest_time_requests_request_type_check check (
    request_type in ('early_checkin', 'late_checkout', 'bag_drop')
  );
