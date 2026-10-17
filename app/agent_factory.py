from app.agent_loop import AgentLoop
from app.reply_parser import ReplyParser
from app.tools import ToolSet


class AgentFactory:
    """Creates an agent with tools scoped to a specific project."""

    def __init__(
        self,
        llm,
        tool_schemas,
        system_prompt,
        max_steps=20,
        limits=None,
    ):
        self._llm = llm
        self._tool_schemas = tool_schemas
        self._system_prompt = system_prompt
        self._max_steps = max_steps
        self._limits = limits

    def __call__(self, project_id, config):
        tools = ToolSet(project_folder=config["path"], limits=self._limits)
        parser = ReplyParser(
            self._tool_schemas.required_arguments()
        )

        return AgentLoop(
            llm=self._llm,
            tools=tools,
            parser=parser,
            tool_schemas=self._tool_schemas.tools,
            system_prompt=self._system_prompt,
            max_steps=self._max_steps,
        )