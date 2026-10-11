from dataclasses import dataclass, field


@dataclass(frozen=True)
class ParsedReply:
    kind: str  # "tool_call", "final_message" or "bad_reply"
    name: str = ""
    arguments: dict = field(default_factory=dict, hash=False)
    text: str = ""


class ReplyParser:
    """Checks the model's message and says what it is: a tool call, a final message or a bad reply."""

    def __init__(self, required_arguments):
        self._required = required_arguments  # tool name -> the argument names it needs

    def parse(self, message):
        calls = message.tool_calls or []
        if len(calls) > 1:
            return ParsedReply("bad_reply", text="Call one tool at a time.")
        if calls:
            return self._parse_tool_call(calls[0])
        if (message.content or "").strip():
            return ParsedReply("final_message", text=message.content.strip())
        return ParsedReply("bad_reply", text="The reply has no tool call and no text.")

    def _parse_tool_call(self, call):
        name = call.function.name
        arguments = call.function.arguments
        if name not in self._required:
            return ParsedReply("bad_reply", text=f"Unknown tool: {name}. The tools are: {', '.join(self._required)}.")
        if not isinstance(arguments, dict):
            return ParsedReply("bad_reply", text=f"The arguments of {name} must be a dictionary.")
        missing = [argument for argument in self._required[name] if argument not in arguments]
        if missing:
            return ParsedReply("bad_reply", text=f"{name} is missing: {', '.join(missing)}.")
        return ParsedReply("tool_call", name=name, arguments=dict(arguments))