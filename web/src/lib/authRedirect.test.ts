import { describe, expect, it } from 'vitest'
import { DEFAULT_POST_LOGIN_PATH, safeRedirectPath } from './authRedirect.js'

describe('safeRedirectPath', () => {
  it('falls back for empty input', () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeRedirectPath(null)).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeRedirectPath('')).toBe(DEFAULT_POST_LOGIN_PATH)
  })

  it('allows internal paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeRedirectPath('/task-pulse?view=active')).toBe('/task-pulse?view=active')
  })

  it('rejects external or unsafe redirects', () => {
    expect(safeRedirectPath('https://evil.com')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeRedirectPath('//evil.com')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeRedirectPath('/login')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeRedirectPath('/login?redirect=/dashboard')).toBe(DEFAULT_POST_LOGIN_PATH)
  })
})
