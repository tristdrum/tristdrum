import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { createAirbnbDatabase, sendManagementNotification } from "@tristdrum/airbnb-db";
import { supportRuntimeCapabilities } from "./runtime.mjs";

export async function sendOperatorManagementNotice(input, { env = process.env, database = null,
  send = sendManagementNotification } = {}) {
  if (env.AIRBNB_MANAGEMENT_NOTICE_CONFIRMATION !== "SEND_AIRBNB_MANAGEMENT_NOTICE"
    || !supportRuntimeCapabilities(env).managementAlertsEnabled) {
    throw new Error("Operator Management sends require explicit confirmation and enabled live Management delivery.");
  }
  if (typeof input?.notificationKey !== "string" || !input.notificationKey.trim()
    || typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) {
    throw new Error("Provide a stable notificationKey and a concise text of at most 1000 characters.");
  }
  const db = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  try {
    return await send({sql: db.sql, householdId: await db.householdId(), sourceService: "operator",
      notificationKey: `operator:${input.notificationKey}`, text: input.text, env });
  } finally {
    if (!database) await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await sendOperatorManagementNotice(JSON.parse(readFileSync(0, "utf8")));
    console.log(JSON.stringify(result));
    if (result.whatsappStatus !== "verified" || result.pingStatus !== "accepted") process.exitCode = 1;
  } catch {
    console.error("Management notice failed; reconcile its durable notification record before retrying.");
    process.exitCode = 1;
  }
}
