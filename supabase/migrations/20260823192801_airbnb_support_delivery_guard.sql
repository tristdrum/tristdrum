set lock_timeout = '5s';
set statement_timeout = '60s';

alter table airbnb.reply_deliveries
  add column send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  add column send_attempted_at timestamptz,
  add column last_reconciled_at timestamptz,
  add column last_delivery_error text;

alter table airbnb.reply_deliveries
  drop constraint reply_deliveries_status_check,
  add constraint reply_deliveries_status_check check (
    status in (
      'draft', 'needs_approval', 'approved', 'sending', 'sent',
      'handled_by_human', 'cancelled', 'failed', 'ambiguous'
    )
  );

alter table airbnb.reply_deliveries
  drop constraint airbnb_reply_deliveries_idempotency_key,
  add constraint airbnb_reply_deliveries_idempotency_key
    unique (household_id, idempotency_key);

create index airbnb_reply_deliveries_guard_queue_idx
  on airbnb.reply_deliveries (household_id, status, send_attempted_at, created_at)
  where status in ('approved', 'sending');

create policy "airbnb support audit insert"
  on airbnb.audit_events for insert to airbnb_support_worker
  with check (
    household_id = airbnb.current_household_id()
    and actor_type = 'worker'
    and actor_id = 'support'
  );

grant insert on table airbnb.audit_events to airbnb_support_worker;

create or replace function public.airbnb_review_reply(
  target_delivery_id uuid,
  review_action text,
  edited_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery airbnb.reply_deliveries%rowtype;
begin
  select * into delivery
  from airbnb.reply_deliveries
  where id = target_delivery_id
  for update;
  if not found or not private.has_household_role(delivery.household_id, null) then
    raise exception 'Reply delivery not found.' using errcode = '42501';
  end if;
  if delivery.status = 'ambiguous' then
    if review_action not in ('retry', 'mark_sent', 'cancel') then
      raise exception 'Ambiguous delivery must be marked sent, retried, or cancelled.';
    end if;
  else
    if review_action not in ('save', 'approve', 'cancel') then
      raise exception 'Invalid reply review action.';
    end if;
    if delivery.status in ('sending', 'sent', 'handled_by_human') then
      raise exception 'Reply delivery can no longer be reviewed.';
    end if;
  end if;

  update airbnb.reply_deliveries
  set final_text = case
        when delivery.status = 'ambiguous' then final_text
        else coalesce(edited_text, final_text, draft_text)
      end,
      status = case
        when delivery.status = 'ambiguous' and review_action = 'retry' then 'approved'
        when delivery.status = 'ambiguous' and review_action = 'mark_sent' then 'sent'
        when review_action = 'approve' then 'approved'
        when review_action = 'cancel' then 'cancelled'
        else 'draft'
      end,
      cancellation_reason = case when review_action = 'cancel' then 'Cancelled by household reviewer.' else null end,
      approved_by = case when review_action in ('approve', 'retry') then auth.uid() else approved_by end,
      approved_at = case when review_action in ('approve', 'retry') then now() else approved_at end,
      send_attempt_count = case when review_action = 'retry' then 0 else send_attempt_count end,
      send_attempted_at = case when review_action = 'retry' then null else send_attempted_at end,
      last_delivery_error = case when review_action in ('retry', 'mark_sent', 'cancel') then null else last_delivery_error end,
      provider_sent_message_id = case
        when review_action = 'mark_sent' then coalesce(provider_sent_message_id, outbound_message_id)
        else provider_sent_message_id
      end,
      sent_at = case when review_action = 'mark_sent' then coalesce(sent_at, now()) else sent_at end,
      last_reconciled_at = case
        when review_action in ('retry', 'mark_sent', 'cancel') then now()
        else last_reconciled_at
      end
  where id = target_delivery_id
  returning * into delivery;

  if review_action in ('retry', 'mark_sent', 'cancel') then
    update airbnb.alerts
    set status = 'resolved', resolved_at = now(), updated_at = now()
    where household_id = delivery.household_id
      and status = 'suppressed'
      and details->>'replyDeliveryId' = delivery.id::text;
  end if;

  if review_action in ('mark_sent', 'cancel') then
    update airbnb.guest_threads
    set status = 'handled'
    where household_id = delivery.household_id and id = delivery.thread_id;
  end if;

  insert into airbnb.audit_events (
    household_id, actor_type, actor_id, action, entity_type, entity_id
  ) values (
    delivery.household_id, 'human', auth.uid()::text,
    'reply_' || review_action, 'reply_delivery', delivery.id::text
  );

  return jsonb_build_object('id', delivery.id, 'status', delivery.status, 'updatedAt', delivery.updated_at);
end;
$$;
