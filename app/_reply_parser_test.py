from types import SimpleNamespace

from app.reply_parser import ParsedReply, ReplyParser

TOOLS = {"read_file": ["path"], "edit_file": ["path", "old_text", "new_text"]}


def _message(content="", tool_calls=None):
    calls = None
    if tool_calls:
        calls = [SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments)) for name, arguments in tool_calls]
    return SimpleNamespace(content=content, tool_calls=calls)


class _ReplyParserTest:
    def test_valid_tool_call_is_accepted(self):
        parser = ReplyParser(TOOLS)

        parsed = parser.parse(_message(tool_calls=[("read_file", {"path": "hello.py"})]))

        assert parsed == ParsedReply("tool_call", name="read_file", arguments={"path": "hello.py"}), "tool call"

    def test_final_message_is_accepted_without_a_tool_call(self):
        parser = ReplyParser(TOOLS)

        parsed = parser.parse(_message(content="Done. I created calculator.py."))

        assert parsed == ParsedReply("final_message", text="Done. I created calculator.py."), "final message"

    def test_unknown_tool_name_is_rejected(self):
        parser = ReplyParser(TOOLS)

        parsed = parser.parse(_message(tool_calls=[("format_disk", {"path": "c:"})]))

        assert parsed.kind == "bad_reply", "kind"
        assert "format_disk" in parsed.text, "the reply names the unknown tool"
        assert "read_file" in parsed.text, "the reply lists the tools that exist"

    def test_malformed_tool_call_is_rejected(self):
        parser = ReplyParser(TOOLS)

        missing = parser.parse(_message(tool_calls=[("edit_file", {"path": "a.py"})]))
        not_a_dictionary = parser.parse(_message(tool_calls=[("read_file", "hello.py")]))

        assert missing.kind == "bad_reply", "kind, missing arguments"
        assert "old_text" in missing.text and "new_text" in missing.text, "the reply names what is missing"
        assert not_a_dictionary.kind == "bad_reply", "kind, arguments that are not a dictionary"

    def test_more_than_one_tool_call_is_a_bad_reply(self):
        parser = ReplyParser(TOOLS)

        parsed = parser.parse(_message(tool_calls=[("read_file", {"path": "a.py"}), ("read_file", {"path": "b.py"})]))

        assert parsed.kind == "bad_reply", "kind"
        assert "one tool at a time" in parsed.text, "the reply says what to do"

    def test_reply_that_is_neither_tool_call_nor_final_message_is_a_bad_reply(self):
        parser = ReplyParser(TOOLS)

        parsed = parser.parse(_message(content="   "))

        assert parsed.kind == "bad_reply", "kind"
        assert "no tool call and no text" in parsed.text, "the reply says what is wrong"


class _ParsedReplyTest:
    def test_value_object(self):
        reply = ParsedReply("tool_call", name="read_file", arguments={"path": "a.py"})

        assert reply == ParsedReply("tool_call", name="read_file", arguments={"path": "a.py"}), "same values are equal"
        assert reply != ParsedReply("tool_call", name="read_file", arguments={"path": "b.py"}), "different arguments"
        assert reply != ParsedReply("final_message", text="x"), "different kind"
        assert hash(reply) == hash(ParsedReply("tool_call", name="read_file", arguments={"path": "a.py"})), "hash"
        assert reply != None, "not equal to None"  # noqa: E711