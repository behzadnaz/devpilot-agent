# POC AI Agent

AI agent that helps review and change code, with a human approving every change.
Runs on a local model through Ollama. No API key needed.

## Status
- Local model works (Qwen3 4B), tool calling works
- Agent reads, creates, edits, moves and deletes project files
- Every change needs your approval

## Setup
1. Install Python 3.12+ and Git
2. Install Ollama (https://ollama.com/download) and keep it running
3. Get a tool-capable model, e.g. `ollama pull qwen3:4b`
4. `pip install -r requirements.txt`
5. Set `MODEL` in `agent/config.py`. Also change the safety line if the step limit is now 10.

## Run
1. Start the Ollama app
2. In the PyCharm terminal (`(.venv)` active):
```
   python -m agent.main_agent
```
3. Type requests at the `You:` prompt. `/clear` resets, `q` quits.

Restart the agent after editing code in `agent/`.

## Talk to the agent
Use project-root paths, such as `sandbox/hello.py`.
```
Show me the project tree
Read sandbox/hello.py and explain it
How can I make hello.py greet two people?   (advice only)
Apply it
Create docs/notes.md with a short description
```

## Approval
Every write, move or delete shows a diff and asks `Apply this change? (y/n)`.
After a change: Ctrl+Alt+Y to refresh PyCharm, `git status` to review, `git restore <file>` to undo.

## Safety
- Agent cannot change its own code in `agent/`, or see `.env`, `.git`, `.venv`
- Stops after 10 steps per request
- Never commit API keys or `.env` files
