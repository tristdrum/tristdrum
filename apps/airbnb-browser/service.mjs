import { MAX_AGE_MS } from "./config.mjs";
import { budgetStatus, currentBudget, addRuntime, addTransfer, reserveEventModelCost } from "./budget.mjs";
import { EncryptedStore } from "./encrypted-store.mjs";
import { readCalendars, readMessages, AuthExpiredError } from "./browser.mjs";
import { ExtractionError } from "./extract.mjs";

const READERS = Object.freeze({ calendar: readCalendars, messages: readMessages });

export class SnapshotUnavailableError extends Error {
  constructor(reason) { super(reason); this.name = "SnapshotUnavailableError"; }
}

function failureReason(error) {
  if (error instanceof AuthExpiredError) return "auth_expired";
  if (error instanceof ExtractionError) return "layout_or_partial";
  if (/budget/i.test(error.message)) return "budget_exhausted";
  return "browser_failure";
}

export function assertCompleteData(kind, data) {
  if (data?.source !== "airbnb_host_website") throw new ExtractionError("Unexpected snapshot source");
  if (kind === "calendar") {
    const listings = data.listings;
    const statuses = new Set(["past_guests", "upcoming_guests", "current_guests", "pending", "pending_request", "cancelled", "confirmed", "inquiry"]);
    const validReservation = (reservation, unitNumber) => {
      const composition = reservation.guestComposition;
      return reservation.unitNumber === unitNumber && /^[A-Z0-9]{8,16}$/.test(reservation.confirmationCode ?? "") &&
        Boolean(reservation.guestName?.trim()) &&
        /^\d{4}-\d{2}-\d{2}$/.test(reservation.checkIn ?? "") &&
        /^\d{4}-\d{2}-\d{2}$/.test(reservation.checkOut ?? "") && reservation.checkIn < reservation.checkOut &&
        (reservation.guestProfileId === null || /^\d+$/.test(reservation.guestProfileId ?? "")) &&
        statuses.has(reservation.status) && Number.isSafeInteger(reservation.guestCount) && reservation.guestCount >= 1 &&
        Number.isSafeInteger(composition?.adults) && composition.adults >= 1 &&
        Number.isSafeInteger(composition?.children) && composition.children >= 0 &&
        Number.isSafeInteger(composition?.infants) && composition.infants >= 0 &&
        composition.adults + composition.children + composition.infants === reservation.guestCount;
    };
    if (!Array.isArray(listings) || listings.length !== 3 ||
        new Set(listings.map((item) => item.unitNumber)).size !== 3 ||
        listings.some((item) => ![1, 2, 3].includes(item.unitNumber) || item.months?.length !== 3 ||
          item.months.some((month) => month.days?.length < 28) || !Array.isArray(item.reservations) ||
          item.reservations.some((reservation) => !validReservation(reservation, item.unitNumber)))) {
      throw new ExtractionError("Calendar snapshot is partial");
    }
  } else if (!Array.isArray(data.threads) ||
      new Set(data.threads.map((item) => item.threadId)).size !== data.threads.length ||
      data.threads.some((item) => !item.threadId || ![1, 2, 3].includes(item.unitNumber) || !Array.isArray(item.messages))) {
    throw new ExtractionError("Messages snapshot is partial");
  }
}

export class BrowserPilotService {
  constructor(config, { store = new EncryptedStore(config.statePath, config.dataKey), readers = READERS, now = () => new Date() } = {}) {
    this.config = config;
    this.store = store;
    this.readers = readers;
    this.now = now;
    this.state = null;
    this.inFlight = Promise.resolve();
    this.runtimeAccountedAt = null;
  }

  async init() {
    const stored = await this.store.read();
    this.state = { auth: stored.auth ?? null, snapshots: stored.snapshots ?? {}, attempts: stored.attempts ?? {},
      budget: currentBudget(stored.budget, this.now()), counts: stored.counts ?? { refreshes: 0, failures: 0 } };
    this.runtimeAccountedAt = this.now();
  }

