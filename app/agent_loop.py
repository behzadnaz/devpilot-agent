
import logging
import time

logger = logging.getLogger(__name__)


class AgentLoop:
    """Asks the model, runs the tool it picks, and repeats until the model gives a final message."""

    def __init__(
        self,
        llm,
        tools,
        parser,
        tool_schemas,
        system_prompt,
        max_steps=20,
    ):
        self._llm = llm
        self._tools = tools
        self._parser = parser
        self._tool_schemas = tool_schemas
        self._system_prompt = system_prompt
        self._max_steps = max_steps

    def run(self, task, events, mode="auto", tags=None):
        loop_started = time.perf_counter()
        steps_completed = 0

        try:
            messages = [
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": task},
            ]

            for step in range(1, self._max_steps + 1):
                steps_completed = step

                events.publish(
                    "status",
                    f"step {step} of {self._max_steps}",
                )

                parsed = self._parser.parse(
                    self._llm.chat(messages, self._tool_schemas)
                )

                if parsed.kind == "final_message":
                    events.publish("status", "done")
                    events.publish("message", parsed.text)
                    return

                if parsed.kind == "bad_reply":
                    events.publish("status", "failed")
                    events.publish(
                        "message",
                        f"The model gave a reply I cannot use: {parsed.text}",
                    )
                    return

                events.publish(
                    "tool_call",
                    f"{parsed.name} {parsed.arguments}",
                )

                if mode == "ask" and parsed.name in {
                    "create_file",
                    "edit_file",
                    "move_file",
                    "delete_file",
                    "run_command",
                }:
                    result = (
                        f"Error: tool '{parsed.name}' is not allowed in Ask mode. "
                        "You can inspect files and answer questions, but you "
                        "cannot modify the project."
                    )
                else:
                    tool_started = time.perf_counter()
                    try:
                        result = getattr(self._tools, parsed.name)(
                            **parsed.arguments
                        )
                    finally:
                        tool_elapsed = time.perf_counter() - tool_started
                        logger.info(
                            "Tool execution finished in %.3f seconds (tool=%s)",
                            tool_elapsed,
                            parsed.name,
                        )

                events.publish("tool_result", result)

                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "function": {
                                    "name": parsed.name,
                                    "arguments": parsed.arguments,
                                }
                            }
                        ],
                    }
                )

                messages.append(
                    {
                        "role": "tool",
                        "tool_name": parsed.name,
                        "content": result,
                    }
                )

            # Reached the step limit without receiving a final answer.
            events.publish("status", "failed")
            events.publish(
                "message",
                f"The agent stopped because it reached the step limit "
                f"of {self._max_steps} without producing a final answer. "
                "Please try a more focused request.",
            )

        finally:
            loop_elapsed = time.perf_counter() - loop_started
            logger.info(
                "Agent loop finished in %.3f seconds (steps=%d)",
                loop_elapsed,
                steps_completed,
            )
