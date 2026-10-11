from app._ollama_client_stub import _OllamaClientStub
from app.config import ModelSettings
from app.llm import LLMClient

SETTINGS = ModelSettings(model="qwen3-4b-local", endpoint="http://localhost:11434")


class _LLMClientTest:
    def test_sends_the_prompt_and_returns_the_models_reply(self):
        ollama_client = _OllamaClientStub(reply="Hello from the model")
        client = LLMClient(SETTINGS, ollama_client)

        reply = client.ask("Say hello")

        assert reply == "Hello from the model", "reply"
        assert ollama_client.chat_called_with == {
            "model": "qwen3-4b-local",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Say hello"},
            ],
        }, "model, default system message and the prompt are sent"

    def test_system_message_can_be_replaced(self):
        ollama_client = _OllamaClientStub(reply="ok")
        client = LLMClient(SETTINGS, ollama_client)

        client.ask("Question", system="Answer in one word.")

        assert ollama_client.chat_called_with["messages"][0] == {
            "role": "system",
            "content": "Answer in one word.",
        }, "system message"

    def test_chat_sends_the_tools_and_returns_the_models_message(self):
        ollama_client = _OllamaClientStub(reply="", tool_calls=[("read_file", {"path": "hello.py"})])
        client = LLMClient(SETTINGS, ollama_client)
        tools = [{"type": "function", "function": {"name": "read_file"}}]
        messages = [{"role": "user", "content": "Read hello.py"}]

        message = client.chat(messages, tools)

        assert ollama_client.chat_called_with == {"model": "qwen3-4b-local", "messages": messages}, "model and messages"
        assert ollama_client.tools_called_with == tools, "the tools are sent"
        assert message.tool_calls[0].function.name == "read_file", "tool name"
        assert message.tool_calls[0].function.arguments == {"path": "hello.py"}, "arguments"