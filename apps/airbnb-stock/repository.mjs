import { contentFingerprint, decideOrderEvidence, setupGuestCount } from "@tristdrum/airbnb-core";

export function learnedUnitPrices(items) {
  const totals = new Map();
  for (const item of items) {
    if (!item.inventorySku || item.creditedQuantity <= 0 || item.lineTotalCents == null) continue;
    const total = totals.get(item.inventorySku) ?? { totalCents: 0, quantity: 0 };
    total.totalCents += item.unitPriceCents == null
      ? item.lineTotalCents
      : item.unitPriceCents * Number(item.quantity ?? 1);
    total.quantity += item.creditedQuantity;
    totals.set(item.inventorySku, total);
  }
  return new Map([...totals].map(([sku, total]) => [sku, Math.round(total.totalCents / total.quantity)]));
}

export function reservationConsumptionRequirements(reservation, inventory) {
  const setupGuests = setupGuestCount({
    adults: reservation.adults,
    children: reservation.children,
    infants: reservation.infants,
    guestCountKnown: reservation.guestCountKnown,
  });
  return inventory
    .map((item) => ({
      ...item,
      quantity: (item.consumptionBasis === "per_stay" ? 1 : setupGuests) * Number(item.quantityPerBasis),
    }))
    .filter((item) => item.quantity > 0);
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ""));
  if (!match) throw new Error("Reservation check-in date is invalid.");
  return match[1];
}

export function requiredStateMovement({ targetQuantity, priorNetQuantity, currentStateQuantity = null }) {
  const requiredQuantity = Number(targetQuantity) - Number(priorNetQuantity);
  if (currentStateQuantity != null && Number(currentStateQuantity) === requiredQuantity) return null;
  return requiredQuantity;
}

export function appendOnlyReconciliation({ targetQuantity, movements }) {
  const currentQuantity = movements.reduce(
    (total, movement) => total + Number(movement.quantityDelta),
    0,
  );
  const transitionQuantity = Number(targetQuantity) - currentQuantity;
  if (transitionQuantity === 0) return null;
  const basis = movements
    .map((movement) => ({
      dedupeKey: movement.dedupeKey,
      quantityDelta: Number(movement.quantityDelta),
    }))
    .sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
  return {
    transitionQuantity,
    basisFingerprint: contentFingerprint(JSON.stringify(basis)),
  };
}

