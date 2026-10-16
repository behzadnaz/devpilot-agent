import threading
from fastapi import FastAPI, HTTPException

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.demo_agent import DemoAgent
from app.events import EventStream

PAGE = Path(__file__).parent / "static" / "index.html"


class TaskRequest(BaseModel):
    message: str
    project_id: str = "default"


def _in_background(job):
    threading.Thread(target=job, daemon=True).start()


def create_app(agent=None, start=_in_background, project_registry=None):
    web_app = FastAPI()
    stream = EventStream()

    @web_app.get("/")
    def page():
        return FileResponse(PAGE)

    @web_app.post("/tasks")
    def start_task(request: TaskRequest):
        selected_agent = agent

        if project_registry is not None:
            try:
                selected_agent = project_registry.get_agent(request.project_id)
            except KeyError:
                raise HTTPException(
                    status_code=404,
                    detail="Project not found.",
                )

        if selected_agent is None:
            raise HTTPException(
                status_code=503,
                detail="No agent configured for this project.",
            )

        start(lambda: selected_agent.run(request.message, stream))
        return {"started": True}

    @web_app.get("/events")
    def events(after: int = 0):
        found = stream.since(after)
        return {
            "events": [{"type": e.type, "text": e.text} for e in found],
            "next": after + len(found),
        }

    return web_app

application = create_app(DemoAgent())