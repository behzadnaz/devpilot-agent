import re

from app.llm import ask

PREFIXES = {"/project": "project", "/pdf": "pdf", "/chat": "general"}
ROUTES = ("project", "pdf", "general")
FILE_HINTS = (".py", ".md", ".json", "readme", "sandbox", "project tree")

ROUTER_SYSTEM = (
    "You are a router. Read the user's message and answer with exactly one word: project, pdf, or general.\n"
    "project = the user wants to see, create, edit, move, delete or explain files, code or folders of this software project.\n"
    "pdf = the user asks about AI agents, agentic applications or related concepts "
    "that a library of PDF documents about agents would cover.\n"
    "general = anything else, such as chit-chat or general programming and world knowledge.\n"
    "Answer with one word only."
)


def classify(text: str) -> tuple[str, str]:
    """Return (route, cleaned_text). A /project, /pdf or /chat prefix forces the route."""
    text = text.strip()
    for prefix, route in PREFIXES.items():
        if text.lower().startswith(prefix + " "):
            return route, text[len(prefix):].strip()

    low = text.lower()
    if any(hint in low for hint in FILE_HINTS):
        return "project", text

    reply = ask(text, system=ROUTER_SYSTEM)
    reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.S).strip().lower()
    for route in ROUTES:
        if route in reply:
            return route, text
    return "general", text