export async function ingestOrderEvidence(sql, { householdId, message, parsed, deliveryDueAt = null }) {
  const decision = decideOrderEvidence({ kind: parsed.kind, deliveryAddress: parsed.deliveryAddress });
  const payload = {
    providerOrderId: parsed.providerOrderId,
    kind: parsed.kind,
    totalCents: parsed.totalCents,
    addressStatus: decision.addressStatus,
    deliveryDueAt,
    delivered: parsed.delivered,
    items: parsed.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      inventorySku: item.inventorySku,
      inventoryQuantityKnown: item.inventoryQuantityKnown,
      creditedQuantity: item.creditedQuantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
  };

  return sql.begin(async (transaction) => {
    const evidenceRows = await transaction`
      insert into airbnb.evidence (
        household_id, mailbox_scope, provider, provider_message_id, sender_address,
        subject, evidence_kind, evidence_subtype, occurred_at, content_hash, normalized_payload
      ) values (
        ${householdId}, 'jane', 'sixty60', ${message.providerMessageId}, ${message.from},
        ${message.subject}, ${parsed.kind === "invoice" ? "invoice" : "order"}, ${parsed.kind},
        ${message.occurredAt}, ${contentFingerprint(JSON.stringify(payload))}, ${transaction.json(payload)}
      )
      on conflict (household_id, mailbox_scope, provider, provider_message_id)
      do update set content_hash = excluded.content_hash,
                    normalized_payload = excluded.normalized_payload,
                    occurred_at = excluded.occurred_at
      returning id
    `;
    const evidenceId = evidenceRows[0].id;
    const nextStatus = decision.ignore ? "ignored"
      : parsed.kind === "invoice" ? "invoiced"
        : "confirmation_received";
    const orderRows = await transaction`
      insert into airbnb.orders (
        household_id, provider, provider_order_id, status, total_cents,
        confirmation_evidence_id, invoice_evidence_id, delivery_address_normalized,
        address_status, delivery_due_at, ordered_at
      ) values (
        ${householdId}, 'checkers_sixty60', ${parsed.providerOrderId}, ${nextStatus}, ${parsed.totalCents},
        ${parsed.kind === "confirmation" ? evidenceId : null},
        ${parsed.kind === "invoice" ? evidenceId : null},
        ${parsed.deliveryAddress}, ${decision.addressStatus}, ${deliveryDueAt}, ${message.occurredAt}
      )
      on conflict (household_id, provider, provider_order_id)
      do update set
        status = case
          when excluded.status in ('invoiced', 'ignored') then excluded.status
          else airbnb.orders.status
        end,
        total_cents = coalesce(excluded.total_cents, airbnb.orders.total_cents),
        confirmation_evidence_id = coalesce(excluded.confirmation_evidence_id, airbnb.orders.confirmation_evidence_id),
        invoice_evidence_id = coalesce(excluded.invoice_evidence_id, airbnb.orders.invoice_evidence_id),
        delivery_address_normalized = coalesce(excluded.delivery_address_normalized, airbnb.orders.delivery_address_normalized),
        address_status = case when excluded.address_status <> 'unknown' then excluded.address_status else airbnb.orders.address_status end,
        delivery_due_at = coalesce(excluded.delivery_due_at, airbnb.orders.delivery_due_at),
        ordered_at = coalesce(airbnb.orders.ordered_at, excluded.ordered_at)
      returning id, status, address_status
    `;
    const order = orderRows[0];
    const inventoryRows = await transaction`
      select id, sku
      from airbnb.inventory_items
      where household_id = ${householdId}
    `;
    const inventoryBySku = new Map(inventoryRows.map((item) => [item.sku, item.id]));

    if (decision.alertManagement) {
      await transaction`
        insert into airbnb.alerts (
          household_id, alert_type, severity, status, dedupe_key, summary, details
        ) values (
          ${householdId}, 'order_update', 'info', 'suppressed',
          ${`sixty60:confirmation:${parsed.providerOrderId}`},
          ${`Sixty60 order ${parsed.providerOrderId} was placed`},
          ${transaction.json({ orderId: order.id, providerOrderId: parsed.providerOrderId, deliveryDueAt })}
        )
        on conflict (household_id, dedupe_key)
        do update set details = excluded.details, updated_at = now()
      `;
    }

    for (const [index, item] of parsed.items.entries()) {
      const inventoryItemId = item.inventorySku ? inventoryBySku.get(item.inventorySku) ?? null : null;
      await transaction`
        insert into airbnb.order_items (
          household_id, order_id, inventory_item_id, provider_line_id,
          description, quantity, stock_unit, line_total_cents, credited_quantity
        ) values (
          ${householdId}, ${order.id}, ${inventoryItemId},
          ${`${parsed.providerOrderId}:${parsed.kind}:${index}`}, ${item.description}, ${item.quantity},
          ${item.inventorySku ? "each" : null}, ${item.lineTotalCents},
          ${decision.creditInventory ? item.creditedQuantity : 0}
        )
        on conflict (household_id, order_id, provider_line_id)
        do update set inventory_item_id = excluded.inventory_item_id,
                      description = excluded.description,
                      quantity = excluded.quantity,
                      line_total_cents = excluded.line_total_cents,
                      credited_quantity = excluded.credited_quantity
      `;
    }

    if (decision.creditInventory) {
      const creditedBySku = new Map();
      const unitPrices = learnedUnitPrices(parsed.items);
      for (const item of parsed.items) {
        if (!item.inventorySku || item.creditedQuantity <= 0) continue;
        creditedBySku.set(item.inventorySku, (creditedBySku.get(item.inventorySku) ?? 0) + item.creditedQuantity);
      }
      const existingCredits = await transaction`
        select distinct inventory.sku
        from airbnb.inventory_movements movement
        join airbnb.inventory_items inventory
          on inventory.household_id = movement.household_id
         and inventory.id = movement.inventory_item_id
        where movement.household_id = ${householdId}
          and movement.order_id = ${order.id}
          and movement.source_type = 'invoice'
      `;
      const reconciledSkus = new Set([
        ...creditedBySku.keys(),
        ...existingCredits.map((movement) => movement.sku),
      ]);
      for (const sku of reconciledSkus) {
        const quantity = creditedBySku.get(sku) ?? 0;
        const inventoryItemId = inventoryBySku.get(sku);
        if (!inventoryItemId) continue;
        const movementRows = await transaction`
          select dedupe_key, quantity_delta
          from airbnb.inventory_movements
          where household_id = ${householdId}
            and order_id = ${order.id}
            and inventory_item_id = ${inventoryItemId}
            and source_type = 'invoice'
          order by dedupe_key
        `;
        const reconciliation = appendOnlyReconciliation({
          targetQuantity: quantity,
          movements: movementRows,
        });
        const unitPriceCents = unitPrices.get(sku);
        if (unitPriceCents != null) {
          await transaction`
            update airbnb.inventory_items
            set target_unit_price_cents = ${unitPriceCents}
            where household_id = ${householdId}
              and id = ${inventoryItemId}
          `;
        }
        if (!reconciliation) continue;
        const { transitionQuantity, basisFingerprint } = reconciliation;
        const stateKey = [
          `sixty60:${parsed.providerOrderId}:${sku}:normalized`,
          `target:${Number(quantity)}`,
          `basis:${basisFingerprint}`,
        ].join(":");
        await transaction`
          insert into airbnb.inventory_movements (
            household_id, inventory_item_id, movement_type, quantity_delta, confidence,
            source_type, source_id, dedupe_key, order_id, occurred_at, note
          ) values (
            ${householdId}, ${inventoryItemId},
            ${transitionQuantity > 0 ? "purchase" : "adjustment"},
            ${transitionQuantity}, 'confirmed', 'invoice', ${evidenceId}, ${stateKey},
            ${order.id}, ${message.occurredAt}, 'Normalized Sixty60 package quantity'
          )
          on conflict (household_id, dedupe_key) do nothing
        `;
      }
      await transaction`
        update airbnb.orders
        set inventory_credited_at = coalesce(inventory_credited_at, ${message.occurredAt})
        where household_id = ${householdId}
          and id = ${order.id}
      `;
      await transaction`
        insert into airbnb.alerts (
          household_id, alert_type, severity, status, dedupe_key, summary, details
        ) values (
          ${householdId}, 'order_update', 'info', 'suppressed',
          ${`sixty60:invoice:${parsed.providerOrderId}`},
          ${`Sixty60 order ${parsed.providerOrderId} was delivered to 1 Bowie`},
          ${transaction.json({ orderId: order.id, providerOrderId: parsed.providerOrderId })}
        )
        on conflict (household_id, dedupe_key) do nothing
      `;
    }

    return {
      providerOrderId: parsed.providerOrderId,
      kind: parsed.kind,
      status: order.status,
      addressStatus: order.addressStatus,
      inventoryCredited: decision.creditInventory,
      ignored: decision.ignore,
      managementAlertCandidate: decision.alertManagement,
      relevantItemCount: parsed.items.filter((item) => item.inventorySku).length,
      unquantifiedItemCount: parsed.items.filter(
        (item) => item.inventorySku && item.inventoryQuantityKnown === false,
      ).length,
    };
  });
}

