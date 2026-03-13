import { inspect, isDeepStrictEqual } from 'node:util'

const state = getState()

export function describe(name, fn) {
  state.suiteStack.push(name)
  try {
    fn()
  } finally {
    state.suiteStack.pop()
  }
}

export function it(name, fn) {
  const fullName = [...state.suiteStack, name].join(' > ')
  state.tests.push({
    name: fullName,
    fn,
  })
}

export const test = it

export function expect(received) {
  return createMatchers(received, false)
}

export function __getTests() {
  return state.tests
}

export function __resetTests() {
  state.tests = []
  state.suiteStack = []
}

function createMatchers(received, isNegated) {
  const assert = (pass, positiveMessage, negativeMessage) => {
    const finalPass = isNegated ? !pass : pass
    if (!finalPass) {
      const message = isNegated ? negativeMessage : positiveMessage
      throw new Error(message)
    }
  }

  return {
    toBe(expected) {
      assert(
        Object.is(received, expected),
        `Expected ${format(received)} to be ${format(expected)}`,
        `Expected ${format(received)} not to be ${format(expected)}`,
      )
    },
    toEqual(expected) {
      assert(
        isDeepStrictEqual(received, expected),
        `Expected ${format(received)} to equal ${format(expected)}`,
        `Expected ${format(received)} not to equal ${format(expected)}`,
      )
    },
    toStrictEqual(expected) {
      assert(
        isDeepStrictEqual(received, expected),
        `Expected ${format(received)} to strictly equal ${format(expected)}`,
        `Expected ${format(received)} not to strictly equal ${format(expected)}`,
      )
    },
    toBeNull() {
      assert(received === null, `Expected ${format(received)} to be null`, `Expected value not to be null`)
    },
    toBeTruthy() {
      assert(Boolean(received), `Expected ${format(received)} to be truthy`, `Expected ${format(received)} to be falsy`)
    },
    toBeFalsy() {
      assert(!received, `Expected ${format(received)} to be falsy`, `Expected ${format(received)} to be truthy`)
    },
    toContain(expected) {
      const pass =
        typeof received === 'string'
          ? received.includes(String(expected))
          : Array.isArray(received)
            ? received.includes(expected)
            : false

      assert(
        pass,
        `Expected ${format(received)} to contain ${format(expected)}`,
        `Expected ${format(received)} not to contain ${format(expected)}`,
      )
    },
    toBeDefined() {
      assert(received !== undefined, `Expected value to be defined`, `Expected value to be undefined`)
    },
    toBeUndefined() {
      assert(received === undefined, `Expected value to be undefined`, `Expected value not to be undefined`)
    },
    get not() {
      return createMatchers(received, !isNegated)
    },
  }
}

function getState() {
  if (!globalThis.__localVitestState) {
    globalThis.__localVitestState = {
      suiteStack: [],
      tests: [],
    }
  }

  return globalThis.__localVitestState
}

function format(value) {
  return inspect(value, { depth: 6, breakLength: 120 })
}
