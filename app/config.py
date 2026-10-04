import os

APP_MODEL = os.getenv("APP_MODEL", "qwen3-4b-local")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")