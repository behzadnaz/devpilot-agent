from types import SimpleNamespace


class _OllamaClientStub:
    """Stands in for ollama.Client. It gives a canned answer and records the call."""

    def __init__(self, reply):
        self.reply = reply
        self.chat_called_with = None

    def chat(self, model, messages):
        self.chat_called_with = {"model": model, "messages": messages}
        return SimpleNamespace(message=SimpleNamespace(content=self.reply))