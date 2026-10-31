const $ = id => document.getElementById(id);
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (e) {} };
const recall = key => { try { return localStorage.getItem(key) || ""; } catch (e) { return ""; } };
const errorText = (detail, fallback) => Array.isArray(detail)
  ? (detail.map(d => (d && d.msg) || String(d)).join("; ") || fallback)
  : ((typeof detail === "string" && detail) || fallback);
const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const agentCoreLog = $("agentCoreLog");
const agentCoreMessage = $("agentCoreMessage");
const sendAgentCore = $("sendAgentCore");
const agentCoreStatus = $("agentCoreStatus");
const banner = $("banner");
const approvalPanel = $("approvalPanel");
const approvalRequests = $("approvalRequests");
const approvalStatus = $("approvalStatus");

let lastApprovalSignature = "";
let approvalsPolling = false;

let agentCoreNext = 0;
let failures = 0;
let corePolling = false;
let coreBusy = false;
let coreFiles = [];

const threadKey = id => "devpilot.thread." + id;

function loadThread(id) {
  try { return JSON.parse(recall(threadKey(id)) || "[]"); } catch (e) { return []; }
}

const TAG_LABELS = { change: "Change code", ask: "Ask" };

function saveThread(id, speaker, text, time, tags, basis) {
  try {
    const list = loadThread(id);
    list.push([speaker, text, time, tags || [], basis || null]);
    remember(threadKey(id), JSON.stringify(list.slice(-200)));
  } catch (e) {}
}

const isNearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

// "New messages" button that appears while you are reading older messages.
function jumpButton(log) {
  let button = log.querySelector(".jump");

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "jump";
    button.textContent = "New messages";
    button.hidden = true;
    button.addEventListener("click", () => { log.scrollTop = log.scrollHeight; button.hidden = true; });
    log.addEventListener("scroll", () => { if (isNearBottom(log)) button.hidden = true; });
    log.appendChild(button);
  }

  return button;
}

// Plain text with ``` code blocks and `inline code`. Built with DOM nodes only, never innerHTML.
function renderRich(container, text) {
  String(text).split("```").forEach((part, index) => {
    if (index % 2 === 1) {
      const newline = part.indexOf("\n");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = (newline >= 0 ? part.slice(newline + 1) : part).replace(/\n$/, "");
      pre.appendChild(code);
      container.appendChild(pre);
      return;
    }

    const clean = part.replace(/^\n+|\n+$/g, "");
    if (!clean) return;

    const block = document.createElement("div");
    clean.split(/(`[^`\n]+`)/).forEach(piece => {
      if (/^`[^`\n]+`$/.test(piece)) {
        const code = document.createElement("code");
        code.textContent = piece.slice(1, -1);
        block.appendChild(code);
      } else {
        block.appendChild(document.createTextNode(piece));
      }
    });
    container.appendChild(block);
  });
}

function showTyping(log) {
  hideTyping(log);

  const dots = document.createElement("div");
  dots.className = "chat-entry them typing";
  dots.setAttribute("aria-label", "Working");
  dots.innerHTML = "<span></span><span></span><span></span>";

  log.insertBefore(dots, log.querySelector(".jump"));
  log.scrollTop = log.scrollHeight;
}

function hideTyping(log) {
  const dots = log.querySelector(".typing");
  if (dots) dots.remove();
}

// persist false: restoring or a system line (not saved, no time). time: a saved timestamp.
// Small chip showing what a reply is based on. Details are in the tooltip.
function basisBadge(basis) {
  const files = Array.isArray(basis.files) ? basis.files : [];
  const list = files.join(", ");
  const kinds = {
    changed: ["code", "Changed code" + (files.length > 1 ? " · " + files.length + " files" : ""), files.length ? "Edited: " + list + ". Click to view the changes." : "Click to view the changes."],
    analyzed: ["search", "Analyzed project", files.length ? "Based on: " + list : "Based on your project files."],
    documents: ["file", "Read attached files", files.length ? "Based on: " + list : "Based on your attached files."],
    nochange: ["check", "No changes", "Nothing in your project was edited."],
    proposed: ["code", "Proposed code", "Code written in the chat. Nothing was applied to your files."],
    suggestion: ["bulb", "AI suggestion", "A general answer, not checked against your files."]
  };
  const info = kinds[basis.kind];

  if (!info) return document.createDocumentFragment();

  const chip = document.createElement(basis.kind === "changed" ? "button" : "span");
  chip.className = "basis";
  chip.dataset.kind = basis.kind;
  chip.title = info[2];
  chip.setAttribute("aria-label", info[1] + ". " + info[2]);
  chip.insertAdjacentHTML("afterbegin", icon(info[0]));
  chip.append(info[1]);

  if (basis.kind === "changed") {
    chip.type = "button";
    chip.addEventListener("click", () => showView("changes"));
  }

  return chip;
}

function appendChatMessage(log, speaker, text, persist, time, tags, basis) {
  const stamp = time || (persist !== false ? Date.now() : 0);
  const stick = persist === false || isNearBottom(log);

  if (persist !== false) {
    if (log === agentCoreLog) saveCore(speaker, text, stamp, basis, tags);
    else if (typeof projectLog !== "undefined" && log === projectLog && selectedProjectId) saveThread(selectedProjectId, speaker, text, stamp, tags, basis);
  }

  const entry = document.createElement("div");
  entry.className = "chat-entry " + (speaker === "You" ? "you" : "them");

  const heading = document.createElement("strong");
  heading.textContent = speaker + (stamp ? " · " + new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

  const content = document.createElement("div");
  renderRich(content, text);

  entry.append(heading);

  if (tags && tags.length) {
    const labels = document.createElement("div");
    labels.className = "msg-tags";

    for (const tag of tags) {
      const pill = document.createElement("span");
      pill.className = "msg-tag";
      pill.dataset.tag = tag;
      pill.title = TAG_LABELS[tag] || tag;
      pill.insertAdjacentHTML("afterbegin", icon(tag === "change" ? "code" : "help"));

      const hidden = document.createElement("span");
      hidden.className = "sr-only";
      hidden.textContent = TAG_LABELS[tag] || tag;
      pill.appendChild(hidden);
      labels.appendChild(pill);
    }

    entry.appendChild(labels);
  }

  if (basis) entry.appendChild(basisBadge(basis));

  entry.appendChild(content);
  log.insertBefore(entry, log.querySelector(".typing, .jump"));

  if (stick || speaker === "You") {
    log.scrollTop = log.scrollHeight;
  } else {
    jumpButton(log).hidden = false;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(errorText(data.detail, "Request failed."));
  }

  return data;
}


function renderApprovalRequests(requests) {
  const signature = JSON.stringify(requests);

  if (signature === lastApprovalSignature) return;
  lastApprovalSignature = signature;

  approvalRequests.replaceChildren();
  approvalPanel.hidden = requests.length === 0;

  requests.forEach(request => {
    const card = document.createElement("article");
    card.className = "approval-request";

    const heading = document.createElement("h3");
    heading.textContent = request.action.replaceAll("_", " ");
    card.appendChild(heading);

    const details = document.createElement("pre");
    details.textContent = JSON.stringify(request.details, null, 2);
    card.appendChild(details);

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.textContent = "Approve";

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.textContent = "Reject";
    rejectButton.className = "secondary";

    async function decide(approved) {
      approveButton.disabled = true;
      rejectButton.disabled = true;
      approvalStatus.textContent = "Submitting decision...";

      try {
        await postJson(
          `/approvals/${encodeURIComponent(request.request_id)}`,
          { approved }
        );

        approvalStatus.textContent = approved
          ? "Approval submitted."
          : "Rejection submitted.";

        lastApprovalSignature = "";
        await pollApprovals();
      } catch (error) {
        approvalStatus.textContent =
          "Could not submit the decision. Please try again.";
        approveButton.disabled = false;
        rejectButton.disabled = false;
      }
    }

    approveButton.addEventListener("click", () => decide(true));
    rejectButton.addEventListener("click", () => decide(false));

    actions.append(approveButton, rejectButton);
    card.appendChild(actions);
    approvalRequests.appendChild(card);
  });
}

async function pollApprovals() {
  if (approvalsPolling) return;
  approvalsPolling = true;

  try {
    const response = await fetch("/approvals");
    if (!response.ok) throw new Error("Could not load approvals");

    const data = await response.json();
    renderApprovalRequests(data.requests || []);
  } catch (error) {
    // Keep the UI usable if a temporary polling request fails.
  } finally {
    approvalsPolling = false;
  }
}

async function requestAI(capability, input, context = null) {
  const body = {
    capability,
    input,
  };

  if (context !== null) {
    body.context = context;
  }

  return postJson("/ai/request", body);
}

  // Current end of an event stream, so a new view never replays old events.
  async function latestCursor(url) {
    try {
      const response = await fetch(url + (url.includes("?") ? "&" : "?") + "after=0");
      if (!response.ok) return 0;
      const data = await response.json();
      return data.next ?? 0;
    } catch (error) {
      console.error("Could not read event cursor:", error);
      return 0;
    }
  }

  async function chooseFolder(targetInput, statusTarget) {
    statusTarget.textContent = "Opening folder picker...";

    try {
      const response = await fetch("/select-folder");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || "Could not open the folder picker.");
      }

      if (!data.path) {
        statusTarget.textContent = "No folder selected.";
        return;
      }

      targetInput.value = data.path;
      statusTarget.textContent = "Folder selected.";
    } catch (error) {
      statusTarget.textContent = error.message || "Folder selection failed.";
    }
  }

function noteOk() {
  failures = 0;
  banner.hidden = true;
}

function noteFail() {
  failures++;

  if (failures >= 3) {
    banner.textContent = "Can't reach the DevPilot server. Retrying...";
    banner.hidden = false;
  }
}

function saveCore(speaker, text, time, basis, tags) {
  try {
    const list = JSON.parse(recall("devpilot.core") || "[]");
    list.push([speaker, text, time, basis || null, tags || []]);
    remember("devpilot.core", JSON.stringify(list.slice(-200)));
  } catch (e) {}
}

function restoreCore() {
  try {
    const list = JSON.parse(recall("devpilot.core") || "[]");
    if (!list.length) return;

    agentCoreLog.replaceChildren();
    for (const [speaker, text, time, basis, tags] of list) {
      appendChatMessage(agentCoreLog, speaker, text, false, time, tags, basis);
    }
  } catch (e) {}
}

async function pollAgentCore() {
  if (corePolling) return;
  corePolling = true;

  try {
    const response = await fetch("/agent-core/events?after=" + agentCoreNext).catch(() => null);

    if (!response || !response.ok) {
      noteFail();
      return;
    }

    noteOk();
    const data = await response.json();

    for (const event of (data.events || [])) {
      if (event.type === "message") {
        hideTyping(agentCoreLog);
        appendChatMessage(agentCoreLog, "Agent Core", event.text, undefined, 0, undefined, event.basis);
        if (typeof onCoreMessage === "function") onCoreMessage();
        coreBusy = false;
        syncCoreSend();
        agentCoreStatus.textContent = "Response received.";
      } else if (event.type === "status") {
        agentCoreStatus.textContent = event.text;

        if (event.text === "failed") {
          hideTyping(agentCoreLog);
          coreBusy = false;
          syncCoreSend();
        }
      } else if (event.type === "error") {
        agentCoreStatus.textContent = event.text || "The task failed.";
        hideTyping(agentCoreLog);
        coreBusy = false;
        syncCoreSend();
      } else {
        appendChatMessage(agentCoreLog, event.type.replaceAll("_", " "), event.text || "");
      }
    }

    agentCoreNext = data.next ?? agentCoreNext;

    // Keep the position across page changes so no reply is skipped or replayed.
    try { sessionStorage.setItem("devpilot.coreNext", String(agentCoreNext)); } catch (e) {}
  } catch (error) {
    console.error("Could not retrieve Agent Core events:", error);
  } finally {
    corePolling = false;
  }
}

// One button, two states: arrow-up to send, square to stop while the agent is working.
function paintSendButton(button, busy, hasText) {
  button.classList.toggle("busy", busy);
  button.innerHTML = icon(busy ? "stop" : "arrowright");
  button.setAttribute("aria-label", busy ? "Stop" : "Send message");
  button.disabled = !busy && !hasText;
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
}

function syncCoreSend() {
  paintSendButton(sendAgentCore, coreBusy, !!agentCoreMessage.value.trim());
  const robot = $("coreBtn");
  if (robot) robot.classList.toggle("busy", coreBusy);
  autoGrow(agentCoreMessage);
}

async function stopAgentCore() {
  try {
    await postJson("/agent-core/stop", {});
  } catch (error) {
    agentCoreStatus.textContent = error.message || "Could not stop Agent Core.";
    return;
  }

  coreBusy = false;
  hideTyping(agentCoreLog);
  agentCoreStatus.textContent = "Stopped.";
  syncCoreSend();
}

let coreTags = [];
try { coreTags = JSON.parse(recall("devpilot.coreTags") || "[]").filter(tag => tag === "ask" || tag === "change"); } catch (e) {}

const CORE_PLACEHOLDER = "Ask anything, discuss the design, or drop a PDF here. Enter sends, Shift+Enter adds a line.";

