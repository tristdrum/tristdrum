export const DEFAULT_DEAD_THRESHOLD_MINUTES = 12

export type TaskPulseDisplayStatus = 'pending' | 'claimed' | 'working' | 'done' | 'dead'

export type TaskPulseActiveClaim = {
  messageId: string
  claimedAt: string | null
  expiresAt: string | null
  workerRunId: string | null
}

export type TaskPulseSummary = {
  tracked: number
  pending: number
  done: number
  activeClaim: TaskPulseActiveClaim | null
  watchdogUpdatedAt: string | null
}

export type TaskPulseMessage = {
  messageId: string
  timestamp: string | null
  status: string
  displayStatus: TaskPulseDisplayStatus
  source: string
  excerpt: string
  sessionKey: string | null
  transcriptPath: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  closedAt: string | null
  respondedAt: string | null
  claimedAt: string | null
  ageMinutes: number | null
  staleMinutes: number | null
  isDead: boolean
  isClaimed: boolean
}

export type TaskPulseStateResponse = {
  generatedAt: string
  summary: TaskPulseSummary
  messages: TaskPulseMessage[]
  activeMessageId: string | null
  deadThresholdMinutes: number
}

export type DeriveTaskPulseInput = {
  stateData?: unknown
  unresolvedData?: unknown
  workerRuns?: unknown[]
  generatedAt?: string
  deadThresholdMinutes?: number
}

export type DeriveDisplayStatusInput = {
  rawStatus: string | null
  isDone: boolean
  isDead: boolean
  isClaimed: boolean
  isActiveClaim: boolean
}

type WorkerRun = {
  runId: string | null
  status: string | null
  startedAt: string | null
  deletedAt: string | null
  task: string | null
  messageId: string | null
}

type UnknownRecord = Record<string, unknown>

const DONE_STATUS = new Set(['done', 'complete', 'completed', 'closed', 'resolved'])
const CLAIMED_STATUS = new Set(['claimed'])
const WORKING_STATUS = new Set(['working', 'in_progress', 'in-progress', 'processing', 'running'])

export function deriveDisplayStatus(input: DeriveDisplayStatusInput): TaskPulseDisplayStatus {
  if (input.isDone) {
    return 'done'
  }

  if (input.isDead) {
    return 'dead'
  }

  if (input.isActiveClaim || normalizeStatus(input.rawStatus) === 'working') {
    return 'working'
  }

  if (input.isClaimed || normalizeStatus(input.rawStatus) === 'claimed') {
    return 'claimed'
  }

  return 'pending'
}

export function deriveTaskPulseState(input: DeriveTaskPulseInput): TaskPulseStateResponse {
  const stateData = asRecord(input.stateData)
  const unresolvedData = asRecord(input.unresolvedData)
  const workerRuns = normalizeWorkerRuns(input.workerRuns ?? [])

  const generatedAt = normalizeIso(input.generatedAt) ?? new Date().toISOString()
  const deadThresholdMinutes = resolveDeadThresholdMinutes(input.deadThresholdMinutes, unresolvedData)
  const doneMessageIds = getStringSet(stateData?.doneMessageIds)
  const activeClaim =
    normalizeActiveClaim(stateData?.activeClaim) ??
    normalizeActiveClaim(unresolvedData?.activeClaim) ??
    normalizeActiveClaimFromWorkerRuns(workerRuns)
  const activeMessageId = activeClaim?.messageId ?? null

  const messageState = asRecord(stateData?.messageState) ?? {}
  const messages = Object.entries(messageState)
    .map(([key, value]) =>
      normalizeMessage({
        key,
        rawValue: value,
        generatedAt,
        deadThresholdMinutes,
        activeMessageId,
        doneMessageIds,
      }),
    )
    .sort((a, b) => compareIsoDesc(firstTimelineTimestamp(b), firstTimelineTimestamp(a)))

  const tracked = messages.length > 0 ? messages.length : getNumber(unresolvedData?.trackedMessagesCount) ?? 0
  const done = messages.length > 0 ? messages.filter((message) => message.displayStatus === 'done').length : getNumber(unresolvedData?.doneCount) ?? 0
  const pending =
    messages.length > 0
      ? messages.filter((message) => message.displayStatus !== 'done' && message.displayStatus !== 'dead').length
      : getNumber(unresolvedData?.pendingCount) ?? 0

  const watchdogUpdatedAt =
    normalizeIso(stateData?.updatedAt) ??
    normalizeIso(unresolvedData?.now) ??
    latestWorkerTimestamp(workerRuns)

  return {
    generatedAt,
    summary: {
      tracked,
      pending,
      done,
      activeClaim,
      watchdogUpdatedAt,
    },
    messages,
    activeMessageId,
    deadThresholdMinutes,
  }
}

