export const DEFAULT_POST_LOGIN_PATH = '/dashboard'

export function safeRedirectPath(input: string | null | undefined): string {
  if (!input) {
    return DEFAULT_POST_LOGIN_PATH
  }

  const value = input.trim()
  if (!value.startsWith('/')) {
    return DEFAULT_POST_LOGIN_PATH
  }

  if (value.startsWith('//')) {
    return DEFAULT_POST_LOGIN_PATH
  }

  if (value.startsWith('/login')) {
    return DEFAULT_POST_LOGIN_PATH
  }

  return value
}
