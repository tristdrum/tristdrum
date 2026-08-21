import { contentFingerprint, decideOrderEvidence } from "@tristdrum/airbnb-core";

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
      creditedQuantity: item.creditedQuantity,
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
      for (const item of parsed.items) {
        if (!item.inventorySku || item.creditedQuantity <= 0) continue;
        creditedBySku.set(item.inventorySku, (creditedBySku.get(item.inventorySku) ?? 0) + item.creditedQuantity);
      }
      for (const [sku, quantity] of creditedBySku) {
        const inventoryItemId = inventoryBySku.get(sku);
        if (!inventoryItemId) continue;
        await transaction`
          insert into airbnb.inventory_movements (
            household_id, inventory_item_id, movement_type, quantity_delta, confidence,
            source_type, source_id, dedupe_key, order_id, occurred_at
          ) values (
            ${householdId}, ${inventoryItemId}, 'purchase', ${quantity}, 'confirmed',
            'invoice', ${evidenceId}, ${`sixty60:${parsed.providerOrderId}:${sku}`}, ${order.id}, ${message.occurredAt}
          )
          on conflict (household_id, dedupe_key)
          do update set quantity_delta = excluded.quantity_delta,
                        source_id = excluded.source_id,
                        order_id = excluded.order_id,
                        occurred_at = excluded.occurred_at
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
    };
  });
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
  if (!list.items.length) return null;
  const snapshot = {
    startDate: forecast.startDate,
    endDate: forecast.endDate,
    arrivalCount: forecast.arrivals.length,
    demand: forecast.demand.map(({ sku, rawDemand, bufferedDemand }) => ({ sku, rawDemand, bufferedDemand })),
  };
  const contentHash = contentFingerprint(JSON.stringify({ snapshot, items: list.items }));
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      insert into airbnb.shopping_lists (
        household_id, forecast_start, forecast_end, estimated_total_cents,
        demand_snapshot, content_hash
      ) values (
        ${householdId}, ${forecast.startDate}, ${forecast.endDate}, ${list.estimatedTotalCents},
        ${transaction.json(snapshot)}, ${contentHash}
      )
      on conflict (household_id, content_hash)
      do update set updated_at = now()
      returning id, status
    `;
    const shoppingList = rows[0];
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
      on conflict (household_id, dedupe_key) do nothing
    `;
    return { id: shoppingList.id, status: shoppingList.status, contentHash };
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