  #accountRuntime(now) {
    const seconds = Math.max(0, (now.getTime() - this.runtimeAccountedAt.getTime()) / 1000);
    this.state.budget = addRuntime(this.state.budget, seconds, now);
    this.runtimeAccountedAt = now;
  }

  flushRuntime() {
    const run = async () => {
      this.#accountRuntime(this.now());
      await this.store.write(this.state);
    };
    const result = this.inFlight.then(run);
    this.inFlight = result.catch(() => {});
    return result;
  }

  refresh(kind, { force = false } = {}) {
    if (!["calendar", "messages", "all"].includes(kind)) throw new Error("Unknown refresh kind");
    const run = async () => {
      const kinds = kind === "all" ? ["messages", "calendar"] : [kind];
      const results = {};
      for (const item of kinds) results[item] = await this.#refreshOne(item, force);
      return results;
    };
    const result = this.inFlight.then(run);
    this.inFlight = result.catch(() => {});
    return result;
  }

  async #refreshOne(kind, force) {
    const now = this.now();
    this.#accountRuntime(now);
    const previous = this.state.attempts[kind];
    if (force && previous?.ok && now.getTime() - Date.parse(previous.at) < 60_000) {
      return { ok: true, reused: true, fetchedAt: this.state.snapshots[kind]?.fetchedAt };
    }
    const attempt = { at: now.toISOString(), ok: false, reason: null };
    try {
      if (!this.state.auth) throw new AuthExpiredError();
      if (budgetStatus(this.state.budget, now).exhausted) throw new Error("Monthly pilot budget exhausted");
      const result = await this.readers[kind](this.config, this.state.auth);
      this.#accountRuntime(this.now());
      this.state.budget = addTransfer(this.state.budget, result.transferredBytes, this.now());
      if (budgetStatus(this.state.budget, this.now()).exhausted) throw new Error("Monthly pilot budget exhausted");
      assertCompleteData(kind, result.data);
      this.state.auth = result.auth;
      this.state.snapshots[kind] = { complete: true, fetchedAt: this.now().toISOString(), data: result.data };
      attempt.ok = true;
      this.state.counts.refreshes += 1;
    } catch (error) {
      this.#accountRuntime(this.now());
      if (Number.isSafeInteger(error.transferredBytes) && error.transferredBytes > 0) {
        this.state.budget = addTransfer(this.state.budget, error.transferredBytes, this.now());
      }
      attempt.reason = failureReason(error);
      this.state.counts.failures += 1;
    }
    this.state.attempts[kind] = attempt;
    await this.store.write(this.state);
    return { ok: attempt.ok, reason: attempt.reason, fetchedAt: this.state.snapshots[kind]?.fetchedAt ?? null };
  }

  read(kind, filter = {}) {
    if (!["calendar", "messages"].includes(kind)) throw new Error("Unknown snapshot kind");
    const attempt = this.state.attempts[kind];
    const snapshot = this.state.snapshots[kind];
    const ageMs = snapshot ? this.now().getTime() - Date.parse(snapshot.fetchedAt) : Infinity;
    if (!attempt?.ok || !snapshot?.complete || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_MS[kind]) {
      throw new SnapshotUnavailableError(attempt?.reason ?? "missing_or_expired");
    }
    if (kind === "calendar") {
      const listings = filter.unitNumber ? snapshot.data.listings.filter((item) => item.unitNumber === filter.unitNumber) : snapshot.data.listings;
      if (!listings.length) throw new SnapshotUnavailableError("listing_not_found");
      return { source: snapshot.data.source, fetchedAt: snapshot.fetchedAt, complete: true, listings };
    }
    const threads = filter.threadId ? snapshot.data.threads.filter((item) => item.threadId === filter.threadId) : snapshot.data.threads;
    if (filter.threadId && !threads.length) throw new SnapshotUnavailableError("thread_not_found");
    return { source: snapshot.data.source, fetchedAt: snapshot.fetchedAt, complete: true, threads };
  }

  recordMcpOutput(bytes) {
    const run = async () => {
      this.#accountRuntime(this.now());
      this.state.budget = addTransfer(this.state.budget, bytes, this.now());
      await this.store.write(this.state);
      if (budgetStatus(this.state.budget, this.now()).exhausted) throw new SnapshotUnavailableError("budget_exhausted");
    };
    const result = this.inFlight.then(run);
    this.inFlight = result.catch(() => {});
    return result;
  }

  reserveAgentCost(maxUsd) {
    const run = async () => {
      this.#accountRuntime(this.now());
      this.state.budget = reserveEventModelCost(this.state.budget, maxUsd, this.now());
      await this.store.write(this.state);
      return budgetStatus(this.state.budget, this.now());
    };
    const result = this.inFlight.then(run);
    this.inFlight = result.catch(() => {});
    return result;
  }

  ready() {
    const status = this.status();
    return status.auth === "configured" && !status.budget.exhausted &&
      Object.values(status.kinds).every((kind) => kind.fresh);
  }

  status() {
    const now = this.now();
    this.#accountRuntime(now);
    const kinds = Object.fromEntries(["calendar", "messages"].map((kind) => {
      const snapshot = this.state.snapshots[kind];
      const attempt = this.state.attempts[kind];
      const ageMs = snapshot ? now.getTime() - Date.parse(snapshot.fetchedAt) : null;
      return [kind, { fetchedAt: snapshot?.fetchedAt ?? null, ageMs,
        complete: Boolean(snapshot?.complete), fresh: Boolean(attempt?.ok && snapshot?.complete && ageMs >= 0 && ageMs <= MAX_AGE_MS[kind]),
        lastAttempt: attempt ?? null }];
    }));
    return { pilot: "read_only", auth: !this.state.auth ? "missing" :
      Object.values(this.state.attempts).some((attempt) => attempt.reason === "auth_expired") ? "expired" : "configured", kinds,
      counts: this.state.counts, budget: budgetStatus(this.state.budget, now) };
  }
}
