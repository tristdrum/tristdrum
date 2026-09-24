import assert from "node:assert/strict";
import test from "node:test";
import { BrowserPilotService, SnapshotUnavailableError } from "./service.mjs";
import { AuthExpiredError } from "./browser.mjs";

const calendar = {
  source: "airbnb_host_website",
  listings: [1, 2, 3].map((unitNumber) => ({ unitNumber, listingName: `Studio ${unitNumber}`,
    months: ["2026-09", "2026-10", "2026-11"].map((month) => ({ month, days: Array.from({ length: 30 }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, status: "available" })) })),
    reservations: [] })),
};
const messages = { source: "airbnb_host_website", threads: [{ threadId: "123", unitNumber: 1, messages: [] }] };

function fixtureService() {
  let clock = new Date("2026-09-24T10:00:00Z");
  let calendarResult = calendar;
  let messageResult = messages;
  const storage = { auth: { cookies: [{ name: "session", value: "opaque" }], origins: [] } };
  const store = { read: async () => structuredClone(storage), write: async (value) => Object.assign(storage, structuredClone(value)) };
  const readers = {
    calendar: async (_config, auth) => ({ data: calendarResult, auth, transferredBytes: 100 }),
    messages: async (_config, auth) => {
      if (messageResult instanceof Error) throw messageResult;
      return { data: messageResult, auth, transferredBytes: 100 };
    },
  };
  const service = new BrowserPilotService({}, { store, readers, now: () => clock });
  return { service, setClock: (date) => { clock = new Date(date); }, setCalendar: (data) => { calendarResult = data; }, setMessages: (data) => { messageResult = data; }, storage };
}

test("complete snapshots are fresh only within their distinct TTLs", async () => {
  const { service, setClock } = fixtureService();
  await service.init();
  assert.equal(service.ready(), false);
  assert.deepEqual(await service.refresh("all"), {
    messages: { ok: true, reason: null, fetchedAt: "2026-09-24T10:00:00.000Z" },
    calendar: { ok: true, reason: null, fetchedAt: "2026-09-24T10:00:00.000Z" },
  });
  assert.equal(service.read("calendar").listings.length, 3);
  assert.equal(service.ready(), true);
  assert.equal(service.read("messages", { threadId: "123" }).threads.length, 1);
  setClock("2026-09-24T10:06:00Z");
  assert.equal(service.ready(), false);
  assert.throws(() => service.read("messages"), SnapshotUnavailableError);
  assert.equal(service.read("calendar").listings.length, 3);
  setClock("2026-09-24T10:16:00Z");
  assert.throws(() => service.read("calendar"), SnapshotUnavailableError);
});

test("partial refresh retains old evidence but blocks reads", async () => {
  const { service, setClock, setCalendar, storage } = fixtureService();
  await service.init();
  await service.refresh("calendar");
  setClock("2026-09-24T10:01:00Z");
  setCalendar({ ...calendar, listings: calendar.listings.slice(0, 2) });
  const result = await service.refresh("calendar");
  assert.equal(result.calendar.reason, "layout_or_partial");
  assert.equal(storage.snapshots.calendar.data.listings.length, 3);
  assert.throws(() => service.read("calendar"), SnapshotUnavailableError);
  assert.equal(service.status().kinds.calendar.fresh, false);
});

test("reservation snapshot without reconciled visible guest counts is incomplete", async () => {
  const { service, setCalendar } = fixtureService();
  await service.init();
  setCalendar({ ...calendar, listings: [{ ...calendar.listings[0], reservations: [{
    confirmationCode: "TESTCODE1", unitNumber: 1, checkIn: "2026-09-24", checkOut: "2026-09-25",
    guestProfileId: "000000001", status: "upcoming_guests",
  }] }, ...calendar.listings.slice(1)] });
  assert.equal((await service.refresh("calendar")).calendar.reason, "layout_or_partial");
  assert.throws(() => service.read("calendar"), SnapshotUnavailableError);
});

test("expired login makes message snapshot unavailable even when cached", async () => {
  const { service, setClock, setMessages } = fixtureService();
  await service.init();
  await service.refresh("messages");
  setClock("2026-09-24T10:01:00Z");
  setMessages(new AuthExpiredError());
  const result = await service.refresh("messages");
  assert.equal(result.messages.reason, "auth_expired");
  assert.throws(() => service.read("messages"), SnapshotUnavailableError);
  assert.equal(service.status().kinds.messages.fresh, false);
});

test("a failed browser scan still charges its transferred bytes", async () => {
  const { service, setMessages, storage } = fixtureService();
  await service.init();
  const error = new AuthExpiredError();
  error.transferredBytes = 4096;
  setMessages(error);
  const result = await service.refresh("messages");
  assert.equal(result.messages.reason, "auth_expired");
  assert.equal(storage.budget.transferredBytes, 4096);
});

test("the transfer cap refuses new snapshots and persists exhaustion", async () => {
  const { service, storage } = fixtureService();
  await service.init();
  service.state.budget.transferredBytes = 2 * 1024 ** 3 - 50;
  const result = await service.refresh("calendar");
  assert.equal(result.calendar.reason, "budget_exhausted");
  assert.equal(storage.budget.transferredBytes, 2 * 1024 ** 3 + 50);
  assert.throws(() => service.read("calendar"), SnapshotUnavailableError);
});

test("MCP output counts toward the same persistent monthly cap", async () => {
  const { service, storage } = fixtureService();
  await service.init();
  await service.recordMcpOutput(4096);
  assert.equal(storage.budget.transferredBytes, 4096);
  service.state.budget.transferredBytes = 2 * 1024 ** 3 - 100;
  await assert.rejects(service.recordMcpOutput(200), SnapshotUnavailableError);
  assert.equal(storage.budget.transferredBytes, 2 * 1024 ** 3 + 100);
});

test("Agents API spend must be reserved against the same monthly cap", async () => {
  const { service, storage } = fixtureService();
  await service.init();
  await service.reserveAgentCost(0.5);
  assert.equal(storage.budget.modelUsd, 0.5);
  await assert.rejects(service.reserveAgentCost(9), /budget exhausted/);
  assert.equal(storage.budget.modelUsd, 0.5);
});

test("started runtime is metered and persisted without billing stopped gaps", async () => {
  const { service, setClock, storage } = fixtureService();
  await service.init();
  setClock("2026-09-24T11:00:00Z");
  assert.equal(service.status().budget.startedSeconds, 3600);
  assert.equal(service.status().budget.runtimeUsd, 0.01);
  await service.flushRuntime();
  assert.equal(storage.budget.startedSeconds, 3600);
});
