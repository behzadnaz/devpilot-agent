const $ = id => document.getElementById(id);
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch (e) {} };
const recall = key => { try { return localStorage.getItem(key) || ""; } catch (e) { return ""; } };
const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const agentCoreLog = $("agentCoreLog");
const agentCoreMessage = $("agentCoreMessage");
const sendAgentCore = $("sendAgentCore");
const agentCoreStatus = $("agentCoreStatus");
const banner = $("banner");

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
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.detail || "Request failed.");
    }

    return data;
  }

  // Current end of an event stream, so a new view never replays old events.
  async function latestCursor(url) {
    try {
      const response = await fetch(url + "?after=0");
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
  button.innerHTML = icon(busy ? "stop" : "arrowup");
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


const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

function initChrome() {
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => '<symbol id="i-' + name + '" viewBox="0 0 24 24">' + body + '</symbol>')
    .join("");

  document.body.insertAdjacentHTML("afterbegin", `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${symbols}</defs></svg>

    <header class="topbar">
      <div class="topbar-in">
        <span class="brand">${icon("compass")}DevPilot</span>

        <div class="menu">
          <button class="ghost" id="fileMenuBtn" type="button" aria-haspopup="true" aria-expanded="false">
            ${icon("file")}File${icon("chevron")}
          </button>
          <div class="menu-list" id="fileMenu" hidden>
            <button id="menuNew" type="button">${icon("plus")}New project</button>
            <button id="menuImport" type="button">${icon("download")}Import project</button>
          </div>
        </div>

        

        <div class="menu">
          <button class="ghost" id="helpMenuBtn" type="button" aria-haspopup="true" aria-expanded="false">
            ${icon("help")}Help${icon("chevron")}
          </button>
          <div class="menu-list" id="helpMenu" hidden>
            <button id="helpBtn" type="button">${icon("help")}Help topics</button>
            <button id="aboutBtn" type="button">${icon("info")}About</button>
          </div>
        </div>

        <span class="grow"></span>

        <button class="ghost icon-only core-btn" id="coreBtn" type="button" aria-label="Agent Core" aria-expanded="false" title="Agent Core">${icon("bot")}<span class="badge" hidden></span></button>
        <button class="ghost icon-only" id="themeBtn" type="button"></button>
      </div>
    </header>

    <dialog id="aboutDialog">
      <h3>${icon("compass")}About DevPilot</h3>
      <p class="muted">A local coding agent. Describe what you want, DevPilot works on a separate git branch, and you review the changes before accepting them.</p>
      <ul>
        <li>Version 1 (MVP)</li>
        <li>Runs on your computer with Ollama (Qwen3 4B)</li>
        <li>Project AI builds your project. Agent Core discusses and improves DevPilot itself.</li>
      </ul>
      <div class="actions end"><button class="secondary" type="button" data-close>${icon("x")}Close</button></div>
    </dialog>

    <dialog id="helpDialog">
      <h3>${icon("help")}Help</h3>
      <ul>
        <li><kbd>Enter</kbd> sends a message, <kbd>Shift</kbd> + <kbd>Enter</kbd> adds a new line.</li>
        <li><kbd>Esc</kbd> closes menus and dialogs.</li>
        <li>Drag a panel's title to move it, drag the dividers to change widths, drag a panel's bottom edge to change its height (side by side layout), and use the buttons in its title to maximize it, or to minimize it into the folder dock on the left (click the folder to bring it back). Double-click a divider or an edge to reset.</li>
        <li>In Explorer, create or import a project, then describe what to build in Assistant.</li>
        <li>Pick one or both tags under the message box, Change code and Ask, to tell the AI what you want. They are sent with your message. With no tag, the AI decides.</li>
        <li>Click the robot icon at the top right, next to the light and dark theme button, to open Agent Core: general questions, developing DevPilot, and reading your PDFs. It keeps its own history.</li>
        <li>Canvas shows the result: a preview, the story map, the changes, and the steps.</li>
        <li>Review the changes, then use Accept or Reject. Rejecting restores your files.</li>
      </ul>
      <div class="actions end"><button class="secondary" type="button" data-close>${icon("x")}Close</button></div>
    </dialog>`);

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

  for (const [button, dialog] of [["aboutBtn", "aboutDialog"], ["helpBtn", "helpDialog"]]) {
    $(button).addEventListener("click", () => $(dialog).showModal());
  }

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
      html = '<body style="margin:12px;font:13px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap">' + pre.innerHTML + "</body>";
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

    if (!response.ok) throw new Error(data.detail || "Could not load projects.");

    const projects = data.projects || [];
    knownProjects = new Set(projects.map(p => p.id));
    projectList.replaceChildren();

    for (const project of projects) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = project.id;
      button.className = project.id === selectedProjectId ? "active" : "";
      button.innerHTML = icon("folder");
      button.append(project.id);
      button.addEventListener("click", () => selectProject(project.id));
      item.appendChild(button);
      projectList.appendChild(item);
    }

    listStatus.textContent = projects.length ? "" : "No projects yet. Create or import one.";
  } catch (error) {
    listStatus.textContent = error.message || "Could not load projects.";
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

  projectNext = await latestCursor("/events");
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

  dialogCreate.disabled = !!raw && (!id || taken);
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
  languageBlock.hidden = mode !== "create";
  $("nameBlock").hidden = mode !== "create";
  $("sourceBlock").hidden = mode === "create";
  $("githubBlock").hidden = true;
  $("githubUrl").value = "";
  $("importPreview").textContent = "";
  $("pathLabel").hidden = false;
  projectPath.parentElement.hidden = false;
  $("pathLabel").textContent = "Project folder";
  projectPath.placeholder = "Choose a project folder";
  document.querySelector('input[name="source"][value="folder"]').checked = true;
  dialogNameInput.value = "";
  idPreview.textContent = "";
  dialogStatus.textContent = "";
  dialogCreate.disabled = false;
  projectPath.value = mode === "create" ? recall("devpilot.folder") : "";
  $("stackInput").value = "";
  $("stackCheck").hidden = true;
  $("stackGuide").hidden = true;
  $("stackGoal").value = "";
  $("stackGuideStatus").textContent = "";
  $("stackSuggestions").replaceChildren();
  stackCheckToken++;
  projectDialog.showModal();
  dialogNameInput.focus();

  if (mode !== "create") return;

  await loadStacks();
}

