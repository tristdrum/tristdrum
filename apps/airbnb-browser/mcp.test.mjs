import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./mcp.mjs";
import { agentsApiConnection } from "./agents-adapter.mjs";

test("Agents API adapter uses environment none and service-origin narrow MCP", () => {
  const connection = agentsApiConnection("https://pilot.example/mcp", "x".repeat(40));
  assert.deepEqual(connection.environment, { type: "none" });
  assert.equal(connection.tool.connection_origin, "service");
  assert.equal(connection.tool.required, true);
  assert.equal(connection.tool.allowed_tools.length, 5);
  assert.throws(() => agentsApiConnection("http://pilot.example/mcp", "x".repeat(40)), /HTTPS/);
  assert.throws(() => agentsApiConnection("https://pilot.example/mcp?url=other", "x".repeat(40)), /HTTPS/);
});

test("authenticated remote MCP exposes only read tools and calls them", async () => {
  const service = {
    read: (kind) => ({ source: "airbnb_host_website", fetchedAt: "2026-09-24T10:00:00Z", complete: true, kind,
      threads: kind === "messages" ? [{ threadId: "123", unitNumber: 1, messages: [{ id: "m1", sentAt: "2026-09-24T08:00:00Z", body: "Synthetic text" }] }] : undefined }),
    refresh: async () => ({ calendar: { ok: true }, messages: { ok: true } }),
    status: () => ({ pilot: "read_only", auth: "configured" }),
    recordMcpOutput: async () => {},
    reserveAgentCost: async (maxUsd) => ({ modelUsd: maxUsd }),
    ready: () => false,
  };
  const server = createApp(service, "a".repeat(40)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  try {
    const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    const health = await fetch(new URL("/healthz", url));
    assert.deepEqual(await health.json(), { alive: true, ready: false, pilot: "read_only" });
    const ready = await fetch(new URL("/readyz", url), { headers: { Authorization: `Bearer ${"a".repeat(40)}` } });
    assert.equal(ready.status, 503);
    const scheduledRefresh = await fetch(new URL("/refresh/messages", url), { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(40)}` } });
    assert.equal(scheduledRefresh.status, 200);
    const reserve = await fetch(new URL("/budget/reserve-agent", url), { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(40)}`, "Content-Type": "application/json" }, body: JSON.stringify({ maxUsd: 0.25 }) });
    assert.equal((await reserve.json()).budget.modelUsd, 0.25);
    const metrics = await fetch(new URL("/metrics", url), { headers: { Authorization: `Bearer ${"a".repeat(40)}` } });
    assert.equal((await metrics.json()).pilot, "read_only");
    const client = new Client({ name: "pilot-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${"a".repeat(40)}` } } });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((item) => item.name).sort(), [
        "get_calendar_snapshot", "get_message_snapshot", "get_pilot_status", "list_message_threads", "refresh_before_plan",
      ]);
      const calendar = await client.callTool({ name: "get_calendar_snapshot", arguments: { unitNumber: 1 } });
      assert.equal(calendar.structuredContent.kind, "calendar");
      const index = await client.callTool({ name: "list_message_threads", arguments: {} });
      assert.equal(index.structuredContent.threads[0].threadId, "123");
      const thread = await client.callTool({ name: "get_message_snapshot", arguments: { threadId: "123" } });
      assert.equal(thread.structuredContent.threads[0].messages[0].body, "Synthetic text");
      const refresh = await client.callTool({ name: "refresh_before_plan", arguments: {} });
      assert.equal(refresh.structuredContent.complete, true);
    } finally { await client.close(); }
  } finally { server.close(); await once(server, "close"); }
});
