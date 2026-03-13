import { describe, expect, it } from 'vitest'
import { deriveDisplayStatus, deriveTaskPulseState } from './taskPulse.js'

describe('deriveTaskPulseState', () => {
  it('marks stale pending messages as dead when over threshold', () => {
    const result = deriveTaskPulseState({
      generatedAt: '2026-02-10T12:00:00.000Z',
      deadThresholdMinutes: 12,
      stateData: {
        messageState: {
          'message-1': {
            messageId: 'message-1',
            status: 'pending',
            timestamp: '2026-02-10T10:00:00.000Z',
            lastSeenAt: '2026-02-10T11:30:00.000Z',
          },
        },
      },
    })

    expect(result.messages[0].displayStatus).toBe('dead')
    expect(result.messages[0].isDead).toBe(true)
    expect(result.messages[0].isClaimed).toBe(false)
    expect(result.messages[0].ageMinutes).toBe(120)
    expect(result.messages[0].staleMinutes).toBe(30)
  })

  it('keeps claimed messages from being marked dead', () => {
    const result = deriveTaskPulseState({
      generatedAt: '2026-02-10T12:00:00.000Z',
      deadThresholdMinutes: 12,
      stateData: {
        messageState: {
          'message-2': {
            messageId: 'message-2',
            status: 'pending',
            timestamp: '2026-02-10T10:00:00.000Z',
            lastSeenAt: '2026-02-10T11:30:00.000Z',
            claimedAt: '2026-02-10T11:00:00.000Z',
          },
        },
      },
    })

    expect(result.messages[0].displayStatus).toBe('claimed')
    expect(result.messages[0].isDead).toBe(false)
    expect(result.messages[0].isClaimed).toBe(true)
  })

  it('marks the active claim as working', () => {
    const result = deriveTaskPulseState({
      generatedAt: '2026-02-10T12:00:00.000Z',
      deadThresholdMinutes: 12,
      stateData: {
        activeClaim: {
          messageId: 'message-3',
          claimedAt: '2026-02-10T11:58:00.000Z',
        },
        messageState: {
          'message-3': {
            messageId: 'message-3',
            status: 'pending',
            timestamp: '2026-02-10T11:40:00.000Z',
            lastSeenAt: '2026-02-10T11:59:00.000Z',
          },
        },
      },
    })

    expect(result.activeMessageId).toBe('message-3')
    expect(result.messages[0].displayStatus).toBe('working')
    expect(result.messages[0].isClaimed).toBe(true)
    expect(result.summary.activeClaim?.messageId).toBe('message-3')
  })

  it('uses unresolved threshold when no explicit threshold is provided', () => {
    const result = deriveTaskPulseState({
      generatedAt: '2026-02-10T12:00:00.000Z',
      unresolvedData: {
        thresholdMinutes: 5,
      },
      stateData: {
        messageState: {
          'message-4': {
            messageId: 'message-4',
            status: 'pending',
            timestamp: '2026-02-10T11:40:00.000Z',
            lastSeenAt: '2026-02-10T11:54:00.000Z',
          },
        },
      },
    })

    expect(result.deadThresholdMinutes).toBe(5)
    expect(result.messages[0].isDead).toBe(true)
  })

  it('keeps done status even when stale', () => {
    const result = deriveTaskPulseState({
      generatedAt: '2026-02-10T12:00:00.000Z',
      deadThresholdMinutes: 12,
      stateData: {
        doneMessageIds: ['message-5'],
        messageState: {
          'message-5': {
            messageId: 'message-5',
            status: 'done',
            timestamp: '2026-02-10T09:00:00.000Z',
            lastSeenAt: '2026-02-10T10:00:00.000Z',
          },
        },
      },
    })

    expect(result.messages[0].displayStatus).toBe('done')
    expect(result.messages[0].isDead).toBe(false)
  })
})

describe('deriveDisplayStatus', () => {
  it('prioritizes dead over claimed but not over done', () => {
    expect(
      deriveDisplayStatus({
        rawStatus: 'claimed',
        isDone: false,
        isDead: true,
        isClaimed: true,
        isActiveClaim: false,
      }),
    ).toBe('dead')

    expect(
      deriveDisplayStatus({
        rawStatus: 'pending',
        isDone: true,
        isDead: true,
        isClaimed: false,
        isActiveClaim: false,
      }),
    ).toBe('done')
  })
})
