import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { sendManagementNotification, retryPendingManagementPings } from "@tristdrum/airbnb-db";
import { loadDeliveryGuardCandidates, loadSuppressedSupportAlerts, storeSupportDraft } from "./repository.mjs";
import { contentFingerprint } from "@tristdrum/airbnb-core";

const url = process.env.AIRBNB_INTEGRATION_DATABASE_URL;
if (url && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Management notification integration tests require a loopback database.");
}

test("real notification state survives Ping failure without repeating WhatsApp", {skip: !url}, async () => {
  const admin = postgres(url, {max: 1, prepare: false, transform: postgres.camel});
  const rollback = new Error("rollback notification fixture");
  try {
    await assert.rejects(admin.begin(async (sql) => {
      const owner = randomUUID(), householdId = randomUUID();
      await sql`insert into auth.users(id,email) values (${owner}, ${`${owner}@example.invalid`})`;
      await sql`insert into public.households(id,name,created_by) values (${householdId}, 'Notification fixture', ${owner})`;
      const text = "Alex, staying 23-25 September, is locked out and needs help now.";
      let whatsapp = 0, pings = 0;
      const options = {sql, householdId, notificationKey: "fixture-alert", text,
        now: () => new Date("2026-09-22T10:00:00Z"),
        sendWhatsApp: async (input) => {
          whatsapp += 1; assert.equal(input.text, text);
          return {verification: {found: true, providerMessageId: "fixture-provider"}};
        },
        sendPing: async (input) => {
          pings += 1; assert.equal(input.body, text); assert.equal(input.urgency, "normal");
          return {accepted: false, status: 503, error: "request_failed", retryable: true};
        }};
      const first = await sendManagementNotification(options);
      assert.equal(first.whatsappStatus, "verified");
      assert.equal(first.pingStatus, "failed");
      await sendManagementNotification(options);
      assert.equal(whatsapp, 1);
      assert.equal(pings, 1);
      const retried = await retryPendingManagementPings({...options,
        now: () => new Date("2026-09-22T10:05:00Z"),
        sendPing: async (input) => {
          pings += 1; assert.equal(input.body, text);
          return {accepted: true, status: 202, requestId: "11111111-1111-4111-8111-111111111111"};
        }});
      assert.equal(retried.notifications[0].pingStatus, "accepted");
      const [stored] = await sql`select * from airbnb.management_notifications where household_id=${householdId}`;
      assert.equal(stored.pingAttemptCount, 2);
      assert.equal(stored.whatsappProviderMessageId, "fixture-provider");
      await retryPendingManagementPings({...options, now: () => new Date("2026-09-23T10:00:00Z")});
      assert.equal(whatsapp, 1); assert.equal(pings, 2);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await admin.end(); }
});

test("notification RLS isolates households and services, with no browser-role access", {skip: !url}, async () => {
  const admin = postgres(url, {max: 1, prepare: false, transform: postgres.camel});
  const rollback = new Error("rollback RLS fixture");
  try {
    await assert.rejects(admin.begin(async (sql) => {
      const owner = randomUUID(), household = randomUUID(), other = randomUUID();
      await sql`insert into auth.users(id,email) values (${owner}, ${`${owner}@example.invalid`})`;
      await sql`insert into public.households(id,name,created_by) values (${household}, 'Notification fixture', ${owner}), (${other}, 'Other fixture', ${owner})`;
      await sql`insert into airbnb.worker_identities(role_name,household_id,service)
        values (session_user,${household},'support') on conflict(role_name)
        do update set household_id=excluded.household_id,service=excluded.service`;
      await sql.unsafe("grant airbnb_support_worker to postgres");
      for (const [h, service, key] of [[household, "support", "owned"], [household, "operator", "operator"],
        [household, "stock", "stock"], [other, "support", "foreign"]]) {
        await sql`insert into airbnb.management_notifications(household_id,source_service,notification_key,text)
          values (${h},${service},${key},'Fixture notice')`;
      }
      const [privileges] = await sql`select
        has_table_privilege('anon','airbnb.management_notifications','select') as anon,
        has_table_privilege('authenticated','airbnb.management_notifications','select') as browser,
        has_table_privilege('airbnb_cleaner_worker','airbnb.management_notifications','select') as cleaner`;
      assert.deepEqual(privileges, {anon: false, browser: false, cleaner: false});
      await sql.unsafe("set local role airbnb_support_worker");
      const visible = await sql`select notification_key from airbnb.management_notifications order by notification_key`;
      assert.deepEqual(visible.map((r) => r.notificationKey), ["operator", "owned"]);
      const updated = await sql`update airbnb.management_notifications set text='Forbidden'
        where household_id=${other} returning id`;
      assert.equal(updated.length, 0);
      await sql.unsafe("reset role");
      await sql`update airbnb.worker_identities set service='stock' where role_name=session_user`;
      await sql.unsafe("grant airbnb_stock_worker to postgres; set local role airbnb_stock_worker");
      assert.deepEqual((await sql`select notification_key from airbnb.management_notifications`).map((r) => r.notificationKey), ["stock"]);
      assert.equal((await sql`update airbnb.management_notifications set text='Forbidden'
        where notification_key='operator' returning id`).length, 0);
      await assert.rejects(sql.savepoint(async (tx) => {
        await tx`update airbnb.management_notifications set source_service='support' where notification_key='stock'`;
      }), /row-level security/);
      await sql.unsafe("reset role");
      throw rollback;
    }), (error) => error === rollback);
  } finally { await admin.end(); }
});

test("version 3 delivery and quiet re-evaluation retire only their own false alert", {skip: !url}, async () => {
  const admin = postgres(url, {max: 1, prepare: false, transform: postgres.camel});
  const rollback = new Error("rollback quiet decision fixture");
  try {
    await assert.rejects(admin.begin(async (sql) => {
      const owner = randomUUID(), householdId = randomUUID(), threadId = randomUUID();
      await sql`insert into auth.users(id,email) values (${owner},${`${owner}@example.invalid`})`;
      await sql`insert into public.households(id,name,created_by) values (${householdId},'Quiet fixture',${owner})`;
      await sql`insert into airbnb.guest_threads(id,household_id,provider_thread_id,status,last_guest_at,source_fingerprint)
        values (${threadId},${householdId},${threadId},'open','2026-09-22T10:00Z','current')`;
      const candidate = {id: threadId, providerThreadId: threadId, guestDisplayName: "Alex",
        stayLabel: "Sep 23 - 25", sourceFingerprint: "current", latestEventAt: "2026-09-22T10:00Z"};
      const first = await storeSupportDraft(sql,{householdId,candidate,shadowMode:false,automaticallyApprove:true,
        now:new Date("2026-09-22T10:01Z"),classification:{topic:"adaptive_support",decisionSource:"adaptive_agent",decisionVersion:3,
          replyNeeded:true,autoReply:true,alertManagement:true,riskTier:"low",summary:"Timing needs checking.",draft:"Thanks."}});
      sql.begin = (callback) => sql.savepoint(callback);
      let queued = await loadDeliveryGuardCandidates(sql,{householdId,now:new Date("2026-09-22T10:02Z")});
      assert.ok(queued.some((d) => d.id === first.id));
      const eligible = await loadSuppressedSupportAlerts(sql,{householdId});
      assert.equal(eligible.length, 1);
      await sql`insert into airbnb.management_notifications(household_id,notification_key,text,whatsapp_status)
        values(${householdId},${`airbnb-support-alert:${contentFingerprint(eligible[0].dedupeKey)}`},'Fixture notice','ambiguous')`;
      assert.equal((await loadSuppressedSupportAlerts(sql,{householdId})).length, 0);
      await sql`update airbnb.reply_deliveries set classification=classification||'{"decisionVersion":2}'::jsonb where id=${first.id}`;
      queued = await loadDeliveryGuardCandidates(sql,{householdId,now:new Date("2026-09-22T10:02Z")});
      assert.ok(!queued.some((d) => d.id === first.id));
      await sql`update airbnb.alerts set status='notified',notified_at='2026-09-22T10:02Z'
        where household_id=${householdId} and details->>'replyDeliveryId'=${first.id}`;
      const unrelated = randomUUID();
      await sql`insert into airbnb.alerts(id,household_id,alert_type,severity,status,dedupe_key,summary,details,notified_at)
        values(${unrelated},${householdId},'guest_escalation','warning','notified',${unrelated},'Air conditioning needs repair',
          ${sql.json({threadId,replyDeliveryId:randomUUID(),requiresManagementAction:true,shadowMode:false,stage:"immediate"})},'2026-09-22T09:00Z')`;
      await storeSupportDraft(sql,{householdId,candidate,shadowMode:false,automaticallyApprove:false,
        now:new Date("2026-09-22T10:03Z"),classification:{topic:"adaptive_support",decisionSource:"adaptive_agent",decisionVersion:3,
          replyNeeded:false,autoReply:false,alertManagement:false,riskTier:"low",summary:"Ordinary self check-in ETA.",draft:null}});
      const ownAlerts = await sql`select status from airbnb.alerts where household_id=${householdId} and details->>'replyDeliveryId'=${first.id}`;
      assert.ok(ownAlerts.length && ownAlerts.every((a) => a.status === "resolved"));
      assert.equal((await sql`select status from airbnb.alerts where id=${unrelated}`)[0].status,"notified");
      assert.equal((await sql`select status from airbnb.guest_threads where id=${threadId}`)[0].status,"needs_human");
      await sql`update airbnb.alerts set status='resolved',resolved_at=now() where id=${unrelated}`;
      await storeSupportDraft(sql,{householdId,candidate,shadowMode:false,automaticallyApprove:false,
        now:new Date("2026-09-22T10:04Z"),classification:{topic:"adaptive_support",decisionSource:"adaptive_agent",decisionVersion:3,
          replyNeeded:false,autoReply:false,alertManagement:false,riskTier:"low",summary:"Ordinary self check-in ETA.",draft:null}});
      assert.equal((await sql`select status from airbnb.guest_threads where id=${threadId}`)[0].status,"handled");
      throw rollback;
    }), (error) => error === rollback);
  } finally { await admin.end(); }
});
