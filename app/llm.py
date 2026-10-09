from pathlib import Path

import ollama

from app.config import ModelSettings

MODEL_FILE = Path(__file__).resolve().parent.parent / "config" / "model.yaml"
DEFAULT_SYSTEM = "You are a helpful assistant."


class LLMClient:
    """Sends one chat message to the model. The ollama client is passed in."""

    def __init__(self, settings, ollama_client):
        self._settings = settings
        self._ollama_client = ollama_client

    def ask(self, prompt, system=DEFAULT_SYSTEM):
        response = self._ollama_client.chat(
            model=self._settings.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return response.message.content


_default_client = None


def ask(prompt: str, system: str = DEFAULT_SYSTEM) -> str:
    """Send one question to the model and return its answer as text."""
    global _default_client
    if _default_client is None:
        settings = ModelSettings.load(MODEL_FILE)
        _default_client = LLMClient(settings, ollama.Client(host=settings.endpoint))
    return _default_client.ask(prompt, system)