let stackCheckToken = 0;
let stackTimer = 0;

async function loadStacks() {
  if (projectPath.value) return;

  try {
    const response = await fetch("/languages");
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.default_folder && !projectPath.value) projectPath.value = data.default_folder;
  } catch (e) {}
}

// The user types the stack (or picks one the AI suggests).
function chosenStack() {
  const name = $("stackInput").value.trim();
  return name ? { id: name.toLowerCase(), name } : null;
}

$("stackInput").addEventListener("input", () => {
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
$("askStack").addEventListener("click", event => {
  event.preventDefault();
  const guide = $("stackGuide");
  guide.hidden = !guide.hidden;
  if (!guide.hidden) $("stackGoal").focus();
});

async function suggestStacks() {
  const description = $("stackGoal").value.trim();
  const status = $("stackGuideStatus");
  const list = $("stackSuggestions");

  list.replaceChildren();

  if (!description) { status.textContent = "Describe what you want to build in one sentence."; return; }

  status.textContent = "Thinking...";
  $("stackSuggest").disabled = true;

  try {
    const data = await postJson("/stack-advice", { description });
    const suggestions = data.suggestions || [];

    status.textContent = suggestions.length ? "Pick one to use it:" : "No suggestion yet. Try describing it differently, or type a stack above.";

    suggestions.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lang";

      const title = document.createElement("span");
      title.textContent = item.stack;

      const reason = document.createElement("small");
      reason.textContent = item.reason || "";

      button.append(title, reason);
      button.addEventListener("click", () => {
        $("stackInput").value = item.stack;
        $("stackGuide").hidden = true;
        checkStack();
      });
      list.appendChild(button);
    });
  } catch (error) {
    status.textContent = error.message || "Could not get a suggestion. You can still type a stack above.";
  } finally {
    $("stackSuggest").disabled = false;
  }
}

