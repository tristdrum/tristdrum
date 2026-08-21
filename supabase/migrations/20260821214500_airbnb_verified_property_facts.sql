set lock_timeout = '5s';
set statement_timeout = '60s';

update airbnb.properties property
set facts = property.facts || jsonb_build_object(
  'address', '1 Bowie Street, Nahoon, East London',
  'checkInTime', '15:00',
  'checkOutTime', '10:00'
)
from public.households household
where property.household_id = household.id
  and household.name = 'Harewood Household';