export async function loadKnownSixty60MessageIds(sql, { householdId, since }) {
  const rows = await sql`
    select provider_message_id
    from airbnb.evidence
    where household_id = ${householdId}
      and mailbox_scope = 'jane'
      and provider = 'sixty60'
      and occurred_at >= ${since}
  `;
  return rows.map((row) => row.providerMessageId);
}

export async function reconcileReservationConsumption(sql, { householdId, throughDate, lookbackDays = 180 }) {
  const [reservations, inventory] = await Promise.all([
    sql`
      select id, booking_status, check_in, adults, children, infants, guest_count_known, revision,
             check_in <= ${throughDate} as is_due
      from airbnb.reservations
      where household_id = ${householdId}
        and (
          check_in between ${throughDate}::date - ${lookbackDays}::integer and ${throughDate}
          or exists (
            select 1
            from airbnb.inventory_movements movement
            where movement.household_id = airbnb.reservations.household_id
              and movement.source_type = 'reservation'
              and movement.source_id = airbnb.reservations.id::text
          )
        )
      order by check_in, id
    `,
    sql`
      select id, sku, consumption_basis, quantity_per_basis
      from airbnb.inventory_items
      where household_id = ${householdId}
        and active
        and consumption_basis in ('per_guest', 'per_stay')
      order by staple_priority, sku
    `,
  ]);
  let applied = 0;
  let reversed = 0;
  for (const reservation of reservations) {
    for (const item of reservationConsumptionRequirements(reservation, inventory)) {
      const quantity = item.quantity;
      const targetQuantity = reservation.bookingStatus === "confirmed" && reservation.isDue ? -quantity : 0;
      const statePhase = targetQuantity < 0 ? "due" : "inactive";
      const stateKey = `reservation:${reservation.id}:${item.sku}:revision:${reservation.revision}:${statePhase}`;
      const existingRows = await sql`
        select
          coalesce(sum(quantity_delta) filter (where dedupe_key <> ${stateKey}), 0) as prior_net_quantity,
          max(quantity_delta) filter (where dedupe_key = ${stateKey}) as current_state_quantity
        from airbnb.inventory_movements
        where household_id = ${householdId}
          and inventory_item_id = ${item.id}
          and source_type = 'reservation'
          and source_id = ${reservation.id}
      `;
      const transitionQuantity = requiredStateMovement({
        targetQuantity,
        priorNetQuantity: existingRows[0].priorNetQuantity,
        currentStateQuantity: existingRows[0].currentStateQuantity,
      });
      if (transitionQuantity == null || transitionQuantity === 0) continue;
      const rows = await sql`
        insert into airbnb.inventory_movements (
          household_id, inventory_item_id, movement_type, quantity_delta,
          confidence, source_type, source_id, dedupe_key, occurred_at, note
        ) values (
          ${householdId}, ${item.id},
          ${targetQuantity < 0 ? "consumption" : "adjustment"},
          ${transitionQuantity}, 'inferred', 'reservation', ${reservation.id}, ${stateKey},
          ${targetQuantity < 0
            ? `${isoDate(reservation.checkIn)}T15:00:00+02:00`
            : `${throughDate}T12:00:00+02:00`},
          ${targetQuantity < 0 ? "Reservation stock allocation" : "Reversed reservation consumption"}
        )
        on conflict (household_id, dedupe_key)
        do update set quantity_delta = excluded.quantity_delta,
                      movement_type = excluded.movement_type,
                      occurred_at = excluded.occurred_at,
                      note = excluded.note
        returning id
      `;
      if (rows.length) {
        if (transitionQuantity < 0) applied += 1;
        else reversed += 1;
      }
    }
  }
  return { applied, reversed };
}