function paintCoreTags() {
  for (const [id, tag] of [["coreModeChange", "change"], ["coreModeAsk", "ask"]]) {
    const on = coreTags.includes(tag);
    $(id).classList.toggle("on", on);
    $(id).setAttribute("aria-pressed", String(on));
  }

  const ask = coreTags.includes("ask");
  const change = coreTags.includes("change");

  agentCoreMessage.placeholder = ask && change ? "Ask a question and request a change. Enter sends."
    : ask ? "Ask anything. Nothing is changed. Enter sends."
    : change ? "Describe the code change you want. Enter sends."
    : CORE_PLACEHOLDER;
}

function toggleCoreTag(tag) {
  coreTags = coreTags.includes(tag) ? coreTags.filter(t => t !== tag) : [...coreTags, tag];
  remember("devpilot.coreTags", JSON.stringify(coreTags));
  paintCoreTags();
}

const coreTagMode = () => coreTags.length === 2 ? "both" : coreTags[0] || "auto";

$("coreModeChange").addEventListener("click", () => toggleCoreTag("change"));
$("coreModeAsk").addEventListener("click", () => toggleCoreTag("ask"));
paintCoreTags();

async function sendAgentCoreMessage() {
  const text = agentCoreMessage.value.trim();

  if (!text || coreBusy) return;

  coreBusy = true;

  appendChatMessage(agentCoreLog, "You", text + (coreFiles.length ? "\n[" + coreFiles.map(f => f.name).join(", ") + "]" : ""), true, 0, [...coreTags]);
  agentCoreMessage.value = "";
  showTyping(agentCoreLog);
  syncCoreSend();
  agentCoreStatus.textContent = "Sending to Agent Core...";

  try {
    await postJson("/agent-core/tasks", { message: text, mode: coreTagMode(), tags: coreTags, file_ids: coreFiles.map(f => f.id), file_names: coreFiles.map(f => f.name) });
    agentCoreStatus.textContent = "Agent Core is working...";
  } catch (error) {
    agentCoreStatus.textContent = error.message || "Could not start Agent Core task.";
    hideTyping(agentCoreLog);
    coreBusy = false;
        syncCoreSend();
  }
}

sendAgentCore.addEventListener("click", () => { if (coreBusy) stopAgentCore(); else sendAgentCoreMessage(); });
agentCoreMessage.addEventListener("input", syncCoreSend);

agentCoreMessage.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendAgentCoreMessage();
  }
});

async function startAgentCore() {
  restoreCore();

  let saved = null;
  try { saved = sessionStorage.getItem("devpilot.coreNext"); } catch (e) {}

  agentCoreNext = saved !== null ? Number(saved) : await latestCursor("/agent-core/events");
  setInterval(pollAgentCore, 1000);
}



// ---------- Top bar, icons, dialogs, theme ----------

const ICONS = Object.fromEntries(
  [...document.querySelectorAll(".svg-defs symbol")].map(symbol => [
    symbol.id.replace(/^i-/, ""),
    symbol.innerHTML
  ])
);

Object.assign(ICONS, {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>'
});


Object.assign(ICONS, {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  restore: '<path d="M9 3v6H3M15 21v-6h6M21 9h-6V3M3 15h6v6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  diagram: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 4-9 5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  folderopen: '<path d="M3 18.5V6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5V10"/><path d="M3 18.5 5.5 11a1.5 1.5 0 0 1 1.4-1H21l-2.6 8.2a1.5 1.5 0 0 1-1.4 1.3H4.5A1.5 1.5 0 0 1 3 18.5z"/>'
});

function stackIconName(stack) {
  const name = String(stack || "").toLowerCase();

  if (name.includes("python")) return "python";
  if (name.includes("react")) return "react";
  if (name.includes("rust")) return "rust";
  if (name.includes("javascript") || name.includes("node")) return "javascript";
  if (name.includes("typescript")) return "typescript";
  if (name.includes("java")) return "java";
  if (name.includes("go")) return "go";
  if (name.includes("docker")) return "docker";

  return "code";
}

const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

function stackIcon(stack) {
  const name = stackIconName(stack);
  return icon(ICONS[name] ? name : "code");
}

// Maps a file name to the icon name of its technology, so the project tree
// shows e.g. the Python mark on .py files and React on .jsx files. The name
// is drawn through the tree's existing --glyph mask, not an inline SVG.
function fileIconName(fileName) {
  const base = fileName.toLowerCase().split("/").pop();

  if (base === "dockerfile" || base.endsWith(".dockerfile")) return "docker";
  if (base.startsWith("vite.config.")) return "javascript";

  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";

  const byExtension = {
    py: "python",
    jsx: "react",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    java: "java",
    go: "go",
    rs: "rust",
    html: "browser",
  };

  const name = byExtension[extension];
  return name && ICONS[name] ? name : "file";
}

function treeGlyphStyle(fileName) {
  const body = ICONS[fileIconName(fileName)] || ICONS.file;
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + body + "</svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Brand-like colors for tree file icons, matching common editor themes.
const FILE_ICON_COLORS = {
  python: "#4B8BBE",
  react: "#61DAFB",
  javascript: "#F1E05A",
  typescript: "#3178C6",
  java: "#E76F00",
  go: "#00ADD8",
  rust: "#DEA584",
  docker: "#2496ED",
  browser: "#E44D26",
};

function initChrome() {
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => '<symbol id="i-' + name + '" viewBox="0 0 24 24">' + body + '</symbol>')
    .join("");

  document.body.insertAdjacentHTML("afterbegin", `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${symbols}</defs></svg>

    <header class="topbar">
      <div class="topbar-in">
        <span class="brand">
          <img src="/static/resources/robot.png" alt="DevPilot robot" class="brand-icon">
            DevPilot
        </span>

        <div class="menu" data-feature="menu.file">
          <button class="ghost" id="fileMenuBtn" type="button" aria-haspopup="true" aria-expanded="false">
            ${icon("file")}File${icon("chevron")}
          </button>
          <div class="menu-list" id="fileMenu" hidden>
            <button id="menuNew" type="button">${icon("plus")}New project</button>
            <button id="menuImport" type="button">${icon("download")}Import project</button>
          </div>
        </div>

        

        <div class="menu" data-feature="menu.help">
          <button class="ghost" id="helpMenuBtn" type="button" aria-haspopup="true" aria-expanded="false">
            ${icon("help")}Help${icon("chevron")}
          </button>
          <div class="menu-list" id="helpMenu" hidden>
            <button id="aboutBtn" type="button">${icon("info")}About</button>
          </div>
        </div>

        <span class="grow"></span>

        <button class="ghost icon-only" id="checkpointBtn" type="button" data-feature="checkpoint" data-self-managed
                aria-label="Save a checkpoint" aria-expanded="false" title="Save a checkpoint"
                hidden><span class="checkpoint-icon" data-state="stable"></span></button>
        <button class="ghost icon-only core-btn" id="coreBtn" type="button" data-feature="agent_core" aria-label="Agent Core" aria-expanded="false" title="Agent Core">${icon("bot")}<span class="badge" hidden></span></button>
        <button class="ghost icon-only" id="themeBtn" type="button" data-feature="theme_toggle"></button>
      </div>
    </header>

    <dialog id="aboutDialog">
      <h3>${icon("compass")}About DevPilot</h3>
      <p class="muted">A local coding agent. Create a project from your stack selection — with environment checks and one-click installs — or import an existing folder or GitHub repository. Describe what you want, DevPilot works on a separate git branch, and you review the changes before accepting them.</p>
      <ul>
        <li>Version 0.1.0</li>
        <li>Runs fully on your computer with Ollama (model: qwen3-4b-local)</li>
        <li>Project AI builds your project. Agent Core discusses and improves DevPilot itself.</li>
      </ul>
      <div class="actions end"><button class="secondary" type="button" data-close>${icon("x")}Close</button></div>
    </dialog>

    `);

  const fileBtn = $("fileMenuBtn");
  const fileMenu = $("fileMenu");
  const setMenu = open => { fileMenu.hidden = !open; fileBtn.setAttribute("aria-expanded", String(open)); };

  fileBtn.addEventListener("click", event => { event.stopPropagation(); setHelpMenu(false); setMenu(fileMenu.hidden); });
  document.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", event => { if (event.key === "Escape") setMenu(false); });

  const helpMenuBtn = $("helpMenuBtn");
  const helpMenu = $("helpMenu");
  const setHelpMenu = open => { helpMenu.hidden = !open; helpMenuBtn.setAttribute("aria-expanded", String(open)); };

  helpMenuBtn.addEventListener("click", event => { event.stopPropagation(); setMenu(false); setHelpMenu(helpMenu.hidden); });
  document.addEventListener("click", () => setHelpMenu(false));
  document.addEventListener("keydown", event => { if (event.key === "Escape") setHelpMenu(false); });

  $("aboutBtn").addEventListener("click", () => $("aboutDialog").showModal());

  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", event => { if (event.target === dialog && dialog.id !== "projectDialog") dialog.close(); });
    dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
  });

  const isDark = () => {
    const chosen = document.documentElement.dataset.theme;
    return chosen ? chosen === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };

  const paintTheme = () => {
    $("themeBtn").innerHTML = icon(isDark() ? "sun" : "moon");
    $("themeBtn").setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
  };

  $("themeBtn").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    remember("devpilot.theme", next);
    paintTheme();
  });

  paintTheme();
}

initChrome();

// ---------- Feature flags (config/features.txt via GET /features) ----------
// Any id missing from the file is ON by default, so new features appear
// without touching the file; add a line there to switch one off.
const FEATURE_SPLITTER_NEIGHBORS = {
  0: ["panel.explorer", "panel.assistant"],
  1: ["panel.assistant", "panel.canvas"],
};

let featureFlags = {};

function featureOn(id) {
  return featureFlags[id] !== false;
}

function applyFeatureFlags() {
  document.querySelectorAll("[data-feature]").forEach(el => {
    // Some elements manage their own visibility on top of the flag
    // (the checkpoint button also needs runtime conditions met).
    if (el.dataset.selfManaged) return;
    el.hidden = !featureOn(el.dataset.feature);
  });

  // A splitter between two panes is useless when either pane is off.
  document.querySelectorAll(".splitter[data-split]").forEach(el => {
    const neighbors = FEATURE_SPLITTER_NEIGHBORS[el.dataset.split] || [];
    el.hidden = neighbors.length > 0 && neighbors.some(id => !featureOn(id));
  });

  // Never leave a hidden canvas tab as the active view.
  const visibleViews = VIEWS.filter(
    view => !view.soon && featureOn("canvas.tab." + view.id),
  );
  if (visibleViews.length && !featureOn("canvas.tab." + activeView)) {
    showView(visibleViews[0].id);
  }
}

async function loadFeatureFlags() {
  try {
    const response = await fetch("/features");
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.features) featureFlags = data.features;
  } catch (error) {
    console.warn("Feature flags unavailable; everything stays on.", error);
  }
  applyFeatureFlags();
}

loadFeatureFlags();

// ---------- Checkpoint: suggest committing before a change ----------
// Shown only when: the feature flag allows it, no task is running, nothing
// waits for review, the server answers, and uncommitted changes exist.
// "Auto" commits silently instead of opening the popover.
const checkpointBtn = $("checkpointBtn");

const CHECKPOINT_NODE =
  '<svg class="icon node" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M2.5 12H7M17 12h4.5"/></svg>';
const CHECKPOINT_CHECK =
  '<svg class="icon check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9.6 12.1 1.7 1.7 3.1-3.4"/></svg>';
const CHECKPOINT_RING = '<span class="checkpoint-ring" aria-hidden="true"></span>';

let checkpointChanges = -1;   // -1 = status unknown (server unreachable)
let checkpointAutoDone = false;
let checkpointBusy = false;
let checkpointSavedTimer = 0;

function checkpointConditionsMet() {
  return (
    featureOn("checkpoint") &&
    checkpointChanges > 0 &&
    !running &&
    !(typeof reviewBar !== "undefined" && reviewBar && !reviewBar.hidden)
  );
}

function paintCheckpoint(state) {
  const holder = checkpointBtn?.querySelector(".checkpoint-icon");
  if (!holder) return;

  holder.dataset.state = state;
  checkpointBtn.hidden = state === "hidden";

  if (state === "stable") {
    holder.innerHTML = CHECKPOINT_NODE + CHECKPOINT_CHECK;
    checkpointBtn.title = "Save a checkpoint before your next change";
  } else if (state === "committing") {
    holder.innerHTML = CHECKPOINT_NODE + CHECKPOINT_RING;
    checkpointBtn.title = "Saving checkpoint...";
  } else if (state === "saved") {
    holder.innerHTML = CHECKPOINT_NODE + CHECKPOINT_CHECK;
    checkpointBtn.title = "Checkpoint saved";
  }
}

async function refreshCheckpoint() {
  if (checkpointBusy) return;

  try {
    const response = await fetch("/checkpoint");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "unreachable");

    checkpointChanges = data.changes ?? 0;
  } catch (error) {
    checkpointChanges = -1;
    paintCheckpoint("hidden");
    return;
  }

  if (checkpointChanges === 0) checkpointAutoDone = false;

  if (checkpointConditionsMet()) {
    paintCheckpoint("stable");

    // Auto mode commits silently, once per dirty period.
    if (checkpointAutoEnabled() && !checkpointAutoDone) {
      checkpointAutoDone = true;
      commitCheckpoint("checkpoint: before change", true);
    }
  } else {
    paintCheckpoint("hidden");
  }
}

function checkpointAutoEnabled() {
  return recall("devpilot.checkpoint.auto") === "1";
}

