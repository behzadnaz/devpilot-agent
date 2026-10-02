import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=300,
    messages=[{"role": "user", "content": "Say hello and explain what an AI agent is in two sentences."}],
)

print(response.content[0].text)