export async function loadForecastInputs(sql, { householdId, startDate, endDate }) {
  const [reservations, inventory] = await Promise.all([
    sql`
      select id, booking_status as status, check_in, adults, children, infants, guest_count_known
      from airbnb.reservations
      where household_id = ${householdId}
        and booking_status = 'confirmed'
        and check_in between ${startDate} and ${endDate}
      order by check_in, property_id
    `,
    sql`
      select id, sku, display_name, category, stock_unit, target_unit_price_cents,
             staple_priority, count_status, quantity_on_hand
      from airbnb.inventory_balances
      where household_id = ${householdId}
        and active
      order by staple_priority, display_name
    `,
  ]);
  return {
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      status: reservation.status,
      checkIn: String(reservation.checkIn),
      adults: reservation.adults,
      children: reservation.children,
      infants: reservation.infants,
      guestCountKnown: reservation.guestCountKnown,
    })),
    inventory: inventory.map((item) => ({
      id: item.id,
      sku: item.sku,
      displayName: item.displayName,
      category: item.category,
      stockUnit: item.stockUnit,
      targetUnitPriceCents: item.targetUnitPriceCents == null ? null : Number(item.targetUnitPriceCents),
      staplePriority: item.staplePriority,
      countStatus: item.countStatus,
      quantityOnHand: Number(item.quantityOnHand),
    })),
  };
}

