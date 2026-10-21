let connected = false;
let active = false;
let expiresAt = null;
let frameUrl = null;
let frameBusy = false;
let outcome = null;
const element = (id) => document.getElementById(id);

function update() {
  element("start").disabled = !connected || active;
  element("stop").disabled = !active;
  element("type").disabled = !active;
  for (const button of document.querySelectorAll("[data-key]")) button.disabled = !active;
  element("status").textContent = !connected ? "Disconnected" : !active ?
    outcome === "saved" ? "Saved" : outcome === "unavailable" ? "Sign-in not saved" : "Ready" :
    `Session active - ${Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))}s remaining`;
}

async function api(path, { method = "GET", body, image = false } = {}) {
  const response = await fetch(`/api/${path}`, { method, cache: "no-store",
    credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error("unavailable");
  return image ? response.blob() : response.json();
}

async function frame() {
  if (!active || frameBusy) return;
  frameBusy = true;
  try {
    const next = URL.createObjectURL(await api("frame", { image: true }));
    element("screen").src = next;
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    frameUrl = next;
  } catch { active = false; update(); }
  finally { frameBusy = false; }
}

async function connect() {
  try {
    const status = await api("status");
    connected = true;
    active = status.active;
    expiresAt = status.expiresAt;
    outcome = status.outcome;
  } catch { connected = false; active = false; }
  update();
}

element("connect").addEventListener("click", connect);

element("start").addEventListener("click", async () => {
  try {
    const result = await api("start", { method: "POST" });
    active = result.active;
    expiresAt = result.expiresAt;
    outcome = result.outcome;
    update();
    await frame();
  } catch { element("status").textContent = "Start unavailable"; }
});

element("stop").addEventListener("click", async () => {
  try { await api("stop", { method: "POST" }); } catch { /* local status remains closed */ }
  active = false;
  update();
});

element("screen").addEventListener("click", async (event) => {
  if (!active) return;
  const rect = element("screen").getBoundingClientRect();
  const scale = Math.min(rect.width / 1280, rect.height / 800);
  const width = 1280 * scale;
  const height = 800 * scale;
  const x = Math.floor((event.clientX - rect.left - (rect.width - width) / 2) / scale);
  const y = Math.floor((event.clientY - rect.top - (rect.height - height) / 2) / scale);
  try { await api("input", { method: "POST", body: { kind: "click", x, y } }); }
  catch { element("status").textContent = "Input unavailable"; }
});

element("type").addEventListener("click", async () => {
  const text = element("entry").value;
  element("entry").value = "";
  if (!active || !text) return;
  try { await api("input", { method: "POST", body: { kind: "text", text } }); }
  catch { element("status").textContent = "Input unavailable"; }
});

for (const button of document.querySelectorAll("[data-key]")) button.addEventListener("click", async () => {
  if (!active) return;
  try { await api("input", { method: "POST", body: { kind: "key", key: button.dataset.key } }); }
  catch { element("status").textContent = "Input unavailable"; }
});

setInterval(() => { void connect().then(() => { if (active) void frame(); }); }, 1000);
update();
void connect();
