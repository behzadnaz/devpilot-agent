from types import SimpleNamespace


class _OllamaClientStub:
    """Stands in for ollama.Client. It gives canned answers and records the call."""

    def __init__(self, reply=None, error=None, tool_calls=None):
        self.reply = reply
        self.error = error
        self.tool_calls = tool_calls
        self.chat_called_with = None
        self.tools_called_with = None

    @staticmethod
    def unreachable():
        return _OllamaClientStub(error=ConnectionError("connection refused"))

    def chat(self, model, messages, tools=None):
        if self.error:
            raise self.error
        self.chat_called_with = {"model": model, "messages": messages}
        self.tools_called_with = tools
        calls = None
        if self.tool_calls:
            calls = [
                SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments))
                for name, arguments in self.tool_calls
            ]
        return SimpleNamespace(message=SimpleNamespace(content=self.reply, tool_calls=calls))

    def list(self):
        if self.error:
            raise self.error
        return SimpleNamespace(models=[])