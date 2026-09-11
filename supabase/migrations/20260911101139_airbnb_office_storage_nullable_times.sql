set lock_timeout = '5s';
set statement_timeout = '60s';

alter table airbnb.guest_time_requests
  alter column requested_time drop not null,
  alter column effective_time drop not null,
  add constraint guest_time_requests_times_required_check check (
    (requested_time is not null and effective_time is not null)
    or (
      request_type = 'bag_drop'
      and coalesce(details->>'action', '') = 'accept_office_storage'
    )
  );
