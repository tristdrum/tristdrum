function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cents(value) {
  const amount = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function trustedSixty60Sender(address) {
  return String(address ?? "").trim().toLowerCase() === "no-reply@checkers.sixty60.co.za";
}

export function classifyInventorySku(description) {
  const name = normalizeWhitespace(description).toLowerCase();
  if (/\bwater\b/.test(name) && /500\s*ml/.test(name)) return "water_500ml";
  if (/\bmilk\b/.test(name) && /(250|500)\s*ml/.test(name)) return "milk_250ml";
  if (
    /\b(chocolate|choc|kitkat|kit kat|lunch bar|bar-one|bar one|tempo|tex|nosh|tv bar)\b/.test(name)
    && !/\b(biscuits?|cookies?|ice cream|choc(?:olate)? chips?|slab|powder|spread|cake)\b/.test(name)
  ) return "guest_chocolate";
  if (/\brusk/.test(name) && /(?:individually|single|wrapped|portion)/.test(name)) return "wrapped_rusk";
  if (/\b(coffee|cappuccino|nescaf(?:e|\u00e9)?)\b/.test(name) && /(?:stick|sachet|portion|single)/.test(name)) {
    return "coffee_portion";
  }
  if (/\bsugar\b/.test(name) && /(?:stick|sachet|portion|single)/.test(name)) return "sugar_portion";
  if (/\btoilet\b/.test(name) && /\b(roll|tissue|paper)\b/.test(name)) return "toilet_roll";
  if (/\b(refuse|garbage|bin)\b/.test(name) && /\bbag/.test(name)) return "refuse_bag";
  if (/\bbleach\b/.test(name)) return "bleach";
  if (/\b(multipurpose|multi purpose|all purpose)\b/.test(name) && /\bclean/.test(name)) return "multipurpose_cleaner";
  if (/\b(dishwashing|dish washing|dishwasher)\b/.test(name) && /\b(liquid|soap|gel)\b/.test(name)) return "dishwashing_liquid";
  if (/\b(laundry|washing powder|washing liquid|detergent)\b/.test(name)) return "laundry_detergent";
  if (/\bbath\s*mat\b/.test(name)) return "bath_mat";
  if (/\blinen\b/.test(name) && /\b(set|sheet|duvet|pillowcase)\b/.test(name)) return "linen_set";
  if (/\bmug\b/.test(name)) return "mug";
  if (/\b(drinking|tumbler|highball)\b/.test(name) && /\bglass/.test(name)) return "drinking_glass";
  return null;
}

function packageMultiplier(description, sku) {
  const name = normalizeWhitespace(description).toLowerCase();
  const pack = /\b(\d+)\s*(?:pack|pk|pieces|piece|rolls|sachets|sticks)\b/.exec(name);
  if (pack && [
    "water_500ml", "milk_250ml", "wrapped_rusk",
    "coffee_portion", "sugar_portion", "toilet_roll", "refuse_bag",
  ].includes(sku)) {
    return Number.parseInt(pack[1], 10);
  }
  if (sku === "guest_chocolate") {
    const multipliedBars = /\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*g\b/.exec(name);
    const outerPackCount = multipliedBars ? Number.parseInt(multipliedBars[1], 10) : 1;
    const multipliedWeight = multipliedBars ? Number.parseFloat(multipliedBars[2]) : null;
    // Exact retail weights are part of the identity; unknown sharing bags fail closed below.
    if (/\bkit\s*kat\b.*\bminis?\b.*\b180\s*g\b/.test(name)) {
      return 9 * (multipliedWeight === 180 ? outerPackCount : 1);
    }
    if (/\blunch bar\b.*\bminis?\b.*\b168\s*g\b/.test(name)) {
      return 8 * (multipliedWeight === 168 ? outerPackCount : 1);
    }
    if (/\bbar[- ]?one\b.*\bminis?\b.*\b189\s*g\b/.test(name)) {
      return 9 * (multipliedWeight === 189 ? outerPackCount : 1);
    }
    if (multipliedBars) return outerPackCount;
    if (pack) return Number.parseInt(pack[1], 10);
    if (/\b(minis?|assorted|selection|treats?|bag)\b/.test(name)) return null;
    return 1;
  }
  const multiplied = /\b(\d+)\s*x\s*(?:\d+(?:\.\d+)?\s*)?(?:ml|l|g|kg)\b/.exec(name);
  if (multiplied) return Number.parseInt(multiplied[1], 10);
  return 1;
}

function itemSection(text, kind) {
  const startPatterns = kind === "invoice"
    ? [/Product Detail\s+Price \(per item\)\s+Total/i]
    : [/Delivery 1 \(of 1\)/i, /ETA\s+[^ ]+\s+Delivery 1/i];
  let start = -1;
  for (const pattern of startPatterns) {
    const match = pattern.exec(text);
    if (match) {
      start = match.index + match[0].length;
      break;
    }
  }
  const section = start >= 0 ? text.slice(start) : text;
  const end = /Product sub-total/i.exec(section)?.index ?? section.length;
  return section.slice(0, end).trim();
}

export function parseSixty60LineItems(body, kind = "invoice") {
  const section = itemSection(normalizeWhitespace(body), kind);
  const pattern = /(?:\*\s*)?(.+?)\s+Qty\s+(\d+(?:\.\d+)?)\s+R\s*([\d,.]+)(?:\s+R\s*([\d,.]+))?(?=\s+(?:\*\s*)?[A-Z0-9]|$)/g;
  const items = [];
  for (const match of section.matchAll(pattern)) {
    const description = normalizeWhitespace(match[1]);
    if (!description || /^(?:product|delivery|eta)\b/i.test(description)) continue;
    const sku = classifyInventorySku(description);
    const quantity = Number.parseFloat(match[2]);
    const multiplier = sku ? packageMultiplier(description, sku) : null;
    items.push({
      description,
      quantity,
      unitPriceCents: cents(match[3]),
      lineTotalCents: cents(match[4] ?? match[3]),
      inventorySku: sku,
      inventoryQuantityKnown: sku != null && multiplier != null,
      creditedQuantity: multiplier == null ? 0 : quantity * multiplier,
    });
  }
  return items;
}

function orderNumber(subject, body) {
  return /(?:Order|Invoice)\s*(?:No\.?|#)?\s*:?\s*(?:INV)?(\d{6,})/i.exec(`${subject} ${body}`)?.[1] ?? null;
}

function deliveryAddress(body) {
  return /Delivery address:\s*(.+?)(?=\s+(?:\d+\s*MIN|Delivered on|Product Detail))/i.exec(body)?.[1]?.trim() ?? null;
}

function totalCents(body) {
  const matches = [...body.matchAll(/(?:^|\s)Total\s+R\s*([\d,.]+)/gi)];
  return matches.length ? cents(matches.at(-1)[1]) : null;
}

export function parseSixty60Message({ subject, body, from, occurredAt = null, providerMessageId = null }) {
  if (!trustedSixty60Sender(from)) return null;
  const normalizedSubject = normalizeWhitespace(subject);
  const normalizedBody = normalizeWhitespace(body);
  const kind = /invoice/i.test(normalizedSubject) ? "invoice"
    : /received your order|order is confirmed/i.test(`${normalizedSubject} ${normalizedBody}`) ? "confirmation"
      : null;
  if (!kind) return null;
  const providerOrderId = orderNumber(normalizedSubject, normalizedBody);
  if (!providerOrderId) return null;
  const eta = /\bETA\s+([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM))/i.exec(normalizedBody)?.[1] ?? null;
  const delivered = /Delivered on\s+(.+?)(?=\s+Your driver|\s+Product Detail)/i.exec(normalizedBody)?.[1] ?? null;
  return {
    kind,
    providerOrderId,
    providerMessageId,
    occurredAt,
    deliveryAddress: deliveryAddress(normalizedBody),
    eta,
    delivered,
    totalCents: totalCents(normalizedBody),
    items: parseSixty60LineItems(normalizedBody, kind),
  };
}
