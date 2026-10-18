(function () {
  const DATA = window.DEVPILOT_DATA;
  const KEY = "demo.one";
  const calc = extra => '<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#fafafa"><div style="border:1px solid #bbb;padding:20px 24px;border-radius:14px;background:#fff"><h3 style="margin:0 0 12px">Calculator</h3><input id="a" type="number" value="8" style="width:70px"> <input id="b" type="number" value="2" style="width:70px"><div style="margin:12px 0"><button onclick="r.textContent=+a.value + +b.value">+</button> <button onclick="r.textContent=a.value-b.value">-</button>' + extra + '</div><div id="r" style="font-size:28px">0</div></div></body></html>';
  const storyBase = DATA.story_map;
  const defaults = {
    projects: JSON.parse(JSON.stringify(DATA.projects)),
    trees: JSON.parse(JSON.stringify(DATA.trees)),
    outputs: {
      "calculator-app": { preview: { title: "index.html", html: calc("") }, story_map: { columns: storyBase } },
      "todo-api": { preview: null, story_map: { columns: storyBase.slice(0, 2) } }
    }
  };
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  state = state || defaults;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  const core = [], proj = [];
  const json = d => Promise.resolve({ ok: true, json: () => Promise.resolve(d) });
  const later = (arr, ms, e) => setTimeout(() => arr.push(e), ms);
  const longText = "def add(a, b):\n    return a + b\n\n" + "# helper functions for the calculator module\n".repeat(8);
  const diffText = [
    "diff --git a/app/calculator.py b/app/calculator.py", "index 3f2a1b..8c9d0e 100644", "@@ -1,4 +1,9 @@",
    " def add(a, b):", "     return a + b", "+", "+def divide(a, b):", "+    if b == 0:",
    '+        raise ValueError("Cannot divide by zero")', "-    return a / b", "+    return a / b",
    "diff --git a/index.html b/index.html", "@@ -5,3 +5,4 @@", '+<button onclick="r.textContent=a.value/b.value">÷</button>'
  ].join("\n");
  const param = (url, key) => new URLSearchParams(String(url).split("?")[1]).get(key);

  window.fetch = (url, opts = {}) => {
    const u = String(url).split("?")[0];
    const after = parseInt(String(url).split("after=")[1] || "0", 10) || 0;
    const body = typeof opts.body === "string" ? JSON.parse(opts.body) : {};

    if (u === "/projects" && !opts.method) return json({ projects: state.projects });
    if (u === "/projects" || u === "/projects/import") {
      state.projects.push({ id: body.id });
      state.trees[body.id] = u === "/projects" ? [] : ["README.md", "src/main.py"];
      state.outputs[body.id] = { preview: null, story_map: null };
      save();
      return json({});
    }
    if (u === "/languages/check") {
      const t = String(param(url, "stack") || "").toLowerCase();
      const hit = DATA.runtimes.find(r => new RegExp(r.match).test(t));
      if (!hit) return json({ runtime: "", installed: false, version: "", url: "" });
      if (hit.no_install) return json({ runtime: "", installed: true, version: "", no_install: true });
      return json({ runtime: hit.runtime, installed: !!hit.version, version: hit.version, url: hit.url });
    }
    if (u === "/stack-advice") {
      const t = String(body.description || "").toLowerCase();
      const hit = DATA.stack_advice.find(item => !item.match || new RegExp(item.match).test(t));
      return json({ suggestions: hit ? hit.suggestions : [] });
    }
    if (u === "/languages") return json(DATA.languages);
    if (u === "/tree") return json({ files: state.trees[param(url, "project_id")] || [] });
    if (u === "/outputs") return json(state.outputs[param(url, "project_id")] || {});
    if (u === "/file") {
      const path = param(url, "path");
      const out = (state.outputs[param(url, "project_id")] || {}).preview;
      return json({ content: path === "index.html" && out ? out.html : "# " + path + "\n\nDemo file content." });
    }
    if (u === "/select-folder") return json({ path: DATA.select_folder_path });
    if (u === "/events") return json({ events: proj.slice(after), next: proj.length });
    if (u === "/agent-core/events") return json({ events: core.slice(after), next: core.length });

    if (u === "/tasks") {
      if (body.mode === "ask") {
        if (/recommend|suggest|best way|should i|idea|which (language|framework|library)/i.test(body.message || "")) {
          later(proj, 200, { type: "status", text: "Thinking..." });
          later(proj, 1200, { type: "message", text: "For a small calculator, plain JavaScript is enough. Add a framework only if the app grows. (Demo suggestion.)", basis: { kind: "suggestion" } });
          return json({});
        }
        later(proj, 200, { type: "status", text: "Reading project files..." });
        later(proj, 700, { type: "tool_call", text: "read_file README.md" });
        later(proj, 1200, { type: "tool_result", text: "# Calculator app" });
        later(proj, 1500, { type: "message", text: "In scope: adding and subtracting two numbers. Out of scope: history and scientific functions. (Demo answer.)", basis: { kind: "analyzed", files: ["README.md"] } });
        return json({});
      }
      if (/^(what|why|how|explain)\b/i.test((body.message || "").trim())) {
        later(proj, 200, { type: "status", text: "Reading project files..." });
        later(proj, 700, { type: "tool_call", text: "read_file app/calculator.py" });
        later(proj, 1200, { type: "tool_result", text: "def add(a, b): ..." });
        later(proj, 1500, { type: "message", text: "This is an explanation only, so I did not change anything. (Demo answer.)", basis: { kind: "nochange", files: ["app/calculator.py"] } });
        return json({});
      }
      const id = body.project_id;
      later(proj, 200, { type: "status", text: "Reading project files..." });
      later(proj, 700, { type: "tool_call", text: "read_file app/calculator.py" });
      later(proj, 1200, { type: "tool_result", text: longText });
      later(proj, 1800, { type: "tool_call", text: "edit_file index.html" });
      later(proj, 2300, { type: "tool_result", text: "Edited index.html (+1)" });
      later(proj, 2800, { type: "tool_call", text: "run_command pytest -q" });
      later(proj, 3500, { type: "tool_result", text: "44 passed in 1.2s" });
      later(proj, 3800, { type: "status", text: "Done." });
      later(proj, 4000, { type: "diff", text: diffText });
      setTimeout(() => {
        state.pending = state.pending || {};
        state.pending[id] = JSON.parse(JSON.stringify({ tree: state.trees[id] || [], output: state.outputs[id] || {} }));
        const o = state.outputs[id] = state.outputs[id] || {};
        o.preview = { title: "index.html", html: calc(' <button onclick="r.textContent=a.value/b.value">÷</button>') };
        o.story_map = { columns: storyBase.map(c => ({ epic: c.epic, stories: c.stories.map(s => s.id === "US-4.1" ? { ...s, status: "done" } : s) })) };
        const t = state.trees[id] = state.trees[id] || [];
        for (const f of ["index.html", "app/calculator.py"]) if (!t.includes(f)) t.push(f);
        save();
        proj.push({ type: "message", text: "I added a divide button to the calculator and a zero check in the code. All 44 tests pass.", basis: { kind: "changed", files: ["index.html", "app/calculator.py"] } });
      }, 4300);
      return json({});
    }
    if (u === "/tasks/accept" || u === "/tasks/reject") {
      const pid = body.project_id;
      const p = (state.pending || {})[pid];
      if (u === "/tasks/reject" && p) { state.trees[pid] = p.tree; state.outputs[pid] = p.output; }
      if (state.pending) delete state.pending[pid];
      save();
      return json({});
    }
    if (u === "/agent-core/files") { const f = opts.body && opts.body.get && opts.body.get("file"); return json({ id: "f" + Date.now(), name: f ? f.name : "document.pdf" }); }
    if (u === "/agent-core/tasks") {
      later(core, 300, { type: "status", text: "Thinking..." });
      const names = (body.file_names && body.file_names.length) ? body.file_names : (body.file_ids || []).map((_, n) => "attached file " + (n + 1));
      const wantsCode = body.mode === "change" || body.mode === "both";
      later(core, 1300, wantsCode
        ? { type: "message", text: "Here is a proposed code change (demo). Nothing was applied to any project.", basis: { kind: "proposed" } }
        : { type: "message", text: names.length ? "I read " + names.length + " attached document(s). In the real app I would answer from their content." : "This is a demo reply from Agent Core. In the real app it answers general questions and helps develop DevPilot.", basis: names.length ? { kind: "documents", files: names } : { kind: "suggestion" } });
      return json({});
    }
    return json({});
  };
})();
