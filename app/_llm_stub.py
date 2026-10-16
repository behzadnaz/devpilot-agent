from types import SimpleNamespace


class _LLMStub:
    """Stands in for LLMClient. It gives scripted messages, one for each call, and records the calls."""

    def __init__(self, messages):
        self._messages = list(messages)
        self.calls = []

    def chat(self, messages, tools):
        self.calls.append({"messages": list(messages), "tools": tools})
        return self._messages.pop(0)


def tool_call(name, **arguments):
    """A model message that asks for one tool."""
    call = SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments))
    return SimpleNamespace(content="", tool_calls=[call])


def final_message(text):
    """A model message that is a final answer."""
    return SimpleNamespace(content=text, tool_calls=None)