async function commitCheckpoint(message, silent) {
  if (checkpointBusy) return;
  checkpointBusy = true;
  paintCheckpoint("committing");
  closeCheckpointPopover();

  try {
    const result = await postJson("/checkpoint", { message });

    if (result.committed) {
      checkpointChanges = 0;
      paintCheckpoint("saved");
      clearTimeout(checkpointSavedTimer);
      checkpointSavedTimer = setTimeout(refreshCheckpoint, 3000);
    } else {
      checkpointChanges = 0;
      paintCheckpoint("hidden");
    }

    if (!silent) {
      checkpointToast(
        result.committed
          ? "Checkpoint saved."
          : "Nothing to commit — everything is already saved.",
      );
    }
  } catch (error) {
    paintCheckpoint("stable");
    checkpointToast(error.message || "Checkpoint failed.");
  } finally {
    checkpointBusy = false;
  }
}

function checkpointToast(text) {
  let toast = document.getElementById("checkpointToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "checkpointToast";
    toast.className = "checkpoint-toast";
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2600);
}

// --- popover ---
function buildCheckpointPopover() {
  const pop = document.createElement("div");
  pop.id = "checkpointPopover";
  pop.className = "checkpoint-popover";
  pop.hidden = true;

  const title = document.createElement("strong");
  title.textContent = "Save a checkpoint?";

  const body = document.createElement("p");
  body.id = "checkpointPopoverText";

  const message = document.createElement("input");
  message.id = "checkpointMessage";
  message.type = "text";
  message.value = "checkpoint: before change";
  message.setAttribute("aria-label", "Checkpoint message");

  const actions = document.createElement("div");
  actions.className = "checkpoint-actions";

  const commit = document.createElement("button");
  commit.type = "button";
  commit.className = "checkpoint-commit";
  commit.textContent = "Commit";

  const notNow = document.createElement("button");
  notNow.type = "button";
  notNow.className = "secondary";
  notNow.textContent = "Not now";

  const autoRow = document.createElement("label");
  autoRow.className = "checkpoint-auto";
  const auto = document.createElement("input");
  auto.type = "checkbox";
  auto.id = "checkpointAutoToggle";
  auto.checked = checkpointAutoEnabled();
  const autoText = document.createElement("span");
  autoText.textContent = "Auto";
  autoRow.append(auto, autoText);

  actions.append(commit, notNow, autoRow);
  pop.append(title, body, message, actions);
  document.body.append(pop);

  commit.addEventListener("click", () =>
    commitCheckpoint(message.value.trim() || "checkpoint: before change", false),
  );
  notNow.addEventListener("click", closeCheckpointPopover);
  auto.addEventListener("change", () => {
    remember("devpilot.checkpoint.auto", auto.checked ? "1" : "0");
    if (auto.checked) closeCheckpointPopover();
  });
  document.addEventListener("click", event => {
    if (!pop.hidden && !pop.contains(event.target) && event.target !== checkpointBtn &&
        !checkpointBtn.contains(event.target)) {
      closeCheckpointPopover();
    }
  });

  return pop;
}

function openCheckpointPopover() {
  const pop = $("checkpointPopover") || buildCheckpointPopover();
  const text = $("checkpointPopoverText");
  const n = checkpointChanges;
  text.textContent =
    n === 1
      ? "Project is stable. 1 change is not committed yet."
      : `Project is stable. ${n} changes are not committed yet.`;

  const rect = checkpointBtn.getBoundingClientRect();
  pop.hidden = false;
  pop.style.top = rect.bottom + 8 + "px";
  pop.style.left = Math.max(8, rect.right - pop.offsetWidth) + "px";
  checkpointBtn.setAttribute("aria-expanded", "true");
}

function closeCheckpointPopover() {
  const pop = document.getElementById("checkpointPopover");
  if (pop) pop.hidden = true;
  checkpointBtn?.setAttribute("aria-expanded", "false");
}

if (checkpointBtn) {
  checkpointBtn.addEventListener("click", () => {
    const pop = document.getElementById("checkpointPopover");
    if (pop && !pop.hidden) closeCheckpointPopover();
    else openCheckpointPopover();
  });

  setInterval(refreshCheckpoint, 8000);
  refreshCheckpoint();
}

// ---------- Workspace ----------
const projectList = $("projectList");
const listStatus = $("listStatus");
const treeBlock = $("treeBlock");
const treeList = $("treeList");
const treeStatus = $("treeStatus");
const treeTitle = $("treeTitle");
const projectLog = $("projectLog");
const projectMessage = $("projectMessage");
const sendProject = $("sendProject");
const stopTask = $("stopTask");
const retryTask = $("retryTask");
const projectChatStatus = $("projectChatStatus");
const statusLine = $("status");
const steps = $("steps");
const taskMeta = $("taskMeta");
const diff = $("diff");
const changesStatus = $("changesStatus");
const changesEmpty = $("changesEmpty");
const reviewBar = $("reviewBar");
const reviewSummary = $("reviewSummary");
const acceptChanges = $("acceptChanges");
const rejectChanges = $("rejectChanges");
const previewFrame = $("previewFrame");
const previewEmpty = $("previewEmpty");
const previewTitle = $("previewTitle");
const storyMap = $("storyMap");
const storyEmpty = $("storyEmpty");
const viewTabs = $("viewTabs");

const projectDialog = $("projectDialog");
const dialogTitle = $("dialogTitle");
const dialogNameInput = $("dialogNameInput");
const idPreview = $("idPreview");
const languageBlock = $("languageBlock");
const projectPath = $("projectPath");
const dialogStatus = $("dialogStatus");
const dialogCreate = $("dialogCreate");

const importDialog = $("importDialog");
const importDialogStatus = $("importDialogStatus");
const importDialogPreview = $("importDialogPreview");
const importDialogSubmit = $("importDialogSubmit");
const importProjectPath = $("importProjectPath");
const importGithubUrl = $("importGithubUrl");

let selectedProjectId = "";
let knownProjects = new Set();
let projectNext = 0;
let changedFiles = new Set();
let running = false;
let taskStart = 0;
let stepCount = 0;
let lastTaskText = "";
let projectPolling = false;
let dialogMode = "create";
let activeView = "preview";
let seen = {};

// Views on the right. Add a view here and give it a matching .view block to extend the page.
const VIEWS = [
  { id: "preview", label: "Preview", icon: "eye" },
  { id: "story_map", label: "Story map", icon: "map" },
  { id: "class_diagram", label: "Class diagram", icon: "diagram", soon: true },
  { id: "changes", label: "Changes", icon: "git" },
  { id: "steps", label: "Steps", icon: "list" }
];

function buildTabs() {
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seg-btn";
    button.dataset.view = view.id;
    button.dataset.feature = "canvas.tab." + view.id;
    button.title = view.label + (view.soon ? " (soon)" : "");
    button.setAttribute("aria-label", view.label);
    button.disabled = !!view.soon;
    button.innerHTML = icon(view.icon) + view.label + (view.soon ? " (soon)" : "");
    button.addEventListener("click", () => showView(view.id));
    viewTabs.appendChild(button);
  }
}

function showView(id) {
  activeView = id;

  document.querySelectorAll(".view").forEach(el => { el.hidden = el.dataset.view !== id; });
  viewTabs.querySelectorAll(".seg-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.view === id);
    if (button.dataset.view === id) button.querySelector(".dot")?.remove();
  });
}

function markUpdated(id) {
  const button = viewTabs.querySelector('[data-view="' + id + '"]');
  if (!button || activeView === id || button.querySelector(".dot")) return;

  const dot = document.createElement("span");
  dot.className = "dot";
  button.appendChild(dot);
}


// ----- output views -----
function renderPreview(output) {
  const has = !!(output && output.html);
  previewEmpty.hidden = has;
  previewFrame.hidden = !has;
  previewTitle.textContent = has ? selectedProjectId + " / " + (output.title || "") : "";
  if (has) previewFrame.srcdoc = output.html;
}

function renderStoryMap(output) {
  storyMap.replaceChildren();
  const columns = (output && output.columns) || [];
  storyEmpty.hidden = columns.length > 0;

  const allStories = columns.flatMap(c => c.stories || []);
  const doneStories = allStories.filter(s => s.status === "done").length;
  $("storySummary").textContent = allStories.length ? selectedProjectId + ": " + doneStories + " of " + allStories.length + " stories done" : "";

  for (const column of columns) {
    const col = document.createElement("div");
    col.className = "sm-col";

    const epic = document.createElement("div");
    epic.className = "sm-epic";
    epic.textContent = column.epic;
    col.appendChild(epic);

    for (const story of (column.stories || [])) {
      const card = document.createElement("div");
      card.className = "sm-story " + (story.status === "done" ? "done" : "todo");
      card.textContent = story.title;

      const small = document.createElement("small");
      small.textContent = story.id + (story.status === "done" ? " - done" : "");
      card.appendChild(small);

      col.appendChild(card);
    }

    storyMap.appendChild(col);
  }
}

const RENDERERS = { preview: renderPreview, story_map: renderStoryMap };

// mode "quiet" only fills the views. mode "switch" jumps to a view whose content changed.
function applyOutput(view, value, mode) {
  const signature = JSON.stringify(value || null);
  const changed = (seen[view] || "null") !== signature;
  seen[view] = signature;

  RENDERERS[view](value);

  if (changed && value && mode === "switch") showView(view);
  else if (changed && value && mode !== "quiet") markUpdated(view);
}

async function loadOutputs(mode) {
  if (!selectedProjectId) return;

  try {
    const requested = selectedProjectId;
    const response = await fetch("/outputs?project_id=" + encodeURIComponent(selectedProjectId));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || requested !== selectedProjectId) return;

    for (const view of Object.keys(RENDERERS)) applyOutput(view, data[view], mode);
  } catch (error) {
    console.error("Could not load outputs:", error);
  }
}

function clearOutputs() {
  seen = {};
  renderPreview(null);
  renderStoryMap(null);
  diff.replaceChildren();
  changesEmpty.hidden = false;
  reviewBar.hidden = true;
  steps.replaceChildren();
  statusLine.textContent = "Waiting for a project task.";
}

// ----- files -----
function buildTree(paths) {
  const root = { dirs: {}, files: [] };

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    const isDir = path.endsWith("/");
    let node = root;

    parts.forEach((part, index) => {
      if (index === parts.length - 1 && !isDir) {
        node.files.push({ name: part, path });
      } else {
        node.dirs[part] = node.dirs[part] || { dirs: {}, files: [] };
        node = node.dirs[part];
      }
    });
  }

  return root;
}

function renderNode(node, list) {
  for (const name of Object.keys(node.dirs).sort()) {
    const item = document.createElement("li");
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = name + "/";

    const children = document.createElement("ul");
    renderNode(node.dirs[name], children);

    details.append(summary, children);
    item.appendChild(details);
    list.appendChild(item);
  }

  for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    const item = document.createElement("li");
    item.className = "file" + (changedFiles.has(file.path) ? " changed" : "");
    item.style.setProperty("--glyph", treeGlyphStyle(file.name));
    const color = FILE_ICON_COLORS[fileIconName(file.name)];
    if (color) item.style.setProperty("--glyph-color", color);
    item.textContent = file.name;
    item.title = "Open " + file.path;
    item.addEventListener("click", () => openFile(file.path));
    list.appendChild(item);
  }
}

async function loadTree() {
  if (!selectedProjectId) return;

  try {
    const response = await fetch("/tree?project_id=" + encodeURIComponent(selectedProjectId));
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(data.detail || "Could not load files.");

    const files = data.files || [];
    treeList.replaceChildren();

    if (!files.length) {
      treeStatus.textContent = "No files yet. Describe what you want to build.";
      return;
    }

    treeStatus.textContent = "";
    renderNode(buildTree(files), treeList);
  } catch (error) {
    treeStatus.textContent = error.message || "Could not load files.";
  }
}

// Refresh button for one section: spins while loading, then confirms with "Updated <time>".
async function refreshWith(button, statusEl, task, label) {
  if (button.disabled) return;

  button.disabled = true;
  button.classList.add("spinning");
  statusEl.textContent = "Refreshing " + label + "...";

  const started = Date.now();

  try { await task(); } catch (e) {}

  const wait = 600 - (Date.now() - started);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

  button.classList.remove("spinning");
  button.disabled = false;

  if (statusEl.textContent === "Refreshing " + label + "..." || statusEl.textContent === "") {
    const note = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    statusEl.textContent = note;
    setTimeout(() => { if (statusEl.textContent === note) statusEl.textContent = ""; }, 3000);
  }
}

$("refreshTree").addEventListener("click", event => refreshWith(event.currentTarget, treeStatus, async () => { await loadTree(); await loadOutputs("quiet"); }, "files"));

