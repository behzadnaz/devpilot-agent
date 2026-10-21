import logging
import time
logger = logging.getLogger(__name__)

import ollama

from pathlib import Path
from app.config import ModelSettings

MODEL_FILE = (
    Path(__file__).resolve().parent.parent / "config" / "model.yaml"
)

DEFAULT_SYSTEM = "You are a helpful assistant."


class LLMClient:
    """Sends chat messages to the model. The Ollama client is passed in."""

    def __init__(self, settings: ModelSettings, ollama_client):
        self._settings = settings
        self._ollama_client = ollama_client

    def ask(self, prompt, system=DEFAULT_SYSTEM, options=None, think=None):
        """Send a prompt to the model and return its text response."""
        kwargs = {
            "model": self._settings.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }

        if options is not None:
            kwargs["options"] = options

        if think is not None:
            kwargs["think"] = think

        response = self._ollama_client.chat(**kwargs)
        return response.message.content

    def chat(self, messages, tools):
        """Send messages and tool definitions to the model."""
        started = time.perf_counter()

        response = self._ollama_client.chat(
            model=self._settings.model,
            messages=messages,
            tools=tools,
        )

        elapsed = time.perf_counter() - started
        logger.info("LLM chat finished in %.3f seconds", elapsed)

        return response.message


_default_client = None
