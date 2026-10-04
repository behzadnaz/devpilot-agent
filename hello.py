import ollama


def add_numbers(a: int, b: int) -> int:
    """Add two numbers.

    Args:
        a: The first number
        b: The second number
    """
    return a + b


response = ollama.chat(
    model="qwen3-4b-local",
    messages=[{"role": "user", "content": "What is 17 plus 25? Use the tool."}],
    tools=[add_numbers],
)

calls = response.message.tool_calls
if calls:
    for call in calls:
        print("Model wants to call:", call.function.name, call.function.arguments)
else:
    print("No tool call. Reply was:", response.message.content)