// Shows a project file in the Preview view: HTML runs, anything else is shown as text.
async function openFile(path) {
  try {
    const response = await fetch("/file?project_id=" + encodeURIComponent(selectedProjectId) + "&path=" + encodeURIComponent(path));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Could not open the file.");

    let html = data.content || "";

    if (!/\.html?$/i.test(path)) {

const pre = document.createElement("pre");
pre.textContent = html;

html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html {
      min-height: 100%;
    }

    body {
      margin: 0;
      padding: 12px;
      box-sizing: border-box;
      color: #1f2937;
      background: #fff;
      font: 13px/1.55 Consolas, "Cascadia Code", monospace;
      overflow: auto;
    }

    pre {
      margin: 0;
      white-space: pre;
      overflow-wrap: normal;
      tab-size: 4;
      width: max-content;
      min-width: 100%;
    }
  </style>
</head>
<body>${pre.outerHTML}</body>
</html>`;

    }

    renderPreview({ title: path, html });
    showView("preview");
  } catch (error) {
    treeStatus.textContent = error.message || "Could not open the file.";
  }
}
// ----- projects -----

async function loadProjects() {
  listStatus.textContent = "Loading projects...";

  try {
    const response = await fetch("/projects");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not load projects.");
    }

    const projects = data.projects || [];

    knownProjects = new Set(projects.map(project => project.id));
    projectList.replaceChildren();

    for (const project of projects) {
      const item = document.createElement("li");

      // Open project button with a colorful icon of its stack selection
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.dataset.id = project.id;
      openButton.className =
        project.id === selectedProjectId ? "active" : "";

      if (project.stack) {
        const stackName = stackIconName(project.stack);
        const color = FILE_ICON_COLORS[stackName];
        const svg = icon(ICONS[stackName] ? stackName : "code");
        openButton.innerHTML = color
          ? `<span class="stack-mark" style="color:${color}">${svg}</span>`
          : svg;
      } else {
        openButton.innerHTML = icon("folder");
      }

      openButton.append(document.createTextNode(project.id));

      // Alarm when the project's workspace folder is gone from the disk.
      if (project.workspace_missing) {
        const alarm = document.createElement("span");
        alarm.className = "missing-workspace";
        alarm.title =
          "Workspace folder is missing on this computer. " +
          "The project can still be deleted from the list.";
        alarm.innerHTML = icon("alert");
        openButton.append(alarm);
      }

      openButton.addEventListener("click", () => {
        selectProject(project.id);
      });

      // Delete project button with trash icon
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-project";
      deleteButton.title =
        'Move "' + project.id + '" to the Recycle Bin';
      deleteButton.setAttribute(
        "aria-label",
        'Move project "' + project.id + '" to the Recycle Bin'
      );

      deleteButton.innerHTML =
        '<svg class="icon" aria-hidden="true">' +
        '<use href="#i-trash"></use>' +
        '</svg>';

      deleteButton.addEventListener("click", async event => {
        event.stopPropagation();

        // Ask for confirmation before deleting
        if (
          !confirm(
            'Move project "' + project.id + '" to the Recycle Bin?'
          )
        ) {
          return;
        }

        deleteButton.disabled = true;
        listStatus.textContent =
          "Moving project to the Recycle Bin...";

        try {
          // Stop the task if this project is currently running
              if (selectedProjectId === project.id && running) {
                try {
                  await postJson("/tasks/stop", {
                    project_id: project.id
                  });
                } catch (error) {
                  console.error("Could not stop the project task before deletion:", error);
                }
              }

          // Delete the project
          const deleteResponse = await fetch(
            "/projects/" + encodeURIComponent(project.id),
            { method: "DELETE" }
          );

          const result = await deleteResponse.json().catch(() => ({}));

          if (!deleteResponse.ok) {
            throw new Error(
              result.detail || "Could not delete the project."
            );
          }

          // Reset the interface if this was the selected project
          if (selectedProjectId === project.id) {
            selectedProjectId = "";
            remember("devpilot.project", "");

            setRunning(false);
            taskStart = 0;
            stepCount = 0;
            changedFiles = new Set();

            if (taskMeta) {
              taskMeta.textContent = "";
            }

            if (retryTask) {
              retryTask.hidden = true;
            }

            if (treeBlock) {
              treeBlock.hidden = true;
            }

            if (treeList) {
              treeList.replaceChildren();
            }

            clearOutputs();
            setChatEnabled(false);
            projectLog.replaceChildren();

            appendChatMessage(
              projectLog,
              "Project AI",
              "Create, import, or open a project to start.",
              false
            );
          }

          // Refresh the project list
          await loadProjects();

          listStatus.textContent =
            result.workspace_removed === false
              ? "Project removed from the list (its workspace folder was already gone)."
              : "Project moved to the Recycle Bin.";
        } catch (error) {
          listStatus.textContent =
            error.message || "Could not delete the project.";

          deleteButton.disabled = false;
        }
      });

      // Add both buttons to the project row
      item.append(openButton, deleteButton);
      projectList.appendChild(item);
    }

    listStatus.textContent = projects.length
      ? ""
      : "No projects yet. Create or import one.";
  } catch (error) {
    listStatus.textContent =
      error.message || "Could not load projects.";
  }
}

$("refreshProjects").addEventListener("click", event => refreshWith(event.currentTarget, listStatus, loadProjects, "projects"));

function setChatEnabled() {
  projectMessage.placeholder = currentPlaceholder();

  const badge = $("projectBadge");
  badge.textContent = selectedProjectId ? "Changes only in: " + selectedProjectId : "No project selected";
  badge.title = selectedProjectId ? "Project AI reads and edits files in " + selectedProjectId + " only." : "";
  badge.classList.toggle("none", !selectedProjectId);
}

async function selectProject(id) {
  if (id === selectedProjectId && running) return;
  if (running && id !== selectedProjectId) {
    if (!confirm('A task is still running in "' + selectedProjectId + '". Stop it and switch to "' + id + '"?')) return;
    try { await postJson("/tasks/stop", { project_id: selectedProjectId }); } catch (e) {}
  }

  selectedProjectId = id;
  remember("devpilot.project", id);

  taskStart = 0;
  stepCount = 0;
  changedFiles = new Set();
  retryTask.hidden = true;
  setRunning(false);
  taskMeta.textContent = "";

  projectList.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.id === id));
  treeBlock.hidden = false;
  treeTitle.textContent = id;
  treeList.replaceChildren();

  clearOutputs();
  setChatEnabled(true);

  projectLog.replaceChildren();
  const saved = loadThread(id);

  if (saved.length) {
    for (const [who, message, time, tags, basis] of saved) appendChatMessage(projectLog, who, message, false, time, tags, basis);
  } else {
    appendChatMessage(projectLog, "Project AI", "Ready. Everything you ask here applies only to " + id + ".", false);
  }
  projectChatStatus.textContent = "";

  const requested = id;
  projectNext = await latestCursor("/events?project_id=" + encodeURIComponent(id));
  if (requested !== selectedProjectId) return;
  loadTree();
  loadOutputs("quiet");
  showView("preview");
  projectMessage.focus();
}

function closeProject() {
  if (running && !confirm("A task is still running. Close the project anyway?")) return;

  selectedProjectId = "";
  remember("devpilot.project", "");
  setRunning(false);
  taskStart = 0;
  taskMeta.textContent = "";

  projectList.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  treeBlock.hidden = true;
  clearOutputs();
  setChatEnabled(false);
  projectLog.replaceChildren();
  appendChatMessage(projectLog, "Project AI", "Create, import, or open a project to start.", false);
}

// ----- create / import dialog -----
function importSource() {
  const radio = document.querySelector('input[name="source"]:checked');
  return radio ? radio.value : "folder";
}

const lastPart = text => String(text).trim().replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "";

// The project id comes from the chosen folder name, or from the repository name.
function importId() {
  const raw = importSource() === "github" ? lastPart($("githubUrl").value).replace(/\.git$/i, "") : lastPart(projectPath.value);
  return slugify(raw);
}

function updateIdPreview() {
  if (dialogMode === "import") {
    const importId_ = importId();
    const taken = knownProjects.has(importId_);

    $("importPreview").textContent = !importId_ ? "" : taken ? 'A project "' + importId_ + '" already exists.' : "Will be imported as: " + importId_;
    dialogCreate.disabled = !!importId_ && taken;
    return;
  }

  const raw = dialogNameInput.value.trim();
  const id = slugify(raw);
  const taken = knownProjects.has(id);

  if (!raw) idPreview.textContent = "";
  else if (!id) idPreview.textContent = "Use letters or numbers in the name.";
  else if (taken) idPreview.textContent = 'A project "' + id + '" already exists. Choose another name.';
  else idPreview.textContent = "Will be saved as: " + id;

  const blocked = !!raw && (!id || taken);
  dialogCreate.disabled = blocked;

  // The idPreview hint lives on the first step and is out of view by the
  // final step, so mirror the reason into the status line beside the
  // Create button. Only messages we set here are cleared here.
  if (blocked) {
    dialogStatus.classList.add("error");
    dialogStatus.dataset.nameBlock = "1";
    dialogStatus.textContent = !id
      ? "Enter a project name with letters or numbers."
      : `A project "${id}" already exists. Choose a different name.`;
  } else if (dialogStatus.dataset.nameBlock) {
    delete dialogStatus.dataset.nameBlock;
    dialogStatus.classList.remove("error");
    dialogStatus.textContent = "";
  }
}

dialogNameInput.addEventListener("input", updateIdPreview);
projectPath.addEventListener("input", updateIdPreview);
$("githubUrl").addEventListener("input", updateIdPreview);

document.querySelectorAll('input[name="source"]').forEach(radio => radio.addEventListener("change", () => {
  const github = importSource() === "github";
  $("githubBlock").hidden = !github;
  $("pathLabel").hidden = github;
  projectPath.parentElement.hidden = github;
  updateIdPreview();
}));

async function openProjectDialog(mode) {
  dialogMode = mode;
  dialogTitle.innerHTML = icon(mode === "create" ? "plus" : "download") + (mode === "create" ? "New project" : "Import project");
  dialogCreate.lastChild.textContent = mode === "create" ? "Create" : "Import";
   const creating = mode === "create";

  languageBlock.hidden = !creating;
  $("nameBlock").hidden = !creating;
  $("sourceBlock").hidden = creating;

  // Show the correct content for the selected workflow.
  projectDialog.querySelectorAll(".wizard-section").forEach(section => {
    section.hidden = section.dataset.section !== (creating ? "details" : "workspace");
  });

  // Import uses the workspace path, not the five-step navigation.
  $("wizardBack").hidden = !creating;
  $("wizardNext").hidden = !creating;
  dialogCreate.hidden = false;

  if (creating) {
    projectDialog.showWizardStep(0);
  }
  $("githubBlock").hidden = true;
  $("githubUrl").value = "";
  $("importPreview").textContent = "";
  $("pathLabel").hidden = false;
  projectPath.parentElement.hidden = false;
  $("pathLabel").textContent = "Project folder";
  projectPath.placeholder = "Click Browse and select a folder — do not type the path";
  document.querySelector('input[name="source"][value="folder"]').checked = true;
  dialogNameInput.value = "";
  $("projectSummary").value = "";
  idPreview.textContent = "";
  dialogStatus.classList.remove("error");
  delete dialogStatus.dataset.nameBlock;
  dialogStatus.textContent = "";
  dialogCreate.disabled = false;
  projectPath.value = "";
  projectPath.placeholder = "Click Browse and select a folder — do not type the path";

    // Reset project architecture selections for each new project.
  projectDialog.querySelectorAll('input[name="appType"]').forEach(input => {
    input.checked = false;
  });

  [
    "frontendStack",
    "backendStack",
    "databaseStack",
    "testingStack",
    "securityStack",
    "deploymentStack",
    "scalingStack",
  ].forEach(id => {
    $(id).value = "";
  });

  stackCheckToken++;
  resetEnvironmentStep();
  // Tabs must be recomputed after the fields are cleared above, otherwise
  // a reopened dialog shows stale completed ticks from the previous session.
  projectDialog.updateWizardTabs?.();
  projectDialog.showModal();
  dialogNameInput.focus();
}

// --- Environment checks (wizard step 4) ---------------------------------

const environmentStatus = $("environmentStatus");
const environmentList = $("environmentList");
const environmentEmpty = $("environmentEmpty");

const ENVIRONMENT_SOURCES = [
  ["frontendStack", "Frontend"],
  ["backendStack", "Backend & API"],
  ["databaseStack", "Database"],
  ["testingStack", "Testing"],
  ["securityStack", "Security"],
  ["deploymentStack", "Deployment"],
  ["scalingStack", "Scaling"],
];

// Backend statuses mapped onto the card states. check_failed gets its own
// "failed" card state so unverifiable technologies are distinguishable.
const ENVIRONMENT_CARD_STATUS = {
  installed: "installed",
  version_mismatch: "mismatch",
  not_installed: "missing",
  check_failed: "failed",
};

const ENVIRONMENT_PILL_LABEL = {
  installed: "Installed",
  mismatch: "Version mismatch",
  missing: "Not installed",
  unchecked: "Not checked",
  failed: "Check failed",
};

const ENVIRONMENT_INSTALL_HINTS = {
  python: "https://www.python.org/downloads/",
  node: "https://nodejs.org/en/download",
  npm: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
  java: "https://www.java.com/download/",
  go: "https://go.dev/dl/",
  rust: "https://www.rust-lang.org/tools/install",
  php: "https://www.php.net/downloads.php",
  ruby: "https://www.ruby-lang.org/en/downloads/",
  dotnet: "https://dotnet.microsoft.com/download",
  docker: "https://docs.docker.com/get-docker/",
  git: "https://git-scm.com/downloads",
  postgresql: "https://www.postgresql.org/download/",
  mysql: "https://dev.mysql.com/downloads/",
  sqlite: "https://www.sqlite.org/download.html",
  mongodb: "https://www.mongodb.com/try/download/",
  redis: "https://redis.io/docs/latest/operate/oss_and_stack/install/",
};

const ENVIRONMENT_HINT_ALIASES = {
  "node.js": "node",
  nodejs: "node",
  postgres: "postgresql",
  golang: "go",
  rustc: "rust",
  mongo: "mongodb",
  sqlite3: "sqlite",
};

let environmentCheckToken = 0;

function collectStackRequirements() {
  const found = new Map();

  ENVIRONMENT_SOURCES.forEach(([inputId, component]) => {
    $(inputId).value
      .split(/[,+]/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(name => {
        const key = name.toLowerCase();
        if (!found.has(key)) found.set(key, { component, name });
      });
  });

  return [...found.values()];
}

function environmentMonogram(name) {
  const letters = name.replace(/[^a-z0-9]/gi, "");
  return (letters.slice(0, 3) || "?").toUpperCase();
}

function environmentCard(item) {
  const card = document.createElement("div");
  card.className = "environment-item";
  card.dataset.status = "unchecked";

  const head = document.createElement("div");
  head.className = "environment-item-head";

  // The checkbox marks the stack as selected for the project. Cards exist
  // only for technologies the user entered, so they start selected.
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.className = "environment-select";
  checkbox.setAttribute("aria-label", `Select ${item.name}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) return;
    removeTechnologyFromFields(item.name);
    card.remove();
    refreshEnvironmentSummary();
    projectDialog.dispatchEvent(new Event("change"));
  });

  const mark = document.createElement("span");
  mark.className = "technology-mark";
  mark.textContent = environmentMonogram(item.name);

  const info = document.createElement("span");
  info.className = "technology-info";
  const name = document.createElement("strong");
  name.textContent = item.name;
  const component = document.createElement("small");
  component.textContent = item.component;
  info.append(name, component);

  const pill = document.createElement("span");
  pill.className = "status-pill unchecked";
  pill.textContent = "Checking…";

  head.append(checkbox, mark, info, pill);
  card.append(head);
  return card;
}

