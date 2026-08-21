set lock_timeout = '5s';
set statement_timeout = '60s';

create index airbnb_reply_deliveries_approved_by_idx
  on airbnb.reply_deliveries (approved_by)
  where approved_by is not null;
