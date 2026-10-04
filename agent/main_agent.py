import ollama

from agent.tools import TOOLS

MODEL = "qwen3-4b-local"
MAX_STEPS = 6

SYSTEM = (
    "You are a software engineering assistant. You can only see files in the sandbox folder. "
    "Use list_files and read_file to inspect code before answering. Do not guess file contents."
)


def run_agent(goal: str) -> str:
    print("Agent started...")
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": goal},
    ]

    for step in range(MAX_STEPS):
        response = ollama.chat(model=MODEL, messages=messages, tools=list(TOOLS.values()))
        messages.append(response.message)

        if not response.message.tool_calls:
            return response.message.content

        for call in response.message.tool_calls:
            name = call.function.name
            args = call.function.arguments
            print(f"[step {step + 1}] tool: {name} {args}")
            func = TOOLS.get(name)
            result = func(**args) if func else f"Unknown tool: {name}"
            messages.append({"role": "tool", "tool_name": name, "content": str(result)})

    return "Stopped: reached the step limit."


if __name__ == "__main__":



    print(run_agent("Read hello.py. Quote its exact code, then explain in two sentences what it does."))