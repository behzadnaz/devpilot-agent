
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
        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": task},
        ]

        for step in range(1, self._max_steps + 1):
            events.publish("status", f"step {step} of {self._max_steps}")

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
                result = getattr(self._tools, parsed.name)(
                    **parsed.arguments
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
