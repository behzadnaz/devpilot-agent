from types import SimpleNamespace


class _OllamaClientStub:
    """Stands in for ollama.Client. It gives canned answers and records the call."""

    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.chat_called_with = None

    @staticmethod
    def unreachable():
        return _OllamaClientStub(error=ConnectionError("connection refused"))

    def chat(self, model, messages):
        if self.error:
            raise self.error
        self.chat_called_with = {"model": model, "messages": messages}
        return SimpleNamespace(message=SimpleNamespace(content=self.reply))

    def list(self):
        if self.error:
            raise self.error
        return SimpleNamespace(models=[])