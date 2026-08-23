set lock_timeout = '5s';
set statement_timeout = '60s';

with legacy(target_date, message_hash, sent_at) as (
  values
    ('2026-07-01'::date, '0b3a84d510b679c0'::text, '2026-06-30T15:45:27.219Z'::timestamptz),
    ('2026-07-02'::date, 'bfd40789654fcdab'::text, '2026-07-01T11:06:05.189Z'::timestamptz),
    ('2026-07-03'::date, '45528cfa8a386003'::text, '2026-07-02T11:43:38.976Z'::timestamptz),
    ('2026-07-04'::date, 'ec69c4b4f093241f'::text, '2026-07-03T11:45:07.854Z'::timestamptz),
    ('2026-07-06'::date, 'e482106b14e30c6d'::text, '2026-07-05T11:32:10.360Z'::timestamptz),
    ('2026-07-07'::date, 'a2ce1b6328c9f2c1'::text, '2026-07-06T11:32:02.254Z'::timestamptz),
    ('2026-07-07'::date, 'b5b5bb1904f2dafe'::text, '2026-07-06T12:10:31.633Z'::timestamptz),
    ('2026-07-08'::date, '7a2af5ad1e037e5d'::text, '2026-07-07T11:31:35.701Z'::timestamptz),
    ('2026-07-09'::date, '52744183663e2375'::text, '2026-07-08T11:31:33.842Z'::timestamptz),
    ('2026-07-11'::date, '58cafe8dfe4f476d'::text, '2026-07-10T11:31:47.515Z'::timestamptz),
    ('2026-07-12'::date, '67cfcd076debc20c'::text, '2026-07-11T11:31:37.740Z'::timestamptz),
    ('2026-07-14'::date, '80a86a91a9514da8'::text, '2026-07-13T15:47:18.806Z'::timestamptz),
    ('2026-07-15'::date, '5586575d6eb61abe'::text, '2026-07-14T11:31:35.321Z'::timestamptz),
    ('2026-07-16'::date, '2d1ebe123f180640'::text, '2026-07-15T11:31:29.077Z'::timestamptz),
    ('2026-07-17'::date, '6a26a6ecc0376612'::text, '2026-07-16T11:31:46.264Z'::timestamptz),
    ('2026-07-18'::date, '1632453bc42b5891'::text, '2026-07-17T11:33:23.224Z'::timestamptz),
    ('2026-07-19'::date, '2ebc98f20c947897'::text, '2026-07-18T11:31:52.088Z'::timestamptz),
    ('2026-07-20'::date, '89dab4f035f353d9'::text, '2026-07-19T11:31:43.541Z'::timestamptz),
    ('2026-07-21'::date, '7894a7c00bca99c9'::text, '2026-07-20T11:31:50.960Z'::timestamptz),
    ('2026-07-22'::date, '5b23a9a7dac27cbb'::text, '2026-07-21T11:31:24.268Z'::timestamptz),
    ('2026-07-23'::date, '7dcbf21f572fdb19'::text, '2026-07-22T11:31:20.537Z'::timestamptz),
    ('2026-07-24'::date, '9517ba9221161d36'::text, '2026-07-23T11:31:27.401Z'::timestamptz),
    ('2026-07-25'::date, '7288e003ab272ad0'::text, '2026-07-24T11:31:21.262Z'::timestamptz),
    ('2026-07-26'::date, 'e52c4a2baa09735b'::text, '2026-07-25T11:31:26.982Z'::timestamptz),
    ('2026-07-27'::date, '53d3f004f2d798a2'::text, '2026-07-26T11:31:43.987Z'::timestamptz),
    ('2026-07-28'::date, '2d74d61a58cf5f2e'::text, '2026-07-27T11:31:19.426Z'::timestamptz),
    ('2026-07-28'::date, '53f8a7ef2895ebca'::text, '2026-07-28T10:32:18.630Z'::timestamptz),
    ('2026-07-29'::date, 'e0934e2315583790'::text, '2026-07-28T11:31:15.932Z'::timestamptz),
    ('2026-07-29'::date, 'c791f15bf4bd8d42'::text, '2026-07-29T10:01:38.212Z'::timestamptz),
    ('2026-07-30'::date, '26d851ccc8740cdb'::text, '2026-07-29T11:31:28.536Z'::timestamptz),
    ('2026-07-30'::date, 'e8c22fca67e23dc9'::text, '2026-07-30T10:02:01.274Z'::timestamptz),
    ('2026-07-31'::date, '90911a02e80503c5'::text, '2026-07-30T11:32:03.180Z'::timestamptz),
    ('2026-07-31'::date, '50313d6f1755403a'::text, '2026-07-31T10:02:56.268Z'::timestamptz),
    ('2026-08-01'::date, '489c731289fb7727'::text, '2026-07-31T11:32:14.278Z'::timestamptz),
    ('2026-08-02'::date, 'd5df9f4f8565ff06'::text, '2026-08-01T11:32:55.022Z'::timestamptz),
    ('2026-08-03'::date, 'a48b041ca3c32247'::text, '2026-08-02T11:31:41.025Z'::timestamptz),
    ('2026-08-03'::date, 'fba9cc55cb9dbcd8'::text, '2026-08-03T10:02:19.995Z'::timestamptz),
    ('2026-08-04'::date, '08890a6f4d08587f'::text, '2026-08-03T11:31:38.110Z'::timestamptz),
    ('2026-08-04'::date, 'ef6ee1b716b82fbc'::text, '2026-08-04T10:02:11.847Z'::timestamptz),
    ('2026-08-05'::date, '07ad7564c6c6feaa'::text, '2026-08-04T11:31:45.516Z'::timestamptz)
), target_household as (
  select id
  from public.households
  where name = 'Harewood Household'
  order by created_at, id
  limit 1
)
insert into airbnb.cleaner_plans (
  household_id, run_id, target_date, mode, delivery_status, message_hash,
  message_text, is_update, unit_states, confidence, source_cutoff_at,
  started_at, completed_at, sent_at, created_at
)
select
  target_household.id,
  'legacy:' || legacy.target_date::text || ':' || legacy.message_hash,
  legacy.target_date,
  'live',
  'sent',
  legacy.message_hash,
  null,
  false,
  '[]'::jsonb,
  '{"importedFrom":"legacy_jsonl"}'::jsonb,
  legacy.sent_at,
  legacy.sent_at,
  legacy.sent_at,
  legacy.sent_at,
  legacy.sent_at
from legacy
cross join target_household
on conflict (household_id, target_date, message_hash) do nothing;
