export const AIRBNB_PROPERTIES = Object.freeze([
  Object.freeze({
    unitNumber: 1,
    commonName: "Bougainvillea",
    listingName: "Bougainvillea Courtyard Studio",
    listingPatterns: Object.freeze([/bougainvillea/i, /bogenvilla/i, /bougenvilla/i, /bougenvillea/i]),
  }),
  Object.freeze({
    unitNumber: 2,
    commonName: "Spekboom",
    listingName: "The Spekboom Studio",
    listingPatterns: Object.freeze([/spekboom/i]),
  }),
  Object.freeze({
    unitNumber: 3,
    commonName: "Jasmine",
    listingName: "Jasmine Studio Stay",
    listingPatterns: Object.freeze([/jasmine/i]),
  }),
]);

export function propertyForListing(value) {
  const text = String(value ?? "");
  return AIRBNB_PROPERTIES.find((property) =>
    property.listingPatterns.some((pattern) => pattern.test(text))) ?? null;
}
