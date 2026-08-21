alter table airbnb.guest_threads
  add column property_id uuid;

alter table airbnb.guest_threads
  add constraint airbnb_guest_threads_property_fkey
  foreign key (household_id, property_id)
  references airbnb.properties (household_id, id)
  on delete restrict;

create index airbnb_guest_threads_property_idx
  on airbnb.guest_threads (household_id, property_id);
