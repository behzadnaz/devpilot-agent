import os

# Model used by the software itself at runtime (not by the DevPilot agent).
MODEL = os.getenv("AGENT_MODEL", "qwen3-4b-local")
MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "10"))