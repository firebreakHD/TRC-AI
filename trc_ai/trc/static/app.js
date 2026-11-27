const byId = (id) => document.getElementById(id);
const bytes = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
let token = "";
let accessRole = "";
let refreshSeconds = 15;
let timer;
let session = new AbortController();

async function api(path, options = {}) {
  const { timeout = 8000, ...request } = options;
  const response = await fetch(new URL(`./api/v1/${path}`, document.baseURI), {
    ...request,
    signal: AbortSignal.any([session.signal, AbortSignal.timeout(timeout)]),
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
  const pages = ["chat", "routing", "uebersicht", "wissen", "dokumente", "betrieb", "system", "netzwerk"];
  const hash = location.hash.slice(1);
  const page = pages.includes(hash) && (hash === "chat" || accessRole === "admin") ? hash : "chat";
  for (const id of pages) {
    byId(id).hidden = id !== page;
    const link = document.querySelector(`a[href="#${id}"]`);
    if (id === page) link?.setAttribute("aria-current", "page");
    else link?.removeAttribute("aria-current");
  }
  if (token) window.intelligence?.navigate(page);
  if (page === "dokumente" && token) void loadDocuments();
  if (page === "betrieb" && token) void loadBackend();
  if (page === "netzwerk" && token) void loadNetwork();
}
window.addEventListener("hashchange", navigate);

byId("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  token = byId("token").value.trim();
  byId("login-message").textContent = "Anmeldung wird geprüft …";
  try {
    const identity = await api("intelligence/session");
    accessRole = identity.role;
    for (const element of document.querySelectorAll("aside [data-admin]")) element.hidden = accessRole !== "admin";
    if (accessRole === "admin") {
      const { values, schema } = await api("admin/preferences");
      const field = schema.properties.refresh_seconds;
      byId("refresh").min = field.minimum;
      byId("refresh").max = field.maximum;
      byId("refresh").value = values.refresh_seconds;
      byId("refresh-label").textContent = field.title;
      byId("refresh-description").textContent = field.description;
      refreshSeconds = values.refresh_seconds;
    }
    byId("sidebar").hidden = false;
    byId("app-bar").hidden = false;
    byId("login").hidden = true;
    byId("workspace").hidden = false;
    window.intelligence?.login(identity);
    byId("login-form").reset();
    byId("login-message").textContent = "";
    navigate();
    byId("sidebar-toggle").focus({preventScroll:true});
    if (accessRole === "admin") void poll();
  } catch (error) {
    token = "";
    accessRole = "";
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
  accessRole = "";
  window.intelligence?.logout();
  byId("sidebar").hidden = true;
  byId("app-bar").hidden = true;
  for (const id of ["knowledge-query", "document-upload"]) byId(id).reset();
  for (const id of ["knowledge-sources", "knowledge-output", "knowledge-message", "document-list", "documents-message", "backend-errors", "backend-message", "backend-jobs"]) byId(id).replaceChildren();
  byId("backend-pause").disabled = true;
  byId("documents-next").hidden = true;
  networkServices.clear();
  byId("network-form").reset();
  byId("network-form").hidden = true;
  byId("network-service").replaceChildren();
  byId("network-startup").replaceChildren();
  byId("network-load").textContent = "";
  byId("network-result").textContent = "";
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

const networkServices = new Map();
const networkForm = byId("network-form");
const serviceSelect = byId("network-service");
const networkMessage = byId("network-result");
const testButton = byId("network-test");
const customKey = "__new__";
let networkBusy = false;
const localTime = new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short" });

function showCredentialFields() {
  const mode = byId("network-auth").value;
  byId("network-credentials").hidden = mode === "none";
  byId("network-name-label").hidden = mode !== "basic";
}

function showNetworkService() {
  const key = serviceSelect.value;
  const row = networkServices.get(key) || {};
  networkForm.reset();
  networkForm.hidden = false;
  byId("network-custom").hidden = key !== customKey;
  byId("network-key").required = key === customKey;
  byId("network-enabled").checked = Boolean(row.enabled);
  byId("network-internal").value = row.internal_url ?? "";
  byId("network-public").value = row.public_url ?? "";
  byId("network-internal").disabled = key === "trc";
  byId("network-public").disabled = key === "trc";
  byId("network-reference").value = row.credential_reference ?? "";
  byId("network-timeout").value = row.timeout_seconds ?? "";
  byId("network-auth").value = row.auth_mode ?? "none";
  byId("network-tls").value = row.tls_verification ?? "system";
  byId("network-credential").textContent = row.has_credential ? "Zugangsdaten sind gespeichert." : "";
  testButton.disabled = networkBusy || !row.enabled;
  networkMessage.textContent = "";
  const check = row.last_check?.message ?? "Noch keine Prüfung";
  const last = row.last_success_at ? localTime.format(new Date(row.last_success_at)) : "keine";
  byId("network-check").textContent = `${check} Letzte erfolgreiche Prüfung ${last}.`;
  showCredentialFields();
}

async function loadNetwork(selection = serviceSelect.value || "trc") {
  const signal = session.signal;
  try {
    const { startup, connection, services } = await api("admin/network");
    if (signal.aborted) return;
    const fields = [
      ["Interne Adresse", startup.network_internal_url],
      ["Öffentliche Adresse", startup.network_public_url],
      ["Proxy-Modus", startup.network_proxy_mode === "direct" ? "Direkt" : "Vertrauenswürdiger Proxy"],
      ["Proxy-Adressen", startup.network_trusted_proxies.join(", ")],
      ["TLS-Modus", startup.network_tls_mode === "proxy_https" ? "HTTPS am Proxy" : "HTTP im internen Netz"],
      ["Eigene CA", startup.network_ca_file],
      ["Standard-Zeitlimit", `${startup.network_timeout_seconds} s`],
      ["Aktueller Zugriff", connection.trusted_proxy ? "Über einen vertrauenswürdigen Proxy" : "Direkt oder HA Ingress"],
    ];
    byId("network-startup").replaceChildren(...fields.map(([label, value]) => {
      const element = document.createElement("div");
      const name = document.createElement("dt");
      const data = document.createElement("dd");
      name.textContent = label;
      data.textContent = value || "–";
      element.append(name, data);
      return element;
    }));
    networkServices.clear();
    for (const row of services) networkServices.set(row.key, row);
    serviceSelect.replaceChildren(...services.map(row => new Option(row.label, row.key)),
      new Option("Weiteren Dienst hinzufügen", customKey));
    serviceSelect.value = networkServices.has(selection) || selection === customKey ? selection : "trc";
    byId("network-load").textContent = "";
    showNetworkService();
  } catch (error) {
    if (!signal.aborted) byId("network-load").textContent = error.message;
  }
}

serviceSelect.addEventListener("change", showNetworkService);
byId("network-auth").addEventListener("change", showCredentialFields);
networkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (networkBusy) return;
  const signal = session.signal;
  const key = serviceSelect.value === customKey ? byId("network-key").value : serviceSelect.value;
  const auth = byId("network-auth").value;
  const command = {
    enabled: byId("network-enabled").checked,
    internal_url: key === "trc" ? "" : byId("network-internal").value,
    public_url: key === "trc" ? "" : byId("network-public").value,
    auth_mode: auth,
    credential_reference: byId("network-reference").value,
    timeout_seconds: byId("network-timeout").valueAsNumber || null,
    tls_verification: byId("network-tls").value,
  };
  if (auth !== "none") {
    if (byId("network-name").value && auth === "basic") command.username = byId("network-name").value;
    if (byId("network-secret").value) command.secret = byId("network-secret").value;
    command.remove_secret = byId("network-remove").checked;
  }
  networkBusy = true;
  event.submitter.disabled = serviceSelect.disabled = testButton.disabled = true;
  try {
    await api(`admin/network/services/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
    });
    if (signal.aborted) return;
    await loadNetwork(key);
    if (!signal.aborted) networkMessage.textContent = "Gespeichert. Änderungen sind sofort aktiv.";
  } catch (error) {
    if (!signal.aborted) networkMessage.textContent = error.message;
  } finally {
    networkBusy = false;
    event.submitter.disabled = serviceSelect.disabled = false;
    testButton.disabled = !networkServices.get(serviceSelect.value)?.enabled;
  }
});

testButton.addEventListener("click", async () => {
  if (networkBusy) return;
  const signal = session.signal;
  const key = serviceSelect.value;
  networkBusy = true;
  testButton.disabled = serviceSelect.disabled = true;
  networkMessage.textContent = "Gespeicherte Verbindung wird geprüft …";
  try {
    const result = await api(`admin/network/services/${encodeURIComponent(key)}/test`, {
      method: "POST", timeout: 40000,
    });
    if (signal.aborted) return;
    networkServices.set(key, result);
    showNetworkService();
  } catch (error) {
    if (!signal.aborted) networkMessage.textContent = error.message;
  } finally {
    networkBusy = false;
    serviceSelect.disabled = false;
    testButton.disabled = !networkServices.get(serviceSelect.value)?.enabled;
  }
});

const jsonBody = (method, data) => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
const stateLabels = {
  idle: "Bereit", starting: "Startet", processing: "Verarbeitet", embedding: "Berechnet Vektoren",
  repairing: "Gleicht Vektorindex ab", paused: "Pausiert", pending: "Wartet", running: "In Arbeit", done: "Indexiert", failed: "Fehlgeschlagen",
};
const answerLabels = {
  model_not_configured: "Kein Antwortmodell konfiguriert.", model_unavailable: "Das Antwortmodell ist derzeit nicht erreichbar.",
  no_evidence: "Keine passenden Belege gefunden.", unverified_citations: "Die Modellantwort enthielt keine gültigen Quellenmarken.",
};

async function perform(button, output, operation) {
  const signal = session.signal;
  button.disabled = true;
  output.textContent = "Wird geladen …";
  try {
    return await operation(signal);
  } catch (error) {
    if (!signal.aborted) output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

byId("knowledge-query").addEventListener("submit", event => {
  event.preventDefault();
  const message = byId("knowledge-message");
  byId("knowledge-sources").replaceChildren();
  byId("knowledge-output").textContent = "";
  void perform(event.submitter, message, async signal => {
    const result = await api("knowledge/query", {
      ...jsonBody("POST", { question: byId("knowledge-question").value, answer: byId("knowledge-answer").checked,
        profile: byId("knowledge-profile").value }),
      timeout: 95000,
    });
    if (signal.aborted) return;
    byId("knowledge-output").textContent = result.answer || answerLabels[result.answer_status] || "";
    message.textContent = result.sources.length ? "Belege: " + result.sources.length : "Keine passenden Belege gefunden.";
    for (const resultSource of result.sources) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const excerpt = document.createElement("p");
      title.textContent = `[${resultSource.id}] ${resultSource.path} · ${resultSource.location}`;
      excerpt.textContent = resultSource.excerpt;
      item.append(title, excerpt);
      byId("knowledge-sources").append(item);
    }
  });
});

let documentCursor;
async function loadDocuments(append = false) {
  const signal = session.signal;
  const message = byId("documents-message");
  try {
    const filters = new URLSearchParams({q: byId("document-search").value.trim()});
    if (append && documentCursor) filters.set("after",documentCursor);
    const suffix = "?" + filters;
    const { documents, next } = await api("knowledge/documents" + suffix);
    if (signal.aborted) return;
    const list = byId("document-list");
    if (!append) list.replaceChildren();
    documentCursor = next;
    byId("documents-next").hidden = !next;
    message.textContent = documents.length || append ? "" : "Noch keine Dokumente vorgemerkt.";
    for (const row of documents) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = row.path;
      const meta = document.createElement("p");
      meta.textContent = `${stateLabels[row.state] || row.state} · ${row.chunks} Segmente`;
      if (row.error_code) meta.append(` · ${row.error_code}`);
      const actions = document.createElement("div");
      actions.className = "document-actions";
      if (row.state === "done") {
        const ask = document.createElement("button");
        ask.type = "button";
        ask.textContent = "Im Chat fragen";
        ask.addEventListener("click", () => void window.intelligence.fromDocument(row.path));
        actions.append(ask);
      }
      if (row.state === "failed" || row.state === "done") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.textContent = row.state === "failed" ? "Wiederholen" : "Neu indexieren";
        button.addEventListener("click", () => void perform(button, message, async current => {
          await api("knowledge/retry", jsonBody("POST", { path: row.path, reindex: row.state === "done" }));
          if (!current.aborted) await loadDocuments();
        }));
        actions.append(button);
      }
      item.append(title, meta);
      if (actions.childElementCount) item.append(actions);
      list.append(item);
    }
  } catch (error) {
    if (!signal.aborted) message.textContent = error.message;
  }
}

byId("documents-next").addEventListener("click", () => void loadDocuments(true));
byId("document-search").addEventListener("input", () => void loadDocuments());
byId("documents-refresh").addEventListener("click", () => void loadDocuments());
byId("document-upload").addEventListener("submit", event => {
  event.preventDefault();
  const file = byId("document-file").files[0];
  if (!file) return;
  const message = byId("documents-message");
  void perform(event.submitter, message, async signal => {
    const result = await api("knowledge/documents/" + encodeURIComponent(file.name), {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, timeout: 95000, body: file,
    });
    if (signal.aborted) return;
    byId("document-upload").reset();
    await loadDocuments();
    if (!signal.aborted) message.textContent = result.queued ? "Dokument zur Verarbeitung vorgemerkt." : "Diese Dateiversion ist bereits vorgemerkt.";
  });
});

let paused = false;
async function loadBackend() {
  const signal = session.signal;
  const message = byId("backend-message");
  try {
    const [system, knowledge] = await Promise.all([api("system/status"), api("knowledge/status")]);
    if (signal.aborted) return;
    const { worker, configuration: config } = knowledge;
    byId("backend-db").textContent = system.postgresql.version;
    byId("backend-vector").textContent = system.qdrant.available ? system.qdrant.version : "Nicht erreichbar";
    byId("backend-documents").textContent = knowledge.documents;
    byId("backend-worker").textContent = worker?.alive ? stateLabels[worker.phase] : "Kein aktuelles Signal";
    if (worker?.detail) byId("backend-worker").append(` · ${worker.detail}`);
    paused = worker?.paused === true;
    byId("backend-pause").textContent = paused ? "Verarbeitung fortsetzen" : "Verarbeitung pausieren";
    byId("backend-pause").disabled = false;
    byId("backend-embed").textContent = `${config.rag_embed_model} · ${config.rag_dimensions} Dimensionen`;
    byId("backend-model").textContent = config.rag_chat_model || "Noch kein Modell gewählt";
    byId("backend-jobs").textContent = Object.entries(knowledge.jobs).map(([state, number]) => `${stateLabels[state]} ${number}`).join(" · ") || "Keine Aufträge.";
    const errors = Object.entries(knowledge.errors);
    byId("backend-errors").replaceChildren(...errors.map(([code, count]) => {
      const item = document.createElement("li");
      item.textContent = `${code} · ${count}`;
      return item;
    }));
    message.textContent = "";
  } catch (error) {
    if (!signal.aborted) message.textContent = error.message;
  }
}

byId("backend-repair").addEventListener("click", event => {
  const message = byId("backend-message");
  void perform(event.currentTarget, message, async signal => {
    await api("knowledge/index/repair", { method: "POST" });
    if (!signal.aborted) message.textContent = "Indexabgleich angefordert. Eine pausierte Verarbeitung zuerst fortsetzen.";
  });
});

byId("backend-refresh").addEventListener("click", () => void loadBackend());
byId("backend-pause").addEventListener("click", event => {
  void perform(event.currentTarget, byId("backend-message"), async signal => {
    await api("knowledge/worker", jsonBody("PUT", { paused: !paused }));
    if (!signal.aborted) await loadBackend();
  });
});

navigate();
