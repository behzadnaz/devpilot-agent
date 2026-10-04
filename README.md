# DevPilot Agent

AI agent that helps software engineers control and review the development process.
It runs on a local model through Ollama, so no API key or payment is needed.

## Status
- Local model works (Qwen3 4B through Ollama)
- Tool calling works
- Agent can list and read files, limited to the `sandbox/` folder
- Read-only for now: it cannot change any files

## Project structure
- `agent/` the agent: `tools.py` (tools) and `main_agent.py` (the loop)
- `sandbox/` practice code the agent reviews
- `web/` browser interface (not built yet)
- `tests/` tests for the agent itself

## Setup
1. Install Python 3.12 or newer and Git
2. Install Ollama from https://ollama.com/download and keep it running
3. Get a model that supports tools, for example `ollama pull qwen3:4b`
4. Create a virtual environment and install the libraries:
   `pip install -r requirements.txt`
5. If you imported the model from a .gguf file, change `MODEL` in `agent/main_agent.py` to match its name in `ollama list`

## Run
From the project folder:
`python -m agent.main_agent`

## Safety
- File tools can only read inside `sandbox/`
- The agent stops after 6 steps
- Never commit API keys or `.env` files

## Roadmap
1. Add a `run_tests` tool
2. Add human approval before the agent changes anything
3. Add Git tools (status, diff)
4. Add the web interface with FastAPI
5. Add GitHub pull request tools