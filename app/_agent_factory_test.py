from types import SimpleNamespace
from app.agent_factory import AgentFactory
from app.events import EventStream
from app.tool_schemas import ToolSchemas


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