export async function storeShoppingList(sql, { householdId, forecast, list }) {
  const snapshot = {
    startDate: forecast.startDate,
    endDate: forecast.endDate,
    arrivalCount: forecast.arrivals.length,
    demand: forecast.demand.map(({ sku, rawDemand, bufferedDemand }) => ({ sku, rawDemand, bufferedDemand })),
  };
  return sql.begin(async (transaction) => {
    if (!list.items.length) {
      const superseded = await transaction`
        update airbnb.shopping_lists
        set status = 'superseded', updated_at = now()
        where household_id = ${householdId}
          and status = 'draft'
        returning id
      `;
      if (superseded.length) {
        await transaction`
          update airbnb.alerts
          set status = 'resolved', resolved_at = now(), updated_at = now()
          where household_id = ${householdId}
            and status = 'suppressed'
            and alert_type = 'stock_low'
            and nullif(details->>'shoppingListId', '')::uuid = any(${superseded.map((row) => row.id)}::uuid[])
        `;
      }
      return null;
    }
    const contentHash = contentFingerprint(JSON.stringify({ snapshot, items: list.items }));
    const rows = await transaction`
      insert into airbnb.shopping_lists (
        household_id, forecast_start, forecast_end, estimated_total_cents,
        demand_snapshot, content_hash
      ) values (
        ${householdId}, ${forecast.startDate}, ${forecast.endDate}, ${list.estimatedTotalCents},
        ${transaction.json(snapshot)}, ${contentHash}
      )
      on conflict (household_id, content_hash)
      do update set updated_at = now(),
                    status = case
                      when airbnb.shopping_lists.status = 'superseded' then 'draft'
                      else airbnb.shopping_lists.status
                    end
      returning id, status
    `;
    const shoppingList = rows[0];
    const superseded = await transaction`
      update airbnb.shopping_lists
      set status = 'superseded'
      where household_id = ${householdId}
        and id <> ${shoppingList.id}
        and status = 'draft'
      returning id
    `;
    if (superseded.length) {
      await transaction`
        update airbnb.alerts
        set status = 'resolved', resolved_at = now(), updated_at = now()
        where household_id = ${householdId}
          and status = 'suppressed'
          and alert_type = 'stock_low'
          and nullif(details->>'shoppingListId', '')::uuid = any(${superseded.map((row) => row.id)}::uuid[])
      `;
    }
    for (const item of list.items) {
      const inventoryRows = await transaction`
        select id from airbnb.inventory_items
        where household_id = ${householdId} and sku = ${item.sku}
        limit 1
      `;
      if (!inventoryRows[0]) continue;
      await transaction`
        insert into airbnb.shopping_list_items (
          household_id, shopping_list_id, inventory_item_id, quantity,
          estimated_unit_price_cents, reason, count_to_confirm
        ) values (
          ${householdId}, ${shoppingList.id}, ${inventoryRows[0].id}, ${item.quantity},
          ${item.estimatedUnitPriceCents}, ${item.reason}, ${item.countToConfirm}
        )
        on conflict (household_id, shopping_list_id, inventory_item_id)
        do update set quantity = excluded.quantity,
                      estimated_unit_price_cents = excluded.estimated_unit_price_cents,
                      reason = excluded.reason,
                      count_to_confirm = excluded.count_to_confirm
      `;
    }
    await transaction`
      insert into airbnb.alerts (
        household_id, alert_type, severity, status, dedupe_key, summary, details
      ) values (
        ${householdId}, 'stock_low', 'warning', 'suppressed',
        ${`stock:${forecast.startDate}:${contentHash}`},
        ${`${list.items.length} Airbnb stock item${list.items.length === 1 ? "" : "s"} need attention`},
        ${transaction.json({ shoppingListId: shoppingList.id, countsToConfirm: list.countsToConfirm })}
      )
      on conflict (household_id, dedupe_key)
      do update set status = case
                      when airbnb.alerts.status = 'resolved' then 'suppressed'
                      else airbnb.alerts.status
                    end,
                    summary = excluded.summary,
                    details = excluded.details,
                    resolved_at = case
                      when airbnb.alerts.status = 'resolved' then null
                      else airbnb.alerts.resolved_at
                    end,
                    updated_at = now()
    `;
    return { id: shoppingList.id, status: shoppingList.status, contentHash };
  });
}

export async function storeStockCountReview(sql, { householdId, projections, runDate }) {
  const countsToConfirm = projections
    .filter((item) => item.countToConfirm)
    .map((item) => ({
      sku: item.sku,
      displayName: item.displayName,
      category: item.category,
      stockUnit: item.stockUnit,
    }));
  if (!countsToConfirm.length) return null;
  const rows = await sql`
    insert into airbnb.alerts (
      household_id, alert_type, severity, status, dedupe_key, summary, details
    ) values (
      ${householdId}, 'stock_count_review', 'info', 'suppressed',
      ${`stock-count-review:${runDate}`},
      ${`${countsToConfirm.length} Airbnb stock counts need confirmation`},
      ${sql.json({ countsToConfirm, runDate })}
    )
    on conflict (household_id, dedupe_key)
    do update set summary = excluded.summary,
                  details = excluded.details,
                  updated_at = now()
    returning id, status
  `;
  return rows[0] ?? null;
}

export async function loadSuppressedStockAlerts(sql, {
  householdId,
  limit = 24,
  now = new Date(),
}) {
  return sql`
    select
      alert.id,
      alert.alert_type,
      alert.severity,
      alert.dedupe_key,
      alert.summary,
      alert.details,
      alert.opened_at,
      case when alert.alert_type = 'stock_low' then (
        select jsonb_build_object(
          'id', shopping_list.id,
          'estimatedTotalCents', shopping_list.estimated_total_cents,
          'forecastStart', shopping_list.forecast_start,
          'forecastEnd', shopping_list.forecast_end
        )
        from airbnb.shopping_lists shopping_list
        where shopping_list.household_id = alert.household_id
          and shopping_list.id = nullif(alert.details->>'shoppingListId', '')::uuid
      ) else null end as shopping_list,
      case when alert.alert_type = 'stock_low' then coalesce((
        select jsonb_agg(jsonb_build_object(
          'sku', inventory.sku,
          'displayName', inventory.display_name,
          'stockUnit', inventory.stock_unit,
          'quantity', item.quantity,
          'countToConfirm', item.count_to_confirm
        ) order by inventory.staple_priority, inventory.display_name)
        from airbnb.shopping_list_items item
        join airbnb.inventory_items inventory
          on inventory.household_id = item.household_id
         and inventory.id = item.inventory_item_id
        where item.household_id = alert.household_id
          and item.shopping_list_id = nullif(alert.details->>'shoppingListId', '')::uuid
      ), '[]'::jsonb) else '[]'::jsonb end as items
    from airbnb.alerts alert
    where alert.household_id = ${householdId}
      and alert.status = 'suppressed'
      and alert.alert_type in ('stock_low', 'stock_count_review', 'order_update')
      and (
        (
          alert.alert_type = 'stock_low'
          and exists (
            select 1
            from airbnb.shopping_lists current_list
            where current_list.household_id = alert.household_id
              and current_list.id = nullif(alert.details->>'shoppingListId', '')::uuid
              and current_list.status = 'draft'
              and current_list.updated_at >= ${now}::timestamptz - interval '1 hour'
          )
        )
        or (
          alert.alert_type = 'stock_count_review'
          and alert.updated_at >= ${now}::timestamptz - interval '1 hour'
        )
        or (
          alert.alert_type = 'order_update'
          and exists (
            select 1
            from airbnb.orders current_order
            where current_order.household_id = alert.household_id
              and current_order.id = nullif(alert.details->>'orderId', '')::uuid
              and (
                (
                  alert.dedupe_key like 'sixty60:confirmation:%'
                  and current_order.status = 'confirmation_received'
                  and current_order.ordered_at >= ${now}::timestamptz - interval '24 hours'
                )
                or (
                  alert.dedupe_key like 'sixty60:invoice:%'
                  and current_order.inventory_credited_at >= ${now}::timestamptz - interval '24 hours'
                )
              )
          )
        )
      )
    order by alert.opened_at, alert.id
    limit ${limit}
  `;
}

export async function markStockAlertNotified(sql, {
  householdId,
  alertId,
  idempotencyKey,
  now,
}) {
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update airbnb.alerts
      set status = 'notified', notified_at = ${now}, updated_at = ${now}
      where household_id = ${householdId}
        and id = ${alertId}
        and status = 'suppressed'
        and alert_type in ('stock_low', 'stock_count_review', 'order_update')
      returning id, alert_type, dedupe_key
    `;
    if (!rows[0]) return null;
    await transaction`
      insert into airbnb.audit_events (
        household_id, actor_type, actor_id, action, entity_type, entity_id, details, occurred_at
      ) values (
        ${householdId}, 'worker', 'stock', 'stock_alert_notified', 'alert', ${alertId},
        ${transaction.json({
          alertType: rows[0].alertType,
          alertDedupeKey: rows[0].dedupeKey,
          idempotencyKey,
          verifiedReadback: true,
        })},
        ${now}
      )
    `;
    return { id: rows[0].id, status: "notified" };
  });
}

export async function latestStockRun(sql, householdId) {
  const rows = await sql`
    select run_id, status, receipt, started_at, completed_at
    from airbnb.job_runs
    where household_id = ${householdId} and service = 'stock'
    order by started_at desc
    limit 1
  `;
  return rows[0] ?? null;
}