function normalizeMessage(params: {
  key: string
  rawValue: unknown
  generatedAt: string
  deadThresholdMinutes: number
  activeMessageId: string | null
  doneMessageIds: Set<string>
}): TaskPulseMessage {
  const record = asRecord(params.rawValue)
  const messageId = asString(record?.messageId) ?? params.key
  const timestamp = normalizeIso(record?.timestamp)
  const firstSeenAt = normalizeIso(record?.firstSeenAt)
  const lastSeenAt = normalizeIso(record?.lastSeenAt)
  const respondedAt = normalizeIso(record?.respondedAt)
  const closedAt = normalizeIso(record?.closedAt) ?? respondedAt
  const claimedAt = normalizeIso(record?.claimedAt)
  const status = asString(record?.status) ?? (params.doneMessageIds.has(messageId) ? 'done' : 'pending')
  const normalizedStatus = normalizeStatus(status)
  const isDone = params.doneMessageIds.has(messageId) || normalizedStatus === 'done'
  const isActiveClaim = params.activeMessageId === messageId
  const isClaimed = isActiveClaim || CLAIMED_STATUS.has(normalizedStatus) || WORKING_STATUS.has(normalizedStatus) || claimedAt !== null
  const staleMinutes = diffMinutes(params.generatedAt, lastSeenAt ?? timestamp ?? firstSeenAt)
  const ageMinutes = diffMinutes(params.generatedAt, timestamp ?? firstSeenAt ?? lastSeenAt)
  const isDead = !isDone && !isClaimed && staleMinutes !== null && staleMinutes >= params.deadThresholdMinutes
  const displayStatus = deriveDisplayStatus({
    rawStatus: normalizedStatus,
    isDone,
    isDead,
    isClaimed,
    isActiveClaim,
  })

  return {
    messageId,
    timestamp,
    status,
    displayStatus,
    source: asString(record?.source) ?? 'unknown',
    excerpt: asString(record?.excerpt) ?? '',
    sessionKey: asString(record?.sessionKey),
    transcriptPath: asString(record?.transcriptPath),
    firstSeenAt,
    lastSeenAt,
    closedAt,
    respondedAt,
    claimedAt,
    ageMinutes,
    staleMinutes,
    isDead,
    isClaimed,
  }
}

function normalizeWorkerRuns(workerRuns: unknown[]): WorkerRun[] {
  return workerRuns
    .map((entry) => {
      const record = asRecord(entry)
      if (!record) {
        return null
      }

      const runId = asString(record.runId)
      const status = asString(record.status)
      const task = asString(record.task)
      const messageId = asString(record.messageId) ?? extractMessageId(task)

      return {
        runId,
        status,
        startedAt: normalizeIso(record.startedAt),
        deletedAt: normalizeIso(record.deletedAt),
        task,
        messageId,
      }
    })
    .filter((run): run is WorkerRun => run !== null)
}

function normalizeActiveClaim(value: unknown): TaskPulseActiveClaim | null {
  if (typeof value === 'string') {
    return {
      messageId: value,
      claimedAt: null,
      expiresAt: null,
      workerRunId: null,
    }
  }

  const record = asRecord(value)
  if (!record) {
    return null
  }

  const messageId = asString(record.messageId) ?? asString(record.message_id) ?? asString(record.id)
  if (!messageId) {
    return null
  }

  return {
    messageId,
    claimedAt:
      normalizeIso(record.claimedAt) ??
      normalizeIso(record.claimed_at) ??
      normalizeIso(record.startedAt) ??
      normalizeIso(record.createdAt),
    expiresAt: normalizeIso(record.expiresAt) ?? normalizeIso(record.expires_at),
    workerRunId: asString(record.workerRunId) ?? asString(record.runId),
  }
}