// Removes one technology token from whichever stack field contains it.
function removeTechnologyFromFields(name) {
  const target = name.toLowerCase();

  ENVIRONMENT_SOURCES.forEach(([inputId]) => {
    const input = $(inputId);
    const parts = input.value
      .split(",")
      .map(part => part.trim())
      .filter(part => part && part.toLowerCase() !== target);

    const next = parts.join(", ");
    if (input.value !== next) {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function environmentVersionGrid(card, requested, detected) {
  card.querySelector(".version-grid")?.remove();

  const grid = document.createElement("div");
  grid.className = "version-grid";

  [["Requested", requested], ["Detected", detected]].forEach(([label, value]) => {
    const cell = document.createElement("div");
    const small = document.createElement("small");
    small.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value || "—";
    cell.append(small, strong);
    grid.append(cell);
  });

  card.append(grid);
}

function environmentDetails(card, note, command) {
  card.querySelector(".environment-details")?.remove();

  const details = document.createElement("details");
  details.className = "environment-details";

  const summary = document.createElement("summary");
  summary.textContent = "Details";
  details.append(summary);

  const noteParagraph = document.createElement("p");
  noteParagraph.textContent = note;
  details.append(noteParagraph);

  // The exact install/update command lives here, not on the card face.
  if (command) {
    const commandParagraph = document.createElement("p");
    commandParagraph.className = "environment-command-line";
    commandParagraph.textContent = `Command: ${command}`;
    details.append(commandParagraph);
  }

  card.append(details);
}

// Visible install/update button on the card itself, driven by the backend
// stack catalog (config/stacks.json). Nothing runs without confirmation.
function environmentActionRow(card, action) {
  card.querySelector(".environment-action")?.remove();
  if (!action) return;

  const row = document.createElement("div");
  row.className = "environment-action";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.dataset.envAction = action.kind;
  button.dataset.envName = action.name;
  button.dataset.envCommand = action.command;
  button.textContent = action.kind === "update" ? "Update now" : "Install now";

  row.append(button);
  card.append(row);
}

function environmentInstallHint(name) {
  const key = ENVIRONMENT_HINT_ALIASES[name.toLowerCase()] || name.toLowerCase();
  return ENVIRONMENT_INSTALL_HINTS[key] || null;
}

function applyEnvironmentResult(card, result) {
  const status = ENVIRONMENT_CARD_STATUS[result.status] || "unchecked";
  card.dataset.status = status;

  const pill = card.querySelector(".status-pill");
  pill.className = `status-pill ${status}`;
  pill.textContent = ENVIRONMENT_PILL_LABEL[status];

  const detected = result.detected_version || "";
  const requested = result.requested_version || "";
  const runtime = result.runtime ? ` through ${result.runtime}` : "";
  if (requested) card.dataset.requested = requested;

  environmentVersionGrid(card, requested, detected);

  // One-click actions come from the backend stack catalog (config/stacks.json):
  // install when missing, update whenever a newer configured version exists.
  const action =
    status === "missing" && result.install_supported && result.install_command
      ? { kind: "install", name: result.name, command: result.install_command }
      : status !== "missing" && result.update_command
        ? { kind: "update", name: result.name, command: result.update_command }
        : null;
  environmentActionRow(card, action);
  const command = action?.command || null;

  if (result.note) {
    environmentDetails(card, result.note, command);
    return;
  }

  if (status === "installed") {
    environmentDetails(
      card,
      `${result.name} is available on this computer${runtime}` +
        (detected ? ` (version ${detected}).` : ".") +
        (action ? " You can update it to the newer configured version, or keep the installed one." : ""),
      command,
    );
  } else if (status === "mismatch") {
    environmentDetails(
      card,
      `Requested version ${requested}, but version ${detected} is installed` +
        `${runtime}. Press Update to move to the new version, or keep the ` +
        `installed one by setting the requested version to ${detected} in the Stack step.`,
      command,
    );
  } else if (status === "missing") {
    const url = environmentInstallHint(result.name);
    environmentDetails(
      card,
      url
        ? `${result.name} was not found on this computer${runtime}. Install it manually from ${url}.`
        : `${result.name} was not found on this computer${runtime}.`,
      command,
    );
  } else {
    environmentDetails(
      card,
      "DevPilot cannot verify this technology automatically. Review it on this computer yourself.",
      command,
    );
  }
}

function refreshEnvironmentSummary() {
  const cards = [...environmentList.querySelectorAll(".environment-item")];
  const counts = { installed: 0, mismatch: 0, missing: 0, unchecked: 0 };

  cards.forEach(card => {
    // Check-failed technologies are reported under "Not checked": they were
    // not successfully verified either, and the card itself says why.
    if (card.dataset.status === "failed" || card.dataset.status === "unchecked") {
      counts.unchecked += 1;
    } else if (counts[card.dataset.status] !== undefined) {
      counts[card.dataset.status] += 1;
    }
  });

  $("countInstalled").textContent = counts.installed;
  $("countMismatch").textContent = counts.mismatch;
  $("countMissing").textContent = counts.missing;
  $("countUnchecked").textContent = counts.unchecked;

  const active =
    projectDialog.querySelector(".environment-filter.active")?.dataset.filter || "all";
  cards.forEach(card => {
    card.hidden =
      active !== "all" &&
      card.dataset.status !== active &&
      !(active === "unchecked" && card.dataset.status === "failed");
  });
}

function resetEnvironmentStep() {
  environmentCheckToken++;
  environmentList.replaceChildren();
  environmentEmpty.hidden = false;
  environmentEmpty.textContent =
    "Environment checks will run automatically when you open this step.";
  delete environmentStatus.dataset.checked;
  environmentStatus.textContent = "";
  refreshEnvironmentSummary();
}

async function runEnvironmentCheck() {
  const token = ++environmentCheckToken;
  const requirements = collectStackRequirements();

  delete environmentStatus.dataset.checked;
  environmentList.replaceChildren();

  if (!requirements.length) {
    environmentEmpty.hidden = false;
    environmentEmpty.textContent =
      "Add technologies in the Stack step first — they will be checked here.";
    environmentStatus.textContent = "";
    refreshEnvironmentSummary();
    return;
  }

  environmentEmpty.hidden = true;
  requirements.forEach(item => environmentList.append(environmentCard(item)));
  refreshEnvironmentSummary();
  environmentStatus.textContent =
    `Checking ${requirements.length} technologies on this computer…`;

  try {
    const data = await postJson("/environment/check", {
      mode: "local",
      requirements,
    });
    if (token !== environmentCheckToken) return;

    const results = Array.isArray(data.results) ? data.results : [];
    const cards = [...environmentList.querySelectorAll(".environment-item")];
    results.forEach((result, index) => {
      if (cards[index]) applyEnvironmentResult(cards[index], result);
    });

    environmentStatus.dataset.checked = "true";
    environmentStatus.textContent =
      `Checked ${results.length} technologies on this computer.`;
  } catch (error) {
    if (token !== environmentCheckToken) return;
    environmentStatus.textContent =
      error.message || "Could not check the local environment.";
  }

  refreshEnvironmentSummary();
  projectDialog.dispatchEvent(new Event("change"));
}

projectDialog.addEventListener("wizard-environment-step", () => runEnvironmentCheck());
$("checkEnvironment")?.addEventListener("click", () => runEnvironmentCheck());

environmentList.addEventListener("click", async event => {
  const button = event.target.closest("[data-env-action]");
  if (!button || !button.dataset.envName) return;

  const name = button.dataset.envName;
  const kind = button.dataset.envAction; // "install" | "update"
  const command = button.dataset.envCommand || "";

  const confirmed = confirm(
    `DevPilot will run this command on your computer:\n\n${command}\n\nProceed with the ${kind}?`,
  );
  if (!confirmed) return;

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = kind === "update" ? "Updating…" : "Installing…";
  environmentStatus.textContent =
    `Running the ${kind} for ${name}. This can take a few minutes.`;

  try {
    const result = await postJson("/environment/install", {
      name,
      action: kind,
    });

    const card = button.closest(".environment-item");
    if (card) {
      applyEnvironmentResult(card, {
        name,
        status: result.status,
        requested_version: card.dataset.requested || "",
        detected_version: result.detected_version,
        runtime: null,
        note: null,
      });

      const details = card.querySelector(".environment-details");
      if (details && result.output) {
        const output = document.createElement("p");
        output.className = "install-output";
        output.textContent = "Command output:\n" + result.output.slice(0, 600);
        details.append(output);
      }
    }

    environmentStatus.textContent =
      result.status === "installed"
        ? `${name} ${kind === "update" ? "updated" : "installed"} successfully` +
          (result.detected_version ? ` (version ${result.detected_version}).` : ".")
        : `The ${kind} command finished, but ${name} is still not detected. See the card details for the output.`;

    refreshEnvironmentSummary();
    projectDialog.dispatchEvent(new Event("change"));
  } catch (error) {
    environmentStatus.textContent =
      error.message || `The ${kind} request failed.`;
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

let stackCheckToken = 0;
let stackTimer = 0;

// The user types the stack (or picks one the AI suggests).
function chosenStack() {
  const name = $("stackInput").value.trim();
  return name ? { id: name.toLowerCase(), name } : null;
}

if ($("stackInput")) $("stackInput").addEventListener("input", () => {
  clearTimeout(stackTimer);
  stackCheckToken++;

  if (!$("stackInput").value.trim()) { $("stackCheck").hidden = true; return; }
  stackTimer = setTimeout(checkStack, 600);
});

// Asks the backend whether the typed stack's runtime is installed, and which version.
async function checkStack() {
  const box = $("stackCheck");
  const stack = chosenStack();
  const token = ++stackCheckToken;

  box.replaceChildren();

  if (!stack) { box.hidden = true; return; }

  box.hidden = false;
  box.textContent = "Checking " + stack.name + " on this computer...";

  let result = {};
  let failure = "";

  try {
    const response = await fetch("/languages/check?stack=" + encodeURIComponent(stack.name));
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(data.detail || "Could not check this computer.");
    result = data;
  } catch (error) {
    failure = error.message || "Could not check this computer.";
  }

  if (token !== stackCheckToken) return;

  box.replaceChildren();

  const runtime = result.runtime || stack.name;
  const text = failure
    ? failure
    : result.no_install
      ? "Nothing to install for " + stack.name + "."
      : result.installed
        ? runtime + " is installed. Version " + (result.version || "unknown") + "."
        : runtime + " is not installed on this computer. You can still create the project and install it later to run tests and the preview.";

  box.append(text + " ");

  if (!failure && !result.installed && !result.no_install && result.url) {
    const download = document.createElement("a");
    download.href = result.url;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.textContent = "Download";
    box.append(download, " · ");
  }

  const recheck = document.createElement("a");
  recheck.href = "#";
  recheck.textContent = "Re-check installed";
  recheck.addEventListener("click", event => { event.preventDefault(); checkStack(); });
  box.appendChild(recheck);
}

// "Not sure?": the user describes the goal and the AI suggests stacks.


// Quick suggestions, used when the AI backend cannot answer.
function localStackAdvice(text) {
  const t = String(text).toLowerCase();

  if (/api|backend|server|database|service/.test(t)) return [
    { stack: "Python + FastAPI", reason: "Quick to build, easy to read" },
    { stack: "Node.js + Express", reason: "Same language as the web front end" },
    { stack: "Java + Spring Boot", reason: "Solid for large business systems" }
  ];

  if (/web|site|page|app|booking|shop|store/.test(t)) return [
    { stack: "React + Node.js", reason: "Rich, interactive web apps" },
    { stack: "Static HTML, CSS, JS", reason: "Simple pages, nothing to install" },
    { stack: "Python + Flask", reason: "Small sites with a simple server" }
  ];

  return [
    { stack: "Python", reason: "Good all-round start" },
    { stack: "JavaScript (Node.js)", reason: "Works for web and tools" },
    { stack: "Static HTML, CSS, JS", reason: "Simplest, nothing to install" }
  ];
}


// Shows suggested stacks. Clicking one fills the stack field and checks it on this computer.
function renderStackSuggestions(items) {
  const list = $("stackSuggestions");
  list.replaceChildren();

  if (!items.length) {
    list.textContent = "No recommendations were returned.";
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "stack-suggestion";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.style.cursor = "pointer";

    const heading = document.createElement("div");
    heading.className = "stack-suggestion-heading";
    heading.insertAdjacentHTML("beforeend", stackIcon(item.stack));
    const title = document.createElement("strong");
    title.textContent = item.stack;
    heading.appendChild(title);
    card.appendChild(heading);

    if (item.reason) {
      const reason = document.createElement("p");
      reason.textContent = item.reason;
      card.appendChild(reason);
    }

    const choose = () => { $("stackInput").value = item.stack; checkStack(); };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
    });

    list.appendChild(card);
  }
}

// Accepts the different shapes the backend may return and turns them into { stack, reason }.
function normalizeStacks(data) {
  const raw = data?.result?.recommendations || data?.result?.suggestions || data?.recommendations || data?.suggestions || [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => typeof item === "string"
      ? { stack: item.trim(), reason: "" }
      : {
          stack: String(item?.stack || item?.name || item?.title || item?.technology || "").trim(),
          reason: String(item?.reason || item?.description || item?.rationale || "").trim()
        })
    .filter(item => item.stack);
}

async function suggestStacks() {
  const description = $("projectSummary").value.trim();
  const status = $("stackGuideStatus");
  const button = $("stackSuggest");

  const fields = {
    frontend: "frontendStack",
    backend: "backendStack",
    database: "databaseStack",
    testing: "testingStack",
    security: "securityStack",
    deployment: "deploymentStack",
    scaling: "scalingStack"
  };

  if (!description) {
    status.textContent = "Enter the project summary first.";
    return;
  }

  button.disabled = true;
  status.textContent = "Asking AI to suggest architecture...";
  $("stackSuggestions").replaceChildren();

  try {
    const context = selectedProjectId
      ? { project_id: selectedProjectId }
      : null;

    const data = await requestAI(
      "stack-recommendations",
      { description },
      context
    );

    const suggestionsResult =
    data?.result?.suggestions || data?.suggestions;

    const architecture =
      data?.result?.architecture || data?.architecture;

    const result =
      suggestionsResult || architecture?.[component];

    if (
      !architecture ||
      !Object.keys(fields).every(
        key =>
          typeof architecture[key] === "string" &&
          architecture[key].trim()
      )
    ) {
      throw new Error("The AI returned an incomplete architecture.");
    }

    for (const [key, elementId] of Object.entries(fields)) {
      $(elementId).value = architecture[key].trim();
    }

    status.textContent =
      architecture.reason || "Architecture suggestions applied. You can edit any field.";
  } catch (error) {
    console.error("Architecture suggestion failed:", error);
    status.textContent =
      "Could not generate architecture suggestions. Please try again.";
  } finally {
    button.disabled = false;
  }
}

if ($("stackSuggest")) $("stackSuggest").addEventListener("click", suggestStacks);

// AI recommendation and manual stack selection share the same editor.
function updateStackSourceUI() {
  const source = projectDialog.querySelector('input[name="stackSource"]:checked')?.value || "ai";
  const aiMode = source === "ai";

  $("stackSuggest").hidden = !aiMode;
  $("stackGuide").hidden = !aiMode;
  $("stackInput").placeholder = aiMode
    ? "Choose an AI recommendation or edit the stack"
    : "Enter your preferred technologies, e.g. React, FastAPI, PostgreSQL";

  if (!aiMode) {
    $("stackGuideStatus").textContent = "";
    $("stackSuggestions").replaceChildren();
  }
}


const architectureFields = {
  frontend: "frontendStack",
  backend: "backendStack",
  database: "databaseStack",
  testing: "testingStack",
  security: "securityStack",
  deployment: "deploymentStack",
  scaling: "scalingStack"
};

function updateSelectedStackSuggestion(input, optionsElement) {
  const currentValue = input.value.trim();

  optionsElement.querySelectorAll(".stack-ai-option").forEach(option => {
    option.setAttribute(
      "aria-pressed",
      String(option.textContent.trim() === currentValue)
    );
  });
}

async function suggestArchitectureField(component, button) {
  const description = $("projectSummary").value.trim();
  const input = $(architectureFields[component]);

  if (!description) {
    $("projectSummary").focus();
    alert("Please describe the project before requesting a technology suggestion.");
    return;
  }

  const originalPlaceholder = input.placeholder;
  const suggestionLabels = {
    frontend: "Frontend",
    backend: "Backend & API",
    database: "Database & persistence",
    testing: "Testing & code quality",
    security: "Security & configuration",
    deployment: "Deployment & operations",
    scaling: "Scalability & advanced operations"
  };

  const fieldContainer = input.closest(".architecture-body");
  const row = input.closest(".architecture-input-row");

  if (!fieldContainer || !row) {
    alert("Could not find the technology field layout.");
    return;
  }

  let section = fieldContainer.querySelector(".stack-ai-suggestion-section");
let optionsElement;

if (!section) {
  // Reuse an existing options container if one is already present.
  optionsElement = fieldContainer.querySelector(".stack-ai-options");

  if (!optionsElement) {
    section = document.createElement("section");
    section.className = "stack-ai-suggestion-section";
    section.setAttribute("aria-live", "polite");

    const heading = document.createElement("p");
    heading.className = "stack-ai-suggestion-heading";
    heading.textContent =
      "AI suggestions for " + (suggestionLabels[component] || component);

    optionsElement = document.createElement("div");
    optionsElement.className = "stack-ai-options";
    optionsElement.setAttribute("role", "group");
    optionsElement.setAttribute(
      "aria-label",
      "AI suggestions for " + (suggestionLabels[component] || component)
    );

    section.append(heading, optionsElement);
    row.insertAdjacentElement("afterend", section);
  }
} else {
  optionsElement = section.querySelector(".stack-ai-options");
}

  if (!section) {
    section = document.createElement("section");
    section.className = "stack-ai-suggestion-section";
    section.setAttribute("aria-live", "polite");

    const heading = document.createElement("p");
    heading.className = "stack-ai-suggestion-heading";
    heading.textContent = "AI suggestions for " +
      (suggestionLabels[component] || component);

    const options = document.createElement("div");
    options.className = "stack-ai-options";
    options.setAttribute("role", "group");
    options.setAttribute(
      "aria-label",
      "AI suggestions for " + (suggestionLabels[component] || component)
    );

    section.append(heading, options);
    row.insertAdjacentElement("afterend", section);
  }

  optionsElement = section.querySelector(".stack-ai-options");

  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  input.placeholder = "AI is suggesting a technology…";

  try {
    const context = selectedProjectId
      ? { project_id: selectedProjectId }
      : null;

    const data = await requestAI(
      "stack-recommendations",
      {
        description,
        target_component: component
      },
      context
    );

    const suggestionsResult =
      data?.result?.suggestions ||
      data?.suggestions;

    const architecture =
      data?.result?.architecture ||
      data?.architecture;

    const result =
      suggestionsResult ||
      architecture?.[component];

    let suggestions = Array.isArray(result)
      ? result
      : typeof result === "string"
        ? result.split(/\r?\n|;/)
        : [];

    suggestions = [...new Set(
      suggestions
        .filter(item => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    )];

    if (!suggestions.length) {
      throw new Error("No suggestion was returned for " + component + ".");
    }

    optionsElement.replaceChildren();

    suggestions.forEach(suggestion => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "stack-ai-option";
      option.textContent = suggestion;
      option.setAttribute("aria-pressed", String(input.value.trim() === suggestion));

      option.addEventListener("click", () => {
      input.value = suggestion;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      updateSelectedStackSuggestion(input, optionsElement);
      });
      optionsElement.appendChild(option);
    });

    section.hidden = false;
  } catch (error) {
    console.error("Architecture suggestion failed:", error);
    alert(
      "Could not suggest a technology for " + component +
      ". Your current selection has been preserved. Please try again."
    );
  } finally {
    input.placeholder = originalPlaceholder;
    button.disabled = false;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
  }
}

Object.values(architectureFields).forEach(inputId => {
  const input = $(inputId);
  const fieldContainer = input.closest(".architecture-body");

  input.addEventListener("input", () => {
    const optionsElement = fieldContainer?.querySelector(
      ".stack-ai-suggestion-section .stack-ai-options"
    );

    if (optionsElement) {
      updateSelectedStackSuggestion(input, optionsElement);
    }
  });
});

Object.entries(architectureFields).forEach(([component]) => {
  const button = projectDialog.querySelector(
    `[data-suggest-component="${component}"]`
  );

  if (button) {
    button.addEventListener("click", () => {
      suggestArchitectureField(component, button);
    });
  }
});


function chosenStack() {
  const fields = Object.values(architectureFields);
  const technologies = fields
    .map(id => $(id).value.trim())
    .filter(Boolean);

  if (!technologies.length) return null;

  const name = technologies.join(", ");
  return { id: name.toLowerCase(), name };
}





async function openImportDialog() {
  // Match the New dialog's header: icon + label instead of a plain heading.
  $("importDialogTitle").innerHTML = icon("download") + "Import project";
  importDialogStatus.classList.remove("error");
  importDialogStatus.textContent = "";
  importDialogPreview.textContent = "";
  importDialogSubmit.disabled = false;
  importProjectPath.value = "";
  importGithubUrl.value = "";

  importDialog.querySelector(
    'input[name="importSourceChoice"][value="folder"]'
  ).checked = true;

  $("importGithubBlock").hidden = true;
  $("importFolderBlock").hidden = false;

  updateImportDialogPreview();
  importDialog.showModal();
}


importDialog.querySelectorAll('input[name="importSourceChoice"]').forEach(radio => {
  radio.addEventListener("change", () => {
    const github = importDialog.querySelector('input[name="importSourceChoice"]:checked')?.value === "github";
    $("importGithubBlock").hidden = !github;
    $("importFolderBlock").hidden = github;
    importDialogPreview.textContent = "";
    importDialogStatus.textContent = "";
  });
});

$("importBrowseProject").addEventListener("click", async () => {
  await chooseFolder(importProjectPath, importDialogStatus);
});
$("newProject").addEventListener("click", () => openProjectDialog("create"));
$("importProject").addEventListener("click", () => openImportDialog());
$("dialogCancel").addEventListener("click", () => projectDialog.close());
$("dialogClose").addEventListener("click", () => projectDialog.close());

$("menuNew").addEventListener("click", () => openProjectDialog("create"));
$("menuImport").addEventListener("click", () => openImportDialog());

$("importDialogClose").addEventListener("click", () => importDialog.close());
$("importDialogCancel").addEventListener("click", () => importDialog.close());

function selectedImportSource() {
  return importDialog.querySelector(
    'input[name="importSourceChoice"]:checked'
  )?.value || "folder";
}

function importDialogId() {
  const source = selectedImportSource();
  const raw = source === "github"
    ? lastPart(importGithubUrl.value.trim()).replace(/\.git$/i, "")
    : lastPart(importProjectPath.value.trim());

  return slugify(raw);
}

function updateImportDialogPreview() {
  const id = importDialogId();

  if (!id) {
    importDialogPreview.textContent = "";
    importDialogSubmit.disabled = false;
    return;
  }

  const exists = knownProjects.has(id);
  importDialogPreview.textContent = exists
    ? `A project "${id}" already exists.`
    : `Project ID: ${id}`;

  importDialogSubmit.disabled = exists;
}

importProjectPath.addEventListener("input", updateImportDialogPreview);
importGithubUrl.addEventListener("input", updateImportDialogPreview);

importDialogSubmit.addEventListener("click", async () => {
  const source = selectedImportSource();
  const id = importDialogId();
  const path = importProjectPath.value.trim();
  const url = importGithubUrl.value.trim();

  const refuse = message => {
    importDialogStatus.classList.add("error");
    importDialogStatus.textContent = message;
    importDialogStatus.scrollIntoView({ block: "nearest" });
  };

  importDialogStatus.classList.remove("error");
  importDialogStatus.textContent = "";

  if (!id) {
    refuse(source === "github"
      ? "Enter a GitHub repository URL."
      : "Choose a project folder.");
    return;
  }

  if (knownProjects.has(id)) {
    refuse(`A project "${id}" already exists. Choose a different source.`);
    return;
  }

  if (source === "folder" && !path) {
    refuse("Choose a project folder.");
    return;
  }

  if (source === "github") {
    let validUrl = false;

    try {
      const link = new URL(url);
      validUrl =
        link.protocol === "https:" &&
        link.hostname === "github.com" &&
        link.pathname.split("/").filter(Boolean).length >= 2;
    } catch (error) {
      // The URL is invalid.
    }

    if (!validUrl) {
      refuse("Enter a valid GitHub URL, like https://github.com/owner/repo.");
      return;
    }
  }

  importDialogSubmit.disabled = true;
  importDialogStatus.textContent = "Importing project...";

  try {
    await postJson("/projects/import", {
      id,
      path: source === "github" ? "" : path,
      workflow: "software_development",
      source,
      url: source === "github" ? url : "",
    });

    importDialog.close();
    await loadProjects();
    await selectProject(id);
  } catch (error) {
    importDialogStatus.classList.add("error");
    importDialogStatus.textContent = error.message || "Import failed.";
  } finally {
    importDialogSubmit.disabled = false;
  }
});

$("browseProject").addEventListener("click", async () => {
  await chooseFolder(projectPath, dialogStatus);

  updateIdPreview();
});


dialogCreate.addEventListener("click", async () => {
  const name = dialogNameInput.value.trim();
  const id = slugify(name);
  const path = projectPath.value.trim();

  const refuse = message => {
    delete dialogStatus.dataset.nameBlock;
    dialogStatus.classList.add("error");
    dialogStatus.textContent = message;
    dialogStatus.scrollIntoView({ block: "nearest" });
  };

  if (!name || !id) {
    refuse("Enter a project name with letters or numbers.");
    return;
  }

  if (knownProjects.has(id)) {
    refuse(`A project "${id}" already exists. Choose a different name.`);
    return;
  }

  if (!path) {
    refuse("Choose a project folder.");
    return;
  }

  dialogCreate.disabled = true;
  dialogStatus.classList.remove("error");
  dialogStatus.textContent = "Creating project...";

  try {
    // Compose the stack label from the wizard's stack selections so the
    // project list can show the matching stack icon.
    const stack = [
      $("backendStack").value.trim(),
      $("frontendStack").value.trim(),
    ]
      .filter(Boolean)
      .join(" + ");

    const result = await postJson("/projects", {
      id,
      path,
      summary: $("projectSummary").value.trim(),
      stack,
      workflow: "software_development",
      app_type:
        projectDialog.querySelector('input[name="appType"]:checked')?.value || "web",
      frontend_stack: $("frontendStack").value.trim(),
      backend_stack: $("backendStack").value.trim(),
      database_stack: $("databaseStack").value.trim(),
      testing_stack: $("testingStack").value.trim(),
      security_stack: $("securityStack").value.trim(),
      deployment_stack: $("deploymentStack").value.trim(),
      scaling_stack: $("scalingStack").value.trim(),
    });

    remember("devpilot.folder", path);

    const skipped = result.skipped_files || [];
    if (skipped.length) {
      listStatus.textContent =
        `Project "${id}" created. Kept existing: ${skipped.join(", ")}`;
    }

    projectDialog.close();
    await loadProjects();
    await selectProject(id);
  } catch (error) {
    dialogStatus.classList.add("error");
    dialogStatus.textContent =
      error.message || "Request failed.";
    dialogStatus.scrollIntoView({ block: "nearest" });
  } finally {
    dialogCreate.disabled = false;
  }
});

// ----- tasks -----
function renderDiff(text) {
    diff.replaceChildren();

    const files = [];
    let current = null;

    for (const line of String(text || "").split("\n")) {
      const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

      if (header) {
        current = { name: header[2], add: 0, del: 0, rows: [] };
        files.push(current);
        continue;
      }

      if (!current) {
        current = { name: "Changes", add: 0, del: 0, rows: [] };
        files.push(current);
      }

      let cls = "";
      if (line.startsWith("+") && !line.startsWith("+++")) { cls = "diff-add"; current.add++; }
      else if (line.startsWith("-") && !line.startsWith("---")) { cls = "diff-del"; current.del++; }
      else if (line.startsWith("@@") || line.startsWith("index ")) cls = "diff-hunk";

      current.rows.push([cls, line]);
    }

    for (const file of files) {
      const group = document.createElement("details");
      group.open = true;

      const summary = document.createElement("summary");
      summary.textContent = file.name + "  (+" + file.add + " / -" + file.del + ")";
      group.appendChild(summary);

      for (const [cls, line] of file.rows) {
        const row = document.createElement("span");
        row.className = cls;
        row.textContent = line + "\n";
        group.appendChild(row);
      }

      diff.appendChild(group);
    }

    changesStatus.textContent = "";
    changedFiles = new Set(files.map(f => f.name));
    acceptChanges.disabled = false;
    reviewBar.hidden = false;
    reviewSummary.textContent = files.length + (files.length === 1 ? " file changed" : " files changed") + " in " + selectedProjectId;
    markUpdated("changes");
    rejectChanges.disabled = false;
  }


function showProjectEvent(event) {
  if (event.type === "status") {
    statusLine.textContent = event.text;
  } else if (event.type === "diff") {
    changesEmpty.hidden = true;
    renderDiff(event.text);
  } else if (event.type === "message") {
    appendChatMessage(projectLog, "Project AI", event.text, undefined, 0, undefined, event.basis);
    projectChatStatus.textContent = "Response received.";
    setRunning(false);
    loadTree();
    loadOutputs("switch");
    projectMessage.focus();
  } else if (event.type === "output") {
    loadOutputs();
  } else if (event.type === "error") {
    statusLine.textContent = event.text || "The task failed.";
    projectChatStatus.textContent = event.text || "The task failed.";
    setRunning(false);
    retryTask.hidden = false;
  } else {
    addStep(event);
    if (event.type === "tool_result" && /^(Edited|Created|Wrote|Deleted)/.test(event.text || "")) { loadTree(); loadOutputs(); }
  }
}

function addStep(event) {
    const item = document.createElement("li");
    item.className = event.type;

    const full = (event.type === "tool_call" ? "> " : "< ") + (event.text || "");
    const LIMIT = 240;

    if (event.type === "tool_call") stepCount++;

    if (full.length <= LIMIT) {
      item.textContent = full;
    } else {
      const text = document.createElement("span");
      const toggle = document.createElement("button");
      let open = false;

      toggle.type = "button";
      toggle.className = "link";

      const paint = () => {
        text.textContent = open ? full : full.slice(0, LIMIT) + "…";
        toggle.textContent = open ? "show less" : "show more";
      };

      toggle.addEventListener("click", () => { open = !open; paint(); });
      paint();
      item.append(text, toggle);
    }

    steps.appendChild(item);
    tick();
  }

  function formatElapsed() {
    const total = Math.max(0, Math.round((Date.now() - taskStart) / 1000));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function tick() {
    if (running) {
      taskMeta.textContent =
        stepCount + (stepCount === 1 ? " step" : " steps") + " · " + formatElapsed();
    }
  }

  function setRunning(value) {
    running = value;
    if (!value) hideTyping(projectLog);
    syncSend();


    if (value) {
      taskStart = Date.now();
      stepCount = 0;
      retryTask.hidden = true;
      tick();
    } else {
      taskMeta.textContent = taskStart
        ? "Finished · " + stepCount + (stepCount === 1 ? " step" : " steps") + " · " + formatElapsed()
        : "";
    }
  }

  stopTask.addEventListener("click", async () => {
    stopTask.disabled = true;

    try {
      await postJson("/tasks/stop", { project_id: selectedProjectId });
      statusLine.textContent = "Stopped.";
      setRunning(false);
    } catch (error) {
      projectChatStatus.textContent = error.message || "Could not stop the task.";
    } finally {
      stopTask.disabled = false;
    }
  });

  retryTask.addEventListener("click", () => {
    projectMessage.value = lastTaskText;
    sendProjectMessage();
  });

  async function decideChanges(kind) {
    if (kind === "reject" && !confirm('Discard all changes from this task in "' + selectedProjectId + '"?')) return;

    acceptChanges.disabled = true;
    rejectChanges.disabled = true;
    changesStatus.textContent = kind === "accept" ? "Accepting..." : "Rejecting...";

    try {
      await postJson("/tasks/" + kind, { project_id: selectedProjectId });
      reviewBar.hidden = true;
      changedFiles = new Set();
      if (kind === "reject") { diff.replaceChildren(); changesEmpty.hidden = false; }
      loadOutputs("switch");
      loadTree();
      changesStatus.textContent =
        kind === "accept" ? "Changes accepted." : "Changes discarded and files restored.";
    } catch (error) {
      changesStatus.textContent = error.message || "Request failed.";
      acceptChanges.disabled = false;
      rejectChanges.disabled = false;
    }
  }

  acceptChanges.addEventListener("click", () => decideChanges("accept"));
  rejectChanges.addEventListener("click", () => decideChanges("reject"));


async function pollProject() {
  if (!selectedProjectId || projectPolling) return;
  projectPolling = true;

  try {
    const requested = selectedProjectId;
    const response = await fetch("/events?after=" + projectNext + "&project_id=" + encodeURIComponent(selectedProjectId));
    if (!response.ok) return;

    const data = await response.json();

    if (requested !== selectedProjectId) return;

    (data.events || []).forEach(showProjectEvent);
    projectNext = data.next ?? projectNext;
  } catch (error) {
    console.error("Could not retrieve project events:", error);
  } finally {
    projectPolling = false;
  }
}

function syncSend() {
  paintSendButton(sendProject, running, !!projectMessage.value.trim());
  autoGrow(projectMessage);
}

async function sendProjectMessage() {
  const text = projectMessage.value.trim();

  if (!text || running) return;

  if (!selectedProjectId) {
    projectChatStatus.textContent = "Open, create, or import a project first.";
    return;
  }

  lastTaskText = text;
  setRunning(true);

  appendChatMessage(projectLog, "You", text, true, 0, [...chatTags]);
  showTyping(projectLog);
  projectMessage.value = "";
  syncSend();
  projectChatStatus.textContent = "Sending to Project AI...";

  steps.replaceChildren();
  statusLine.textContent = "Starting...";
  reviewBar.hidden = true;

  try {
    await postJson("/tasks", { message: text, project_id: selectedProjectId, mode: tagMode(), tags: chatTags });
    projectChatStatus.textContent = "Project AI is working...";
  } catch (error) {
    projectChatStatus.textContent = error.message || "Could not start project task.";
    statusLine.textContent = error.message || "Could not start project task.";
    setRunning(false);
    retryTask.hidden = false;
  }
}

sendProject.addEventListener("click", () => { if (running) stopTask.click(); else sendProjectMessage(); });
projectMessage.addEventListener("input", syncSend);

projectMessage.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendProjectMessage();
  }
});


// ----- Project AI: ask or change code -----
// Tags travel with each message. Pick Change code, Ask, both, or neither.
let chatTags = [];
try { chatTags = JSON.parse(recall("devpilot.tags") || "[]").filter(tag => tag === "ask" || tag === "change"); } catch (e) {}

const NO_PROJECT_HINT = "Open, create, or import a project first, then ask or describe a change here.";

function currentPlaceholder() {
  if (!selectedProjectId) return NO_PROJECT_HINT;

  const ask = chatTags.includes("ask");
  const scope = " Changes apply only to " + selectedProjectId + ".";
  const change = chatTags.includes("change");

  if (ask && change) return "Ask a question and request a change." + scope;
  if (ask) return "Ask about " + selectedProjectId + ". Nothing is changed.";
  if (change) return "Describe the change you want." + scope;
  return "Ask or describe a change." + scope;
}

function paintTags() {
  for (const [id, tag] of [["modeChange", "change"], ["modeAsk", "ask"]]) {
    const on = chatTags.includes(tag);
    $(id).classList.toggle("on", on);
    $(id).setAttribute("aria-pressed", String(on));
  }

  projectMessage.placeholder = currentPlaceholder();
}

function toggleTag(tag) {
  chatTags = chatTags.includes(tag) ? chatTags.filter(t => t !== tag) : [...chatTags, tag];
  remember("devpilot.tags", JSON.stringify(chatTags));
  paintTags();
}

// What the server gets as `mode`: "ask", "change", "both", or "auto" when no tag is picked.
const tagMode = () => chatTags.length === 2 ? "both" : chatTags[0] || "auto";

$("modeChange").addEventListener("click", () => toggleTag("change"));
$("modeAsk").addEventListener("click", () => toggleTag("ask"));

paintTags();

// ----- Agent Core: attach PDFs and documents -----
const coreFilesBox = $("coreFiles");
const coreFileInput = $("coreFileInput");

try { coreFiles = JSON.parse(recall("devpilot.coreFiles") || "[]"); } catch (e) { coreFiles = []; }

function paintCoreFiles() {
  remember("devpilot.coreFiles", JSON.stringify(coreFiles));
  coreFilesBox.replaceChildren();

  for (const file of coreFiles) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = icon("file");
    chip.append(file.name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + file.name);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      coreFiles = coreFiles.filter(f => f !== file);
      paintCoreFiles();
    });

    chip.appendChild(remove);
    coreFilesBox.appendChild(chip);
  }
}

