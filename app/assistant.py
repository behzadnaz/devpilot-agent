from agent.main_agent import SYSTEM, run_turn
from app.llm import ask
from app.rag import answer
from app.router import classify


def main() -> None:
    print("Assistant ready. Force a route with /project, /pdf or /chat. /clear resets, q quits.")
    project_messages = [{"role": "system", "content": SYSTEM}]

    while True:
        try:
            text = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if text.lower() in ("q", "quit", "exit"):
            break
        if text == "/clear":
            project_messages = [{"role": "system", "content": SYSTEM}]
            print("Project conversation cleared.")
            continue
        if not text:
            continue

        route, text = classify(text)
        print(f"[route: {route}]")

        if route == "project":
            project_messages.append({"role": "user", "content": text})
            reply = run_turn(project_messages)
        elif route == "pdf":
            try:
                reply = answer(text)
            except FileNotFoundError as e:
                reply = str(e)
        else:
            reply = ask(text, system="Answer directly and briefly. Do not mention project files.")

        print("\nAssistant:", reply)


if __name__ == "__main__":
    main()