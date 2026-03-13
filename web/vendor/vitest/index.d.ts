export type TestFunction = () => void | Promise<void>

export declare function describe(name: string, fn: () => void): void
export declare function it(name: string, fn: TestFunction): void
export declare const test: typeof it

export interface Matchers<T> {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toStrictEqual(expected: unknown): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toContain(expected: unknown): void
  toBeDefined(): void
  toBeUndefined(): void
  not: Matchers<T>
}

export declare function expect<T>(received: T): Matchers<T>

export declare function __getTests(): Array<{ name: string; fn: TestFunction }>
export declare function __resetTests(): void
