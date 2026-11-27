/* Browser shell for the local chat. Content is rendered as text nodes. */
(() => {
  const modes = { auto: "Automatisch", general: "Allgemeine KI", knowledge: "Wissensdatenbank",
    documents: "Dokumente", market: "Marktdaten", home: "Home Assistant", hermes: "Hermes" };
  const tools = { ...modes, news: "Nachrichten", research: "Forschung", reports: "Berichte", system: "Systemstatus",
    ha_action: "Licht schalten", automation: "n8n-Bericht" };
  const status = { failed: "Fehlgeschlagen", cancelled: "Abgebrochen", interrupted: "Unterbrochen", acting: "Wird ausgeführt …" };
  const base = "intelligence/chats";
  const scroll = byId("chat-scroll");
  const notice = byId("chat-notice");
  const input = byId("chat-input");
  let identity, selected, detail, pollTimer, files = [], requestID = "", sending = false;
  let historySequence = 0, detailSequence = 0, historyOffset = 0, older = [], settingsDraft;
  let currentPage = "chat";
  let renderingSignature = "";

  function choice(label, value, disabled = false) {
    const item = new Option(label, value);
    item.disabled = disabled;
    return item;
  }

  function button(text, action, label = text) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.setAttribute("aria-label", label);
    element.addEventListener("click", action);
    return element;
  }

  function theme(value) {
    document.documentElement.dataset.theme = value;
    byId("ui-theme").value = value;
  }
  theme(localStorage.getItem("trc-theme") || "system");
  byId("ui-theme").addEventListener("change", event => {
    theme(event.target.value);
    localStorage.setItem("trc-theme", event.target.value);
  });

  function setSidebar(open) {
    document.body.classList.toggle("sidebar-collapsed", !open);
    byId("sidebar-toggle").setAttribute("aria-expanded", String(open));
  }
  const mobile = matchMedia("(max-width: 48rem)");
  setSidebar(!mobile.matches && localStorage.getItem("trc-sidebar") !== "closed");
  byId("sidebar-toggle").addEventListener("click", () => {
    const open = document.body.classList.contains("sidebar-collapsed");
    setSidebar(open);
    if (!mobile.matches) localStorage.setItem("trc-sidebar", open ? "open" : "closed");
  });
  mobile.addEventListener("change", event => setSidebar(!event.matches && localStorage.getItem("trc-sidebar") !== "closed"));
  byId("sidebar").addEventListener("keydown", event => {
    if (event.key === "Escape" && mobile.matches) {
      setSidebar(false);
      byId("sidebar-toggle").focus();
    }
  });

  for (const id of ["administration", "history-shell"]) {
    const element = byId(id);
    const saved = localStorage.getItem("trc-" + id);
    if (saved !== null) element.open = saved === "open";
    element.addEventListener("toggle", () => localStorage.setItem("trc-" + id, element.open ? "open" : "closed"));
  }

  function group(date) {
    const when = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const week = new Date(today);
    week.setDate(today.getDate() - 7);
    return when >= today ? "Heute" : when >= yesterday ? "Gestern" : when >= week ? "Letzte 7 Tage" : "Älter";
  }

  function reportError(error) {
    if (!session.signal.aborted && identity) notice.textContent = error.message;
  }

  function refreshHistory(append = false) {
    const turn = ++historySequence;
    const offset = append ? historyOffset : 0;
    const params = new URLSearchParams({ q: byId("chat-search").value, archived: byId("archived-chats").checked, offset });
    void api(base + "?" + params).then(result => {
      if (turn !== historySequence || !identity) return;
      const list = byId("history-list");
      if (!append) list.replaceChildren();
      let label = append ? list.lastElementChild?.dataset.group : "";
      for (const row of result.chats) {
        const name = group(row.updated);
        if (name !== label) {
          const header = document.createElement("p");
          header.className = "history-group";
          header.textContent = name;
          list.append(header);
          label = name;
        }
        const line = document.createElement("div");
        line.className = "chat-row";
        line.dataset.group = name;
        const link = button(row.title, () => void pick(row.id));
        if (row.id === selected) link.setAttribute("aria-current", "page");
        const menu = document.createElement("details");
        const icon = document.createElement("summary");
        icon.textContent = "⋯";
        icon.setAttribute("aria-label", "Chat-Aktionen");
        menu.append(icon,
          button("Umbenennen", async () => {
            const title = prompt("Neuer Chat-Titel", row.title)?.trim();
            if (title) await modify(row.id, {title});
          }),
          button(row.archived ? "Wieder öffnen" : "Archivieren", () => void modify(row.id, {archived: !row.archived})),
          button("Löschen", async () => {
            if (!confirm("Diesen Chat samt Nachrichten und privaten Anhängen löschen?")) return;
            try {
              await api(base + "/" + row.id, {method:"DELETE"});
              if (row.id === selected) resetChat();
              refreshHistory();
            } catch (error) { reportError(error); }
          }));
        line.append(link, menu);
        list.append(line);
      }
      historyOffset = offset + result.chats.length;
      byId("history-more").hidden = !result.more;
    }).catch(reportError);
  }
  byId("chat-search").addEventListener("input", () => refreshHistory());
  byId("archived-chats").addEventListener("change", () => refreshHistory());
  byId("history-more").addEventListener("click", () => refreshHistory(true));

  function resetChat() {
    clearTimeout(pollTimer);
    detailSequence++;
    selected = null;
    detail = null;
    older = [];
    files = [];
    renderingSignature = "";
    requestID = "";
    input.value = "";
    input.rows = 2;
    notice.textContent = "";
    render();
  }

  async function pick(id) {
    if (sending) return;
    if (selected !== id) {
      resetChat();
      selected = id;
    }
    if (location.hash !== "#chat") location.hash = "#chat";
    if (mobile.matches) setSidebar(false);
    await refreshDetail();
    refreshHistory();
    input.focus();
  }

  async function create(documentPath = '') {
    const row = await api(base, jsonBody("POST", {profile: byId("chat-profile").value || "general",
      mode: documentPath ? "knowledge" : byId("chat-mode").value || "auto", document: documentPath}));
    selected = row.id;
    location.hash = "#chat";
    return row.id;
  }

  async function modify(id, values) {
    try {
      await api(base + "/" + id, jsonBody("PATCH", values));
      if (selected === id) await refreshDetail();
      refreshHistory();
    } catch (error) { reportError(error); }
  }

  byId("new-chat").addEventListener("click", async () => {
    if (sending) return;
    resetChat();
    try {
      await create();
      await pick(selected);
    } catch (error) { reportError(error); }
  });
  byId("chat-profile").addEventListener("change", event => {
    if (selected) void modify(selected, {profile:event.target.value});
  });
  byId("chat-mode").addEventListener("change", event => {
    if (selected) void modify(selected, {mode:event.target.value});
  });

  function selections(profiles, available, row) {
    const p = byId("chat-profile"), m = byId("chat-mode");
    const chosenProfile = row?.profile || p.value || "general";
    const chosenMode = row?.mode || m.value || "auto";
    p.replaceChildren(...Object.entries(profiles).map(([key,value]) => choice(value.name,key)));
    m.replaceChildren(...Object.entries(modes).map(([key,value]) =>
      choice(value + (available[key] === false ? " · nicht eingerichtet" : ""),key,available[key] === false)));
    p.value = chosenProfile;
    m.value = chosenMode;
  }

  function inline(parent, text, sources) {
    const pattern = /(`[^`]+\x60|\*\*[^*]+\*\*|\[\d{1,6}\])/g;
    for (const part of text.split(pattern)) {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2,-2);
        parent.append(strong);
      } else if (part.startsWith(String.fromCharCode(96)) && part.endsWith(String.fromCharCode(96)) && part.length > 2) {
        const code = document.createElement("code");
        code.textContent = part.slice(1,-1);
        parent.append(code);
      } else if (sources.has(part)) {
        const source = sources.get(part);
        parent.append(button(part, () => { source.open = true; source.scrollIntoView({block:"nearest"}); }, "Quelle " + part));
      } else parent.append(document.createTextNode(part));
    }
  }

  function markdown(text, sources) {
    const result = document.createDocumentFragment();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], fence = String.fromCharCode(96).repeat(3);
      if (line.startsWith(fence)) {
        const code = [];
        while (++i < lines.length && !lines[i].startsWith(fence)) code.push(lines[i]);
        const pre = document.createElement("pre");
        pre.textContent = code.join("\n");
        result.append(pre);
      } else if (line.includes("|") && /^\s*\|?[\s|:-]+$/.test(lines[i+1] || "") && /-{2}/.test(lines[i+1] || "")) {
        const table = document.createElement("table");
        const addRow = (row, kind) => {
          const tr = document.createElement("tr");
          for (const field of row.trim().replace(/^\||\|$/g,"").split("|").slice(0,12)) {
            const cell = document.createElement(kind);
            inline(cell,field.trim(),sources);
            tr.append(cell);
          }
          table.append(tr);
        };
        addRow(line,"th");
        i++;
        while (lines[i+1]?.includes("|")) addRow(lines[++i],"td");
        result.append(table);
      } else if (/^\s*(?:[-*]|\d+\.) /.test(line)) {
        const list = document.createElement(/^\s*\d+\./.test(line) ? "ol" : "ul");
        do {
          const item = document.createElement("li");
          inline(item,lines[i].replace(/^\s*(?:[-*]|\d+\.) /,""),sources);
          list.append(item);
        } while (/^\s*(?:[-*]|\d+\.) /.test(lines[i+1] || "") && ++i);
        result.append(list);
      } else if (line.trim()) {
        const title = line.match(/^#{1,6}\s+/);
        const element = document.createElement(title ? "h3" : "p");
        inline(element,title ? line.slice(title[0].length) : line,sources);
        result.append(element);
      }
    }
    return result;
  }

  function renderMessage(row, last) {
    const chat = selected;
    const item = document.createElement("article");
    item.className = "bubble " + row.role;
    const footer = document.createElement("div");
    footer.className = "bubble-controls";
    const sourceGroup = document.createElement("div");
    sourceGroup.className = "message-sources";
    const sources = new Map();
    for (const [index, source] of (row.sources || []).entries()) {
      const details = document.createElement("details");
      const heading = document.createElement("summary");
      const id = "[" + (source.id ?? index+1) + "]";
      heading.textContent = id + " " + source.title + (source.location ? " · " + source.location : "");
      const text = document.createElement("p");
      text.textContent = source.excerpt;
      details.append(heading,text);
      if (source.path && identity.role === "admin") details.append(button("Dokumentbibliothek öffnen", () => { location.hash = "#dokumente"; }));
      sourceGroup.append(details);
      sources.set(id,details);
    }
    if (row.role === "user") {
      const text = document.createElement("p");
      text.textContent = row.body;
      item.append(text);
    } else item.append(markdown(row.body || (row.state === "running" ? "Antwort wird vorbereitet …" : ""),sources));
    for (const file of row.attachments) {
      const label = document.createElement("p");
      label.className = "sent-file";
      label.textContent = file.name + " · " + (file.kind === "private" ? "Nur für diesen Chat" : "Wissensdatenbank");
      item.append(label);
    }
    if (row.route) {
      const route = document.createElement("span");
      route.textContent = tools[row.route] || row.route;
      footer.append(route);
    }
    if (status[row.state]) footer.append(document.createTextNode(status[row.state]));
    if (row.state === "done" && row.role === "assistant") footer.append(button("Kopieren", async () => {
      try { await navigator.clipboard.writeText(row.body); }
      catch { notice.textContent = "Kopieren ist über diese Verbindung nicht verfügbar."; }
    }));
    if (last && row.role === "assistant" && ["done","failed","interrupted","cancelled"].includes(row.state) &&
      !["ha_action","automation"].includes(row.route)) {
      footer.append(button("Erneut versuchen", () => void messageAction(chat,row.id,"retry")));
    }
    if (row.state === "confirmation") footer.append(button("Bestätigen", () => void messageAction(chat,row.id,"confirm")));
    item.append(sourceGroup,footer);
    return item;
  }

  function render() {
    const messages = [...older,...(detail?.messages || [])];
    const active = messages.at(-1);
    const live = active?.state === "running";
    const acting = messages.some(message => message.state === "acting");
    byId("chat-title").textContent = detail?.chat.title || "Neuer Chat";
    input.placeholder = detail?.chat.document ? "Frage zu " + detail.chat.document : "Schreib eine Nachricht …";
    byId("chat-empty").hidden = messages.length > 0;
    byId("chat-stop").hidden = !live;
    byId("chat-older").hidden = !(detail?.more || older.length);
    byId("chat-send").disabled = live || sending || acting || !!detail?.chat.archived || !identity?.chat_available;
    const signature = JSON.stringify(messages);
    if (renderingSignature !== signature) {
      const following = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90;
      const target = byId("chat-messages");
      target.replaceChildren(...messages.map((row,index) => renderMessage(row,index===messages.length-1)));
      renderingSignature = signature;
      if (following) scroll.scrollTop = scroll.scrollHeight;
    }
    renderDrafts();
  }

  async function refreshDetail() {
    clearTimeout(pollTimer);
    if (!selected || !identity || currentPage !== "chat") return;
    const id = selected, turn = ++detailSequence;
    try {
      const value = await api(base + "/" + id);
      if (turn !== detailSequence || id !== selected) return;
      detail = value;
      selections(identity.profiles,value.modes,detail.chat);
      render();
      if (detail.messages.some(row => ["running","acting"].includes(row.state))) {
        pollTimer = setTimeout(refreshDetail,520);
      }
    } catch (error) { reportError(error); }
  }

  byId("chat-older").addEventListener("click",async () => {
    if (!selected || !detail) return;
    try {
      const original = scroll.scrollHeight;
      const value = await api(base + "/" + selected + "?offset=" + (detail.messages.length + older.length));
      older = [...value.messages,...older];
      byId("chat-older").disabled = !value.more;
      render();
      scroll.scrollTop += scroll.scrollHeight - original;
    } catch (error) { reportError(error); }
  });

  async function messageAction(chat,id,action) {
    try {
      await api(base+"/"+chat+"/messages/"+id+"/"+action,action==="confirm" ? {
        ...jsonBody("POST",{confirmed:true}),timeout:50000
      } : {method:"POST"});
      await refreshDetail();
    } catch (error) { reportError(error); }
  }
  byId("chat-stop").addEventListener("click", () => {
    const item = detail?.messages.at(-1);
    if (item) void messageAction(selected,item.id,"cancel");
  });

  function renderDrafts() {
    const container = byId("chat-files");
    container.replaceChildren();
    for (const entry of files) {
      const card = document.createElement("div");
      card.className = "file-card";
      const caption = document.createElement("span");
      caption.textContent = entry.file.name + " · " + Math.ceil(entry.file.size/1024) + " KiB";
      const scope = document.createElement("select");
      scope.setAttribute("aria-label","Ablage für " + entry.file.name);
      scope.append(choice("Nur für diesen Chat","private"));
      if (identity?.role === "admin") scope.append(choice("In Wissensdatenbank speichern","global"));
      scope.value = entry.kind;
      scope.disabled = sending || !!entry.saved;
      scope.addEventListener("change", () => { entry.kind = scope.value; });
      card.append(caption,scope,button("Entfernen",async () => {
        if (sending) return;
        try {
          if (entry.saved) await api(base+"/"+selected+"/attachments/"+entry.saved.id,{method:"DELETE"});
          files = files.filter(file => file !== entry);
          requestID = "";
          renderDrafts();
        } catch (error) { reportError(error); }
      }));
      if (entry.progress) card.append(document.createTextNode(entry.progress));
      container.append(card);
    }
  }

  function addFiles(list) {
    if (sending) return;
    for (const file of list) {
      if (files.length >= 4) { notice.textContent = "Bis zu vier Anhänge pro Nachricht."; break; }
      if (!/\.(pdf|md|txt|docx|xlsx|csv|tsv|png|jpe?g|tiff?)$/i.test(file.name) || !file.size) {
        notice.textContent = file.name + " hat kein unterstütztes Dateiformat.";
      } else files.push({file,kind:"private"});
    }
    requestID = "";
    renderDrafts();
  }
  byId("attach-button").addEventListener("click", () => byId("chat-picker").click());
  byId("chat-picker").addEventListener("change",event => { addFiles(event.target.files); event.target.value = ""; });
  const chatArea = byId("chat");
  chatArea.addEventListener("dragover",event => {
    if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); byId("chat-drop").hidden=false; }
  });
  chatArea.addEventListener("dragleave",event => {
    if (!chatArea.contains(event.relatedTarget)) byId("chat-drop").hidden=true;
  });
  chatArea.addEventListener("drop",event => {
    event.preventDefault();
    byId("chat-drop").hidden=true;
    addFiles(event.dataTransfer.files);
  });

  function upload(entry,chat) {
    const route = base+"/"+chat+"/attachments/"+encodeURIComponent(entry.file.name)+"?kind="+entry.kind;
    return new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT",new URL("./api/v1/"+route,document.baseURI));
      xhr.setRequestHeader("Authorization","Bearer "+token);
      xhr.setRequestHeader("Content-Type","application/octet-stream");
      xhr.responseType = "json";
      xhr.timeout = 310000;
      const signal = session.signal;
      const abort = () => xhr.abort();
      signal.addEventListener("abort",abort,{once:true});
      xhr.onloadend = () => signal.removeEventListener("abort",abort);
      xhr.upload.onprogress = event => {
        entry.progress = event.lengthComputable ? "Upload " + Math.floor(event.loaded/event.total*100) + " %" : "Upload läuft …";
        renderDrafts();
      };
      xhr.upload.onload = () => { entry.progress="Wird verarbeitet …"; renderDrafts(); };
      xhr.onload = () => xhr.status===201 ? resolve(xhr.response) : reject(new Error(xhr.response?.error?.message || "Upload fehlgeschlagen."));
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error("Upload unterbrochen."));
      xhr.send(entry.file);
    });
  }

  function freshRequestID() {
    const id = crypto.getRandomValues(new Uint8Array(16));
    id[6] = (id[6] & 15) | 64;
    id[8] = (id[8] & 63) | 128;
    return Array.from(id,value => value.toString(16).padStart(2,"0")).join("");
  }

  byId("composer").addEventListener("submit",async event => {
    event.preventDefault();
    if (byId("chat-send").disabled) return;
    const text = input.value.trim();
    if (!text && !files.length) return;
    sending = true;
    notice.textContent = "";
    render();
    try {
      const id = selected || await create();
      for (const entry of files) {
        if (!entry.saved) entry.saved = await upload(entry,id);
        entry.progress = entry.kind === "private" ? "Gelesen" : "Zur Indexierung vorgemerkt";
      }
      requestID ||= freshRequestID();
      await api(base+"/"+id+"/messages",jsonBody("POST",{request_id:requestID,text,attachments:files.map(entry=>entry.saved.id)}));
      input.value = "";
      input.rows = 2;
      requestID = "";
      files = [];
      await refreshDetail();
      refreshHistory();
    } catch (error) { reportError(error); }
    finally { sending=false; render(); }
  });
  input.addEventListener("input", () => {
    requestID = "";
    input.rows = Math.min(7,Math.max(2,input.value.split("\n").length + Math.floor(input.value.length/92)));
  });
  input.addEventListener("keydown",event => {
    if (event.key==="Enter" && !event.shiftKey && !event.isComposing && !mobile.matches) {
      event.preventDefault();
      byId("composer").requestSubmit();
    }
  });

  function applyProfileDraft() {
    const id = byId("routing-profile").value;
    if (!settingsDraft?.profiles[id]) return;
    const profile = settingsDraft.profiles[id];
    for (const field of ["name","description","instruction","model","language","voice","preferred"]) {
      profile[field] = byId("profile-"+field).value;
    }
    profile.tools = [...byId("profile-tools").querySelectorAll("input:checked")].map(input => input.value);
  }

  function loadProfile(id) {
    byId("routing-profile").value = id;
    const profile = settingsDraft.profiles[id];
    for (const field of ["name","description","instruction","model","language","voice","preferred"]) {
      byId("profile-"+field).value = profile[field];
    }
    byId("profile-tools").replaceChildren(...Object.entries(tools).filter(([key])=>key!=="auto").map(([key,label])=>{
      const entry = document.createElement("label");
      entry.className="check";
      const input = document.createElement("input");
      input.type="checkbox"; input.value=key; input.checked=profile.tools.includes(key);
      entry.append(input,document.createTextNode(label));
      return entry;
    }));
  }
  byId("routing-profile").addEventListener("change",event => {
    const next=event.target.value;
    event.target.value=event.target.dataset.active;
    applyProfileDraft();
    loadProfile(next);
    event.target.dataset.active=next;
  });

  async function loadAdmin() {
    try {
      const data = await api("admin/intelligence");
      if (identity?.role !== "admin") return;
      settingsDraft=data.policy;
      byId("routing-turns").value=data.policy.turns;
      byId("routing-timeout").value=data.policy.timeout;
      byId("routing-entities").value=Object.entries(data.policy.entities).map(([a,e])=>a+" = "+e).join("\n");
      byId("routing-actions").value=data.policy.actions.join("\n");
      byId("routing-webhook").value=data.policy.automation_path;
      byId("routing-profile").replaceChildren(...Object.entries(data.policy.profiles).map(([id,p])=>choice(p.name,id)));
      byId("profile-preferred").replaceChildren(...Object.entries(modes).map(([id,label])=>choice(label,id)));
      loadProfile("general");
      byId("routing-profile").dataset.active="general";
      byId("route-availability").textContent=Object.entries(data.modes).map(([id,on])=>modes[id]+(on?" ✓":" · aus")).join(" · ");
      byId("routing-recent").replaceChildren(...data.recent.map(row=>{
        const li=document.createElement("li");
        li.textContent=(tools[row.route] || row.route)+" · "+row.state+" · "+new Date(row.created).toLocaleString("de-AT");
        return li;
      }));
    } catch (error) { byId("routing-message").textContent=error.message; }
  }
  byId("routing-form").addEventListener("submit",async event=>{
    event.preventDefault();
    if (!settingsDraft) return;
    try {
      applyProfileDraft();
      settingsDraft.turns=Number(byId("routing-turns").value);
      settingsDraft.timeout=Number(byId("routing-timeout").value);
      settingsDraft.entities=Object.fromEntries(byId("routing-entities").value.split("\n").filter(line=>line.trim()).map(line=>{
        const parts=line.split("=");
        if (parts.length!==2) throw new Error("Entitäten als Alias = Entität eintragen.");
        return parts.map(part=>part.trim());
      }));
      settingsDraft.actions=byId("routing-actions").value.split("\n").map(v=>v.trim()).filter(Boolean);
      settingsDraft.automation_path=byId("routing-webhook").value.trim();
      await api("admin/intelligence",jsonBody("PUT",settingsDraft));
      identity=await api("intelligence/session");
      selections(identity.profiles,identity.modes,detail?.chat);
      byId("routing-message").textContent="Gespeichert.";
    } catch (error) { byId("routing-message").textContent=error.message; }
  });

  byId("route-test").addEventListener("submit",async event => {
    event.preventDefault();
    try {
      const {route} = await api("admin/intelligence/test-routing",jsonBody("POST",{text:byId("route-test-text").value}));
      byId("route-test-result").textContent = tools[route] || route;
    } catch (error) { byId("route-test-result").textContent = error.message; }
  });

  window.intelligence = {
    login(value) {
      identity=value;
      byId("operator-label").textContent=value.role==="admin"?"Administration":"Chat";
      selections(value.profiles,value.modes);
      refreshHistory();
      render();
    },
    logout() {
      identity=null; historySequence++; resetChat();
      byId("history-list").replaceChildren();
      byId("routing-form").reset();
      byId("routing-recent").replaceChildren();
      byId("routing-message").textContent="";
      settingsDraft=null;
    },
    async fromDocument(path) {
      if (sending) return;
      resetChat();
      try { await pick(await create(path)); } catch (error) { reportError(error); }
    },
    navigate(page) {
      currentPage=page;
      document.body.classList.toggle("chat-active",page==="chat");
      if (mobile.matches) setSidebar(false);
      if (page==="chat") void refreshDetail();
      else clearTimeout(pollTimer);
      if (page==="routing" && identity?.role==="admin") void loadAdmin();
    }
  };
})();
