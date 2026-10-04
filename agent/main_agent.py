import ollama

from agent.tools import TOOLS

MODEL = "qwen3-4b-local"
MAX_STEPS = 6

SYSTEM = (
    "You are a software engineering assistant working on a project. "
    "Answer general questions (concepts, definitions, how things work) directly from your own knowledge. "
    "Do NOT use tools for general questions. Use tools only when the user asks about this project's files or structure. "
    "Use project_tree to see the real structure and read_file before changing anything. Never guess about project files. "
    "Paths are relative to the project root, for example sandbox/hello.py or README.md. "
    "When the user asks a question or advice, explain and propose, but do NOT change files. "
    "Only call write_file, move_file or delete_file when the user clearly asks to apply a change. "
    "When writing, send the complete file content. Make one small change at a time. "
    "A human must approve every change."
)


def run_turn(messages: list) -> str:
    """Run the agent on the current conversation until it gives a final answer."""
    for step in range(MAX_STEPS):
        response = ollama.chat(model=MODEL, messages=messages, tools=list(TOOLS.values()))
        messages.append(response.message)

        if not response.message.tool_calls:
            return response.message.content

        for call in response.message.tool_calls:
            name = call.function.name
            args = call.function.arguments
            print(f"[step {step + 1}] tool: {name}")
            func = TOOLS.get(name)
            result = func(**args) if func else f"Unknown tool: {name}"
            messages.append({"role": "tool", "tool_name": name, "content": str(result)})

    return "Stopped: reached the step limit."


if __name__ == "__main__":
    print("DevPilot agent. Type your request. Commands: /clear (forget the conversation), q (quit).")
    messages = [{"role": "system", "content": SYSTEM}]

    while True:
        goal = input("\nYou: ").strip()
        if goal.lower() in ("q", "quit", "exit"):
            break
        if goal == "/clear":
            messages = [{"role": "system", "content": SYSTEM}]
            print("Conversation cleared.")
            continue
        if not goal:
            continue

        messages.append({"role": "user", "content": goal})
        print("\nAgent:", run_turn(messages))