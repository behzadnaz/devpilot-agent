import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.demo_agent import DemoAgent
from app.events import EventStream

PAGE = Path(__file__).parent / "static" / "index.html"


class TaskRequest(BaseModel):
    message: str


def _in_background(job):
    threading.Thread(target=job, daemon=True).start()


def create_app(agent, start=_in_background):
    web_app = FastAPI()
    stream = EventStream()

    @web_app.get("/")
    def page():
        return FileResponse(PAGE)

    @web_app.post("/tasks")
    def start_task(request: TaskRequest):
        start(lambda: agent.run(request.message, stream))
        return {"started": True}

    @web_app.get("/events")
    def events(after: int = 0):
        found = stream.since(after)
        return {"events": [{"type": e.type, "text": e.text} for e in found], "next": after + len(found)}

    return web_app


application = create_app(DemoAgent())