async function uploadCoreFiles(files) {
  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      agentCoreStatus.textContent = file.name + " is larger than 50 MB.";
      continue;
    }

    agentCoreStatus.textContent = "Uploading " + file.name + "...";

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/agent-core/files", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.detail || "Upload failed.");

      coreFiles.push({ id: data.id, name: data.name || file.name });
      paintCoreFiles();
      agentCoreStatus.textContent = file.name + " attached.";
    } catch (error) {
      agentCoreStatus.textContent = error.message || "Could not upload " + file.name + ".";
    }
  }
}

$("attachCore").addEventListener("click", () => coreFileInput.click());

coreFileInput.addEventListener("change", () => {
  uploadCoreFiles([...coreFileInput.files]);
  coreFileInput.value = "";
});

agentCoreMessage.addEventListener("dragover", event => {
  event.preventDefault();
  agentCoreMessage.classList.add("dropping");
});

agentCoreMessage.addEventListener("dragleave", () => agentCoreMessage.classList.remove("dropping"));

agentCoreMessage.addEventListener("drop", event => {
  event.preventDefault();
  agentCoreMessage.classList.remove("dropping");
  uploadCoreFiles([...event.dataTransfer.files]);
});

paintCoreFiles();

$("clearChat").addEventListener("click", () => {
  if (!selectedProjectId || !confirm("Clear this conversation?")) return;

  projectLog.replaceChildren();
  remember(threadKey(selectedProjectId), "[]");
  appendChatMessage(projectLog, "Project AI", "Ready. Everything you ask here applies only to " + selectedProjectId + ".", false);
});

