#!/usr/bin/env node

import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { parseAirbnbConversationEmail } from "@tristdrum/airbnb-core";
import { createAirbnbDatabase } from "@tristdrum/airbnb-db";
import { collectConversationMessages } from "./gmail.mjs";
import { ingestConversation, ingestSupplementalConversation } from "./repository.mjs";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function importMailbox({ database, householdId, mailboxScope, env }) {
  const batchSize = Math.min(500, positiveInteger(env.AIRBNB_SUPPORT_BACKFILL_BATCH_SIZE, 200));
  const maxBatches = Math.min(100, positiveInteger(env.AIRBNB_SUPPORT_BACKFILL_MAX_BATCHES, 50));
  const since = new Date(env.AIRBNB_SUPPORT_BACKFILL_SINCE ?? "2015-01-01T00:00:00Z");
  if (!Number.isFinite(since.getTime())) throw new Error("AIRBNB_SUPPORT_BACKFILL_SINCE is invalid.");
  let afterUid = 0;
  let envelopesFound = 0;
  let conversationsIngested = 0;
  let batches = 0;
  for (; batches < maxBatches; batches += 1) {
    const batch = await collectConversationMessages({
      since,
      maxRead: batchSize,
      afterUid,
      oldestFirst: true,
      mailboxScope,
      env,
    });
    if (!batch.envelopesFound) break;
    envelopesFound += batch.envelopesFound;
    for (const email of batch.messages) {
      const parsed = parseAirbnbConversationEmail(email);
      if (!parsed) continue;
      if (mailboxScope === "tristan") {
        await ingestConversation(database.sql, { householdId, email, parsed });
      } else {
        await ingestSupplementalConversation(database.sql, { householdId, email, parsed });
      }
      conversationsIngested += 1;
    }
    if (batch.lastUid <= afterUid) break;
    afterUid = batch.lastUid;
    if (batch.envelopesFound < batchSize) break;
  }
  return { mailboxScope, batches, envelopesFound, conversationsIngested, lastUid: afterUid };
}

export async function backfillSupportHistory({ env = process.env, database = null } = {}) {
  if (env.AIRBNB_SUPPORT_BACKFILL_CONFIRMATION !== "RUN_WITH_SUPPORT_SCHEDULE_PAUSED") {
    throw new Error("Historical import requires AIRBNB_SUPPORT_BACKFILL_CONFIRMATION=RUN_WITH_SUPPORT_SCHEDULE_PAUSED.");
  }
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  try {
    const householdId = await ownDatabase.householdId();
    const results = [];
    results.push(await importMailbox({ database: ownDatabase, householdId, mailboxScope: "tristan", env }));
    const janeConfigured = Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_USER ?? "").trim())
      && Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD ?? "").trim());
    if (janeConfigured) {
      results.push(await importMailbox({ database: ownDatabase, householdId, mailboxScope: "jane", env }));
    }
    return {
      status: "success",
      mailboxCount: results.length,
      envelopesFound: results.reduce((sum, result) => sum + result.envelopesFound, 0),
      conversationsIngested: results.reduce((sum, result) => sum + result.conversationsIngested, 0),
      results,
    };
  } finally {
    if (!database) await ownDatabase.close();
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const result = await backfillSupportHistory();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
