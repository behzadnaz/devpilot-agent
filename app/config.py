import os
from dataclasses import dataclass

import yaml

APP_MODEL = os.getenv("APP_MODEL", "qwen3-4b-local")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")

@dataclass(frozen=True)
class ModelSettings:
    model: str
    endpoint: str

    @staticmethod
    def load(path):
        with open(path, encoding="utf-8") as file:
            data = yaml.safe_load(file)
        return ModelSettings(model=data["model"], endpoint=data["endpoint"])