const byId = (id) => document.getElementById(id);
const bytes = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
let token = "";
let refreshSeconds = 15;
let timer;
let session = new AbortController();

async function api(path, options = {}) {
  const response = await fetch(new URL(`./api/v1/${path}`, document.baseURI), {
    ...options,
    signal: AbortSignal.any([session.signal, AbortSignal.timeout(8000)]),
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Der Dienst ist nicht erreichbar.");
  return result;
}

function renderStatus(data) {
  const resource = data.resources;
  const gib = (value) => `${bytes.format(value / 1024 ** 3)} GiB`;
  byId("version").textContent = data.version;
  byId("database").textContent = `${data.postgresql.version} · ${bytes.format(data.postgresql.database_bytes / 1024 ** 2)} MiB`;
  byId("qdrant").textContent = data.qdrant.available
    ? `${data.qdrant.version} · ${data.qdrant.collections} Collections`
    : "Nicht erreichbar";
  byId("cpu").textContent = resource.visible_cpu_count;
  byId("load").textContent = bytes.format(resource.system_load_1m);
  byId("memory").textContent = `${gib(resource.system_memory_available_bytes)} / ${gib(resource.system_memory_total_bytes)}`;
  byId("disk").textContent = `${gib(resource.data_disk_free_bytes)} / ${gib(resource.data_disk_total_bytes)}`;
  byId("status").textContent = "System erreichbar";
}

async function poll() {
  const signal = session.signal;
  try {
    const data = await api("system/status");
    if (!signal.aborted) renderStatus(data);
  } catch {
    if (!signal.aborted) byId("status").textContent = "Statusabfrage fehlgeschlagen";
  } finally {
    if (!signal.aborted) timer = setTimeout(poll, refreshSeconds * 1000);
  }
}

function navigate() {
  const page = location.hash === "#system" ? "system" : "uebersicht";
  for (const id of ["uebersicht", "system"]) {
    byId(id).hidden = id !== page;
    const link = document.querySelector(`a[href="#${id}"]`);
    if (id === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", navigate);
navigate();

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  token = byId("token").value.trim();
  byId("login-message").textContent = "Anmeldung wird geprüft …";
  try {
    const { values, schema } = await api("admin/preferences");
    const field = schema.properties.refresh_seconds;
    byId("refresh").min = field.minimum;
    byId("refresh").max = field.maximum;
    byId("refresh").value = values.refresh_seconds;
    byId("refresh-label").textContent = field.title;
    byId("refresh-description").textContent = field.description;
    refreshSeconds = values.refresh_seconds;
    byId("login").hidden = true;
    byId("workspace").hidden = false;
    byId("login-form").reset();
    byId("login-message").textContent = "";
    byId("logout").focus();
    void poll();
  } catch (error) {
    token = "";
    byId("login-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

byId("logout").addEventListener("click", () => {
  session.abort();
  session = new AbortController();
  clearTimeout(timer);
  token = "";
  for (const item of document.querySelectorAll("dd, #status, #preferences-message")) item.textContent = "";
  byId("workspace").hidden = true;
  byId("login").hidden = false;
  byId("token").focus();
});

byId("preferences").addEventListener("submit", async (event) => {
  event.preventDefault();
  const signal = session.signal;
  const button = event.submitter;
  button.disabled = true;
  const message = byId("preferences-message");
  try {
    const data = await api("admin/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema_version: 1, refresh_seconds: byId("refresh").valueAsNumber }),
    });
    if (signal.aborted) return;
    refreshSeconds = data.refresh_seconds;
    message.textContent = "Einstellungen gespeichert.";
  } catch (error) {
    if (!signal.aborted) message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
