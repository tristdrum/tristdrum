import { timingSafeEqual } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { SnapshotUnavailableError } from "./service.mjs";

function authorized(request, token) {
  const supplied = request.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAX_TOOL_BYTES = 256 * 1024;

async function toolResult(service, value) {
  const payload = JSON.stringify(value);
  const bytes = Buffer.byteLength(payload);
  if (bytes > MAX_TOOL_BYTES) return toolFailure("result_too_large_use_filter");
  try { await service.recordMcpOutput(bytes * 2 + 2048); }
  catch { return toolFailure("budget_exhausted"); }
  return { content: [{ type: "text", text: payload }], structuredContent: value };
}

function toolFailure(reason) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ available: false, reason }) }] };
}

export function createMcpServer(service) {
  const server = new McpServer({ name: "airbnb-browser-readonly", version: "0.1.0" });
  server.registerTool("get_calendar_snapshot", {
    description: "Read a complete, fresh Airbnb website calendar snapshot. No website navigation or writes.",
    inputSchema: { unitNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() },
  }, async ({ unitNumber }) => {
    try { return await toolResult(service, service.read("calendar", { unitNumber })); }
    catch (error) { return toolFailure(error instanceof SnapshotUnavailableError ? error.message : "unavailable"); }
  });
  server.registerTool("list_message_threads", {
    description: "List fresh guest thread IDs, listing units and message counts without message bodies.",
    inputSchema: {},
  }, async () => {
    try {
      const snapshot = service.read("messages");
      return await toolResult(service, { source: snapshot.source, fetchedAt: snapshot.fetchedAt, complete: true,
        threads: snapshot.threads.map((thread) => ({ threadId: thread.threadId, unitNumber: thread.unitNumber, messageCount: thread.messages.length,
          latestAt: thread.messages.at(-1)?.sentAt ?? null })) });
    } catch (error) { return toolFailure(error instanceof SnapshotUnavailableError ? error.message : "unavailable"); }
  });
  server.registerTool("get_message_snapshot", {
    description: "Read complete, fresh guest message threads from the Airbnb website. No replies or writes.",
    inputSchema: { threadId: z.string().regex(/^\d+$/) },
  }, async ({ threadId }) => {
    try { return await toolResult(service, service.read("messages", { threadId })); }
    catch (error) { return toolFailure(error instanceof SnapshotUnavailableError ? error.message : "unavailable"); }
  });
  server.registerTool("refresh_before_plan", {
    description: "Refresh messages and all three calendars before preparing a booking or guest plan; fails closed on partial data.",
    inputSchema: {},
  }, async () => {
    const result = await service.refresh("all", { force: true });
    if (!result.calendar.ok || !result.messages.ok) return toolFailure("refresh_incomplete");
    return toolResult(service, { complete: true, calendar: result.calendar, messages: result.messages });
  });
  server.registerTool("refresh_calendar_before_plan", {
    description: "Refresh only the three listing calendars for cleaner planning; Messages failure does not suppress valid calendar evidence.",
    inputSchema: {},
  }, async () => {
    const result = await service.refresh("calendar", { force: true });
    if (!result.calendar?.ok) return toolFailure("calendar_refresh_incomplete");
    try {
      const snapshot = service.read("calendar");
      if (snapshot.listings.length !== 3) return toolFailure("calendar_refresh_incomplete");
      return toolResult(service, { complete: true, source: "calendar", fetchedAt: snapshot.fetchedAt, listingCount: 3 });
    } catch { return toolFailure("calendar_refresh_incomplete"); }
  });
  server.registerTool("get_pilot_status", {
    description: "Read pilot freshness, authentication health and budget metrics without guest data.",
    inputSchema: {},
  }, async () => toolResult(service, service.status()));
  return server;
}

export function createApp(service, { mcpToken, operatorToken }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.get("/healthz", (_request, response) => response.json({ alive: true, ready: service.ready(), pilot: "read_only" }));
  const requireToken = (token) => (request, response, next) => {
    if (request.get("origin") || !authorized(request, token)) return response.sendStatus(401);
    next();
  };
  app.use(["/readyz", "/metrics", "/refresh", "/budget"], requireToken(operatorToken));
  app.get("/readyz", (_request, response) => response.status(service.ready() ? 200 : 503).json({ ready: service.ready() }));
  app.get("/readyz/:kind", (request, response) => {
    if (!["calendar", "messages"].includes(request.params.kind)) return response.sendStatus(404);
    const ready = service.sourceReady(request.params.kind);
    return response.status(ready ? 200 : 503).json({ source: request.params.kind, ready });
  });
  app.get("/metrics", (_request, response) => response.json(service.status()));
  app.post("/refresh/:kind", async (request, response) => {
    if (!["messages", "calendar"].includes(request.params.kind)) return response.sendStatus(404);
    try {
      const result = await service.refresh(request.params.kind);
      return response.status(result[request.params.kind].ok ? 200 : 503).json(result[request.params.kind]);
    } catch { return response.status(503).json({ ok: false, reason: "refresh_failed" }); }
  });
  app.post("/budget/reserve-agent", async (request, response) => {
    try { return response.json({ reserved: true, budget: await service.reserveAgentCost(request.body?.maxUsd) }); }
    catch { return response.status(402).json({ reserved: false, reason: "budget_unavailable" }); }
  });
  app.post("/mcp", requireToken(mcpToken), async (request, response) => {
    const server = createMcpServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) response.status(500).json({ error: "MCP request failed" });
    } finally {
      await transport.close();
      await server.close();
    }
  });
  app.all("/mcp", (_request, response) => response.sendStatus(405));
  return app;
}