function normalizeActiveClaimFromWorkerRuns(workerRuns: WorkerRun[]): TaskPulseActiveClaim | null {
  const activeRun = workerRuns
    .filter((run) => run.messageId !== null && isWorkerRunActive(run))
    .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt))[0]

  if (!activeRun || !activeRun.messageId) {
    return null
  }

  return {
    messageId: activeRun.messageId,
    claimedAt: activeRun.startedAt,
    expiresAt: null,
    workerRunId: activeRun.runId,
  }
}

function isWorkerRunActive(run: WorkerRun): boolean {
  if (run.deletedAt) {
    return false
  }

  const normalized = normalizeStatus(run.status)
  if (normalized === 'done') {
    return false
  }

  return !['failed', 'cancelled', 'canceled', 'deleted'].includes(normalized)
}

function latestWorkerTimestamp(workerRuns: WorkerRun[]): string | null {
  const timestamps = workerRuns.flatMap((run) => [run.startedAt, run.deletedAt]).filter((value): value is string => Boolean(value))
  if (timestamps.length === 0) {
    return null
  }

  return timestamps.sort(compareIsoDesc)[0] ?? null
}

function firstTimelineTimestamp(message: TaskPulseMessage): string | null {
  return message.timestamp ?? message.firstSeenAt ?? message.lastSeenAt
}

function resolveDeadThresholdMinutes(explicitThreshold: number | undefined, unresolvedData: UnknownRecord | null): number {
  if (isFiniteNumber(explicitThreshold)) {
    return Math.max(1, Math.floor(explicitThreshold))
  }

  const unresolvedThreshold = getNumber(unresolvedData?.thresholdMinutes)
  if (unresolvedThreshold !== null) {
    return Math.max(1, Math.floor(unresolvedThreshold))
  }

  return DEFAULT_DEAD_THRESHOLD_MINUTES
}

function diffMinutes(nowIso: string, thenIso: string | null): number | null {
  if (!thenIso) {
    return null
  }

  const nowMs = Date.parse(nowIso)
  const thenMs = Date.parse(thenIso)
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) {
    return null
  }

  const value = Math.floor((nowMs - thenMs) / 60000)
  return value < 0 ? 0 : value
}

function compareIsoDesc(a: string | null, b: string | null): number {
  const left = a ? Date.parse(a) : Number.NaN
  const right = b ? Date.parse(b) : Number.NaN

  if (!Number.isFinite(left) && !Number.isFinite(right)) {
    return 0
  }

  if (!Number.isFinite(left)) {
    return 1
  }

  if (!Number.isFinite(right)) {
    return -1
  }

  return right - left
}

function getStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set<string>()
  }

  return new Set(value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry)))
}

function normalizeStatus(status: string | null): string {
  if (!status) {
    return 'pending'
  }

  const normalized = status.trim().toLowerCase()
  if (DONE_STATUS.has(normalized)) {
    return 'done'
  }

  if (CLAIMED_STATUS.has(normalized)) {
    return 'claimed'
  }

  if (WORKING_STATUS.has(normalized)) {
    return 'working'
  }

  return normalized
}

function extractMessageId(task: string | null): string | null {
  if (!task) {
    return null
  }

  const bracketMatch = task.match(/message_id[:=]\s*([A-Za-z0-9-]+)/i)
  if (bracketMatch?.[1]) {
    return bracketMatch[1]
  }

  const inlineMatch = task.match(/\bmessage[\s_-]?id\b[:=]?\s*([A-Za-z0-9-]+)/i)
  if (inlineMatch?.[1]) {
    return inlineMatch[1]
  }

  return null
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeIso(value: unknown): string | null {
  const asText = asString(value)
  if (!asText) {
    return null
  }

  const timestamp = Date.parse(asText)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  return new Date(timestamp).toISOString()
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as UnknownRecord
}
