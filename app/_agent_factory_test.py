from pathlib import Path
from types import SimpleNamespace

from app._llm_stub import _LLMStub, final_message, tool_call
from app.agent_factory import AgentFactory
from app.events import EventStream
from app.limits import Limits
from app.tool_schemas import ToolSchemas

TOOLS_FILE = Path(__file__).resolve().parent.parent / "config" / "tools.json"


class _FakeLLM:
    def __init__(self):
        self._replies = [
            SimpleNamespace(
                tool_calls=[
                    SimpleNamespace(
                        function=SimpleNamespace(
                            name="create_file",
                            arguments={
                                "path": "only-here.txt",
                                "content": "Selected project",
                            },
                        )
                    )
                ],
                content="",
            ),
            SimpleNamespace(tool_calls=[], content="Done."),
        ]

    def chat(self, messages, tools):
        return self._replies.pop(0)


class _AgentFactoryTest:
    def test_agent_uses_the_selected_project_folder(self, tmp_path):
        project_path = tmp_path / "selected"
        other_path = tmp_path / "other"
        project_path.mkdir()
        other_path.mkdir()

        schemas = ToolSchemas([
            {
                "type": "function",
                "function": {
                    "name": "create_file",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["path", "content"],
                    },
                },
            }
        ])

        factory = AgentFactory(
            llm=_FakeLLM(),
            tool_schemas=schemas,
            system_prompt="Test agent",
        )

        agent = factory("selected", {"path": project_path})
        agent.run("Create a file", EventStream())

        assert (project_path / "only-here.txt").read_text() == "Selected project"
        assert not (other_path / "only-here.txt").exists()

    def test_agent_can_run_a_command_from_the_allowlist(self, tmp_path):
        factory = AgentFactory(
            llm=_LLMStub([tool_call("run_command", command="python --version"), final_message("Done.")]),
            tool_schemas=ToolSchemas.load(TOOLS_FILE),
            system_prompt="Test agent",
            limits=Limits(allowed_commands=("python --version",), timeout=30),
        )
        events = EventStream()

        factory("selected", {"path": tmp_path}).run("Check Python", events)

        results = [event.text for event in events.since(0) if event.type == "tool_result"]
        assert "exit code: 0" in results[0], "the command from the allowlist ran"

    def test_factory_passes_approval_callback_to_tools(self, tmp_path):
        project = tmp_path / "project"
        project.mkdir()

        factory = AgentFactory(
            llm=_LLMStub([final_message("Done.")]),
            tool_schemas=ToolSchemas.load(TOOLS_FILE),
            system_prompt="Test agent",
            approval=lambda action, details: False,
        )

        agent = factory("selected", {"path": project})

        result = agent._tools.create_file("blocked.txt", "content")

        assert "approval denied" in result.lower()
        assert not (project / "blocked.txt").exists()
