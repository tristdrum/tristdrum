export function validateStorageState(value) {
  if (!value || !Array.isArray(value.cookies) || !Array.isArray(value.origins) || !value.cookies.length) {
    throw new Error("Invalid Playwright storage state");
  }
  for (const cookie of value.cookies) {
    if (!/^(?:\.|www\.)?airbnb\.co\.za$/.test(cookie.domain) || !cookie.name || typeof cookie.value !== "string") {
      throw new Error("Storage state contains an unexpected cookie");
    }
  }
  for (const origin of value.origins) {
    if (origin.origin !== "https://www.airbnb.co.za") throw new Error("Storage state contains an unexpected origin");
  }
  return value;
}

// Only a future, human-driven login inside the pilot Fly Machine may call this.
export async function persistFreshCloudLogin(context, store, env = process.env) {
  if (env.FLY_APP_NAME !== "tristdrum-airbnb-browser-pilot") {
    throw new Error("Fresh login must occur inside the pilot Fly app");
  }
  const auth = validateStorageState(await context.storageState());
  const existing = await store.read();
  await store.write({ ...existing, auth, snapshots: {}, attempts: {} });
}