$("stackSuggest").addEventListener("click", suggestStacks);
$("stackGoal").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); suggestStacks(); } });

$("newProject").addEventListener("click", () => openProjectDialog("create"));
$("importProject").addEventListener("click", () => openProjectDialog("import"));
$("dialogCancel").addEventListener("click", () => projectDialog.close());
$("dialogClose").addEventListener("click", () => projectDialog.close());

$("browseProject").addEventListener("click", async () => {
  await chooseFolder(projectPath, dialogStatus);

  updateIdPreview();
});

dialogCreate.addEventListener("click", async () => {
  const name = dialogMode === "import" ? importId() : dialogNameInput.value.trim();
  const id = slugify(name);
  const path = projectPath.value.trim();

  if (!name || !id) { dialogStatus.textContent = dialogMode === "import" ? (importSource() === "github" ? "Enter a GitHub repository URL." : "Choose a project folder.") : "Enter a project name with letters or numbers."; return; }
  if (knownProjects.has(id)) { dialogStatus.textContent = 'A project "' + id + '" already exists.'; return; }
  if (!path && !(dialogMode === "import" && importSource() === "github")) { dialogStatus.textContent = "Choose a project folder."; return; }

  if (dialogMode === "import" && importSource() === "github") {
    let validUrl = false;
    try {
      const link = new URL($("githubUrl").value.trim());
      validUrl = link.hostname === "github.com" && link.pathname.split("/").filter(Boolean).length >= 2;
    } catch (e) {}

    if (!validUrl) { dialogStatus.textContent = "Enter a GitHub repository URL, like https://github.com/owner/repo."; return; }
  }

  if (dialogMode === "create" && !chosenStack()) { dialogStatus.textContent = "Type your stack, or ask AI to guide you."; return; }

  dialogCreate.disabled = true;
  dialogStatus.textContent = dialogMode === "create" ? "Creating project..." : "Importing project...";

  try {
    if (dialogMode === "create") {
      const stack = chosenStack();
      await postJson("/projects", { id, path, stack: stack.name, workflow: "software_development" });
      remember("devpilot.folder", path);
    } else {
      await postJson("/projects/import", { id, path: importSource() === "github" ? "" : path, workflow: "software_development", source: importSource(), url: importSource() === "github" ? $("githubUrl").value.trim() : "" });
    }

    projectDialog.close();
    await loadProjects();
    await selectProject(id);
  } catch (error) {
    dialogStatus.textContent = error.message || "Request failed.";
    dialogCreate.disabled = false;
  }
});

$("menuNew").addEventListener("click", () => openProjectDialog("create"));
$("menuImport").addEventListener("click", () => openProjectDialog("import"));

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
    const response = await fetch("/events?after=" + projectNext + "&project_id=" + encodeURIComponent(selectedProjectId));
    if (!response.ok) return;

    const data = await response.json();

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
  if (size) { corePanel.style.width = size.w + "px"; corePanel.style.height = size.h + "px"; }
} catch (e) {}

new ResizeObserver(() => {
  if (!corePanel.hidden) remember("devpilot.coreSize", JSON.stringify({ w: corePanel.offsetWidth, h: corePanel.offsetHeight }));
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
    item.innerHTML = '<svg class="icon closed" aria-hidden="true"><use href="#i-folder"/></svg>' +
                     '<svg class="icon open" aria-hidden="true"><use href="#i-folderopen"/></svg><span></span>';
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

window.addEventListener("beforeunload", event => { if (running) event.preventDefault(); });

async function init() {
  buildTabs();
  syncSend();
  syncCoreSend();
  showView("preview");
  startAgentCore();

  await loadProjects();

  const last = recall("devpilot.project");
  if (last && knownProjects.has(last)) await selectProject(last);

  setInterval(tick, 1000);
  setInterval(pollProject, 1000);
}

init();
