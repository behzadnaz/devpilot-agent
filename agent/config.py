import os

# Name shown by `ollama list`. Change it here when you switch models.
MODEL = os.getenv("AGENT_MODEL", "qwen3-4b-local")

# Safety limit: how many tool steps the agent may take per request.
MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "10"))