// ----- Agent Core: the robot icon at the top right opens it as a floating chat -----
const corePanel = $("corePanel");
const coreBtn = $("coreBtn");
const coreBadge = coreBtn.querySelector(".badge");

function setCoreOpen(open, focus = true) {
  corePanel.hidden = !open;
  coreBtn.setAttribute("aria-expanded", String(open));
  coreBtn.classList.toggle("open", open);
  remember("devpilot.coreOpen", open ? "1" : "");

  if (!open) return;

  coreBadge.hidden = true;
  agentCoreLog.scrollTop = agentCoreLog.scrollHeight;
  if (focus) agentCoreMessage.focus();
}

// A small dot on the robot when a reply arrives while the chat is closed.
function onCoreMessage() {
  if (corePanel.hidden) coreBadge.hidden = false;
}

coreBtn.addEventListener("click", () => setCoreOpen(corePanel.hidden));
$("closeCore").addEventListener("click", () => setCoreOpen(false));

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !corePanel.hidden && !document.querySelector("dialog[open]")) setCoreOpen(false);
});

$("clearCore").addEventListener("click", () => {
  if (!confirm("Clear this conversation?")) return;

  agentCoreLog.replaceChildren();
  remember("devpilot.core", "[]");
});

// The panel can be resized from its bottom right corner, and the size is remembered.
try {
  const size = JSON.parse(recall("devpilot.coreSize") || "null");
     if (size && size.w) corePanel.style.width = size.w + "px";
} catch (e) {}

new ResizeObserver(() => {
  if (!corePanel.hidden)    remember("devpilot.coreSize", JSON.stringify({ w: corePanel.offsetWidth }));
}).observe(corePanel);

if (recall("devpilot.coreOpen")) setCoreOpen(true, false);

// ---------- Layout: resize, move, minimize ----------
const MIN_PANE = 180;
const PANE_IDS = ["explorer", "assistant", "canvas"];
const DEFAULT_LAYOUT = {
  orientation: "horizontal",
  order: ["explorer", "assistant", "canvas"],
  weights: { explorer: 1, assistant: 1.5, canvas: 2.2 },
  minimized: {},
  maximized: "",
  heights: {}
};

const workspace = $("workspace");
const splitters = [...workspace.querySelectorAll(".splitter")];
const paneEl = id => workspace.querySelector('[data-pane="' + id + '"]');
const cloneLayout = layout => JSON.parse(JSON.stringify(layout));

function loadLayout() {
  try {
    const saved = JSON.parse(recall("devpilot.layout") || "null");

    if (saved && Array.isArray(saved.order) && saved.order.length === 3 && PANE_IDS.every(id => saved.order.includes(id))) {
      return {
        ...cloneLayout(DEFAULT_LAYOUT),
        ...saved,
        weights: { ...DEFAULT_LAYOUT.weights, ...(saved.weights || {}) },
        minimized: saved.minimized || {},
        heights: saved.heights || {}
      };
    }
  } catch (e) {}

  return cloneLayout(DEFAULT_LAYOUT);
}

let layoutState = loadLayout();
const wasCollapsed = {};
const saveLayout = () => remember("devpilot.layout", JSON.stringify(layoutState));

// A panel is collapsed when you minimized it, or when another panel is maximized.
const isMin = id => layoutState.maximized ? id !== layoutState.maximized : !!layoutState.minimized[id];

function toolLabel(button, icon_, label) {
  button.innerHTML = icon(icon_);
  button.setAttribute("aria-label", label);
  button.title = label;
}

function applyLayout() {
  const horizontal = layoutState.orientation === "horizontal";
  workspace.classList.toggle("horizontal", horizontal);
  workspace.classList.toggle("vertical", !horizontal);

  let visibleSlot = 0;

  layoutState.order.forEach((id, index) => {
    const el = paneEl(id);
    const collapsed = isMin(id);

    if (wasCollapsed[id] === true && !collapsed) {
      el.classList.add("pop");
      setTimeout(() => el.classList.remove("pop"), 320);
    }
    wasCollapsed[id] = collapsed;
    const name = el.querySelector(".pane-name").textContent;

    el.style.order = collapsed ? 0 : 2 * visibleSlot++;
    el.style.height = horizontal && layoutState.heights[id] ? layoutState.heights[id] + "px" : "";
    el.classList.toggle("min", collapsed);
    el.style.flex = collapsed ? "0 0 auto" : (layoutState.weights[id] || 1) + " 1 0px";

    const earlier = el.querySelector('[data-act="earlier"]');
    const later = el.querySelector('[data-act="later"]');
    earlier.disabled = index === 0;
    later.disabled = index === layoutState.order.length - 1;
    toolLabel(earlier, "arrowleft", horizontal ? "Move left" : "Move up");
    toolLabel(later, "arrowright", horizontal ? "Move right" : "Move down");
    toolLabel(el.querySelector('[data-act="minimize"]'), "minus", "Minimize " + name + " to the dock");
    toolLabel(el.querySelector('[data-act="maximize"]'), layoutState.maximized === id ? "restore" : "maximize", layoutState.maximized === id ? "Restore size" : "Maximize " + name);
  });

  // A divider sits between two visible panels, so there is one fewer than the visible panels.
  const visibleCount = layoutState.order.filter(id => !isMin(id)).length;

  splitters.forEach((splitter, index) => {
    splitter.style.order = 2 * index + 1;
    splitter.hidden = index >= visibleCount - 1;
  });

  // Minimized panels live in the dock on the left as closed folders.
  const dock = $("dock");
  dock.replaceChildren();

  for (const id of layoutState.order) {
    if (!isMin(id)) continue;

    const name = paneEl(id).querySelector(".pane-name").textContent;
    const item = document.createElement("button");

    item.type = "button";
    item.className = "dock-item";
    item.title = "Open " + name;
    item.setAttribute("aria-label", "Open " + name);
    const paneIcon = id === "explorer" ? "folder"
      : id === "assistant" ? "bot"
      : id === "canvas" ? "browser"
      : "folder";

    item.innerHTML = icon(paneIcon) + "<span></span>";
    item.querySelector("span").textContent = name;
    item.addEventListener("click", () => toggleMinimized(id));
    dock.appendChild(item);
  }

  dock.hidden = !dock.children.length;

}

const changeLayout = change => { change(); applyLayout(); saveLayout(); };

function toggleMinimized(id) {
  changeLayout(() => {
    if (isMin(id)) {
      layoutState.maximized = "";
      layoutState.minimized[id] = false;

      // Give the returning panel a fair share next to the panels that stayed open.
      const others = PANE_IDS.filter(other => other !== id && !isMin(other));
      const average = others.reduce((sum, other) => sum + (layoutState.weights[other] || 1), 0) / Math.max(others.length, 1);
      layoutState.weights[id] = Math.max(average * 0.7, DEFAULT_LAYOUT.weights[id]);
    } else if (PANE_IDS.filter(other => !isMin(other)).length > 1) {
      layoutState.minimized[id] = true;
    }
  });
}

function moveBy(id, step) {
  changeLayout(() => {
    const from = layoutState.order.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= layoutState.order.length) return;
    [layoutState.order[from], layoutState.order[to]] = [layoutState.order[to], layoutState.order[from]];
  });
}

workspace.querySelectorAll(".pane").forEach(el => {
  const id = el.dataset.pane;

  el.querySelector('[data-act="earlier"]').addEventListener("click", () => moveBy(id, -1));
  el.querySelector('[data-act="later"]').addEventListener("click", () => moveBy(id, 1));
  el.querySelector('[data-act="minimize"]').addEventListener("click", () => toggleMinimized(id));
  el.querySelector('[data-act="maximize"]').addEventListener("click", () => changeLayout(() => {
    layoutState.maximized = layoutState.maximized === id ? "" : id;
  }));

  // Drag a panel by its title and drop it on another panel to swap places.
  const head = el.querySelector(".pane-head");
  head.addEventListener("dragstart", event => {
    dragId = id;
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
    workspace.classList.add("dragging");
    el.classList.add("lifted");
  });
  head.addEventListener("dragend", () => {
    dragId = "";
    workspace.classList.remove("dragging");
    workspace.querySelectorAll(".pane").forEach(p => p.classList.remove("lifted", "target"));
  });

  el.addEventListener("dragover", event => {
    if (dragId && dragId !== id) { event.preventDefault(); el.classList.add("target"); }
  });
  el.addEventListener("dragleave", () => el.classList.remove("target"));
  el.addEventListener("drop", event => {
    event.preventDefault();
    el.classList.remove("target");
    if (!dragId || dragId === id) return;

    changeLayout(() => {
      const a = layoutState.order.indexOf(dragId);
      const b = layoutState.order.indexOf(id);
      layoutState.order[a] = id;
      layoutState.order[b] = dragId;
    });
  });
});

// Bottom edge of each panel: drag to change its height (side by side layout).
const MIN_HEIGHT = 120;

workspace.querySelectorAll(".pane").forEach(el => {
  const id = el.dataset.pane;
  const grip = document.createElement("div");

  grip.className = "pane-grip";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", "Change height");
  grip.title = "Drag to change the height. Double-click to reset.";
  grip.tabIndex = 0;
  el.appendChild(grip);

  const setHeight = px => {
    layoutState.heights[id] = Math.max(MIN_HEIGHT, Math.round(px));
    applyLayout();
  };

  grip.addEventListener("pointerdown", event => {
    if (layoutState.orientation !== "horizontal") return;

    event.preventDefault();
    grip.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = el.offsetHeight;

    workspace.classList.add("dragging");
    grip.classList.add("active");

    const move = e => setHeight(startHeight + e.clientY - startY);
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      workspace.classList.remove("dragging");
      grip.classList.remove("active");
      saveLayout();
    };

    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });

  grip.addEventListener("dblclick", () => changeLayout(() => { delete layoutState.heights[id]; }));

  grip.addEventListener("keydown", event => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();
    setHeight(el.offsetHeight + (event.key === "ArrowDown" ? 30 : -30));
    saveLayout();
  });
});

let dragId = "";

// Dividers: every open panel gets a weight equal to its pixel size, so they stay proportional.
function beginResize(index) {
  const horizontal = layoutState.orientation === "horizontal";
  const visible = layoutState.order.filter(id => !isMin(id));
  const aId = visible[index];
  const bId = visible[index + 1];

  for (const id of layoutState.order) {
    if (!isMin(id)) layoutState.weights[id] = horizontal ? paneEl(id).offsetWidth : paneEl(id).offsetHeight;
  }

  return { horizontal, aId, bId, min: horizontal ? MIN_PANE : 120, startA: layoutState.weights[aId], startB: layoutState.weights[bId] };
}

function resizeBy(ctx, delta) {
  // Each panel may shrink down to its minimum, but a panel already below it is never pushed further.
  const limited = Math.max(Math.min(ctx.min - ctx.startA, 0), Math.min(Math.max(ctx.startB - ctx.min, 0), delta));
  layoutState.weights[ctx.aId] = ctx.startA + limited;
  layoutState.weights[ctx.bId] = ctx.startB - limited;
  applyLayout();
}

splitters.forEach((splitter, index) => {
  splitter.addEventListener("pointerdown", event => {
    if (splitter.classList.contains("off")) return;

    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);

    const ctx = beginResize(index);
    const start = ctx.horizontal ? event.clientX : event.clientY;

    workspace.classList.add("dragging");
    splitter.classList.add("active");

    const move = e => resizeBy(ctx, (ctx.horizontal ? e.clientX : e.clientY) - start);
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      workspace.classList.remove("dragging");
      splitter.classList.remove("active");
      saveLayout();
    };

    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });

  splitter.addEventListener("dblclick", () => changeLayout(() => { layoutState.weights = { ...DEFAULT_LAYOUT.weights }; }));

  splitter.addEventListener("keydown", event => {
    const horizontal = layoutState.orientation === "horizontal";
    const keys = horizontal ? { ArrowLeft: -30, ArrowRight: 30 } : { ArrowUp: -30, ArrowDown: 30 };
    if (!(event.key in keys) || splitter.classList.contains("off")) return;

    event.preventDefault();
    resizeBy(beginResize(index), keys[event.key]);
    saveLayout();
  });
});




applyLayout();

window.addEventListener("beforeunload", event => { if (running) { event.preventDefault(); event.returnValue = ""; } });

pollApprovals();
setInterval(pollApprovals, 1000);

async function init() {
  buildTabs();
  syncSend();
  syncCoreSend();
  showView("preview");
  startAgentCore();

  await loadProjects();

  const last = recall("devpilot.project");
  if (last && knownProjects.has(last)) await selectProject(last);
  else setChatEnabled();

  setInterval(tick, 1000);
  setInterval(pollProject, 1000);
}

init();






