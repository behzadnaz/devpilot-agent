import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.demo_agent import DemoAgent
from app.events import EventStream


PAGE = Path(__file__).parent / "static" / "index.html"


class TaskRequest(BaseModel):
    message: str
    project_id: str = "default"


class ProjectRequest(BaseModel):
    id: str
    path: str
    workflow: str


def _in_background(job):
    threading.Thread(target=job, daemon=True).start()


def create_app(agent=None, start=_in_background, project_registry=None):
    web_app = FastAPI()
    stream = EventStream()

    @web_app.get("/")
    def page():
        return FileResponse(PAGE)

    @web_app.get("/projects")
    def list_projects():
        if project_registry is None:
            return {"projects": []}

        projects = project_registry.list_projects()

        return {
            "projects": [
                {
                    "id": project_id,
                    "workflow": config["workflow"],
                }
                for project_id, config in sorted(projects.items())
            ]
        }

    @web_app.post("/projects", status_code=201)
    def create_project(request: ProjectRequest):
        if project_registry is None:
            raise HTTPException(
                status_code=503,
                detail="Project registry is not configured.",
            )

        project_id = request.id.strip()
        path = request.path.strip()
        workflow = request.workflow.strip()

        if not project_id or not path or not workflow:
            raise HTTPException(
                status_code=400,
                detail="Project ID, path, and workflow are required.",
            )

        try:
            project_registry.add_project(
                project_id,
                {
                    "path": Path(path),
                    "workflow": workflow,
                },
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=409,
                detail=str(exc),
            ) from exc

        return {
            "id": project_id,
            "workflow": workflow,
        }

    @web_app.post("/tasks")
    def start_task(request: TaskRequest):
        selected_agent = agent

        if project_registry is not None:
            try:
                selected_agent = project_registry.get_agent(
                    request.project_id
                )
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

        start(
            lambda: selected_agent.run(request.message, stream)
        )

        return {"started": True}

    @web_app.get("/events")
    def events(after: int = 0):
        found = stream.since(after)

        return {
            "events": [
                {"type": event.type, "text": event.text}
                for event in found
            ],
            "next": after + len(found),
        }

    return web_app


application = create_app(DemoAgent())
