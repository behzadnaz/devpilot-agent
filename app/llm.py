import ollama

from app.config import APP_MODEL, OLLAMA_HOST

_client = ollama.Client(host=OLLAMA_HOST)


def ask(prompt: str, system: str = "You are a helpful assistant.") -> str:
    """Send one question to the model and return its answer as text."""
    response = _client.chat(
        model=APP_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    return response.message.content