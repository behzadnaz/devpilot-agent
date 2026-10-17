
import os
import threading
import tkinter as tk

from pathlib import Path
from tkinter import filedialog

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.agent_factory import AgentFactory
from app.config import ModelSettings
from app.events import EventStream
from app.llm import LLMClient
from app.project_registry import ProjectRegistry
from app.tool_schemas import ToolSchemas


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PAGE = Path(__file__).parent / "static" / "index.html"
MODEL_CONFIG = PROJECT_ROOT / "config" / "model.yaml"
TOOLS_CONFIG = PROJECT_ROOT / "config" / "tools.json"

PROJECTS_ROOT = Path(
    os.environ.get(
        "DEVPILOT_PROJECTS_ROOT",
        str(Path.home() / "DevPilot-Workspace"),
    )
).resolve()

SYSTEM_PROMPT = """
You are a software development assistant working within the selected project.
Use the available tools to inspect or modify project files when appropriate.
Stay within the selected project directory.
Explain your actions clearly and never claim a change succeeded unless it did.
"""


AGENT_CORE_SYSTEM_PROMPT = """
You are Agent Core, the software development agent responsible for
the DevPilot agent codebase itself.

Your working directory is the DevPilot repository.
Use available tools to inspect and modify Agent Core files when appropriate.
Keep your work within the Agent Core repository.
Do not confuse Agent Core development with development of a user project.
Explain your actions clearly and never claim a change succeeded unless it did.
"""


class TaskRequest(BaseModel):
    message: str
    project_id: str = "default"


class AgentCoreRequest(BaseModel):
    message: str


class ProjectRequest(BaseModel):
    id: str
    path: str
    workflow: str


class WorkspaceRequest(BaseModel):
    path: str


def _in_background(job):
    threading.Thread(target=job, daemon=True).start()


def load_model_settings():
    return ModelSettings.load(MODEL_CONFIG)


def create_llm_client(settings):
    return LLMClient(
        settings=settings,
        ollama_client=ollama.Client(host=settings.endpoint),
    )


def load_tool_schemas():
    return ToolSchemas.load(TOOLS_CONFIG)


def build_project_registry(projects, system_prompt=SYSTEM_PROMPT):
    settings = load_model_settings()
    llm = create_llm_client(settings)
    tool_schemas = load_tool_schemas()

    factory = AgentFactory(
        llm=llm,
        tool_schemas=tool_schemas,
        system_prompt=system_prompt,
    )

    return ProjectRegistry(
        projects=projects,
        agent_factory=factory,
    )


def select_folder_dialog():
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    try:
        selected = filedialog.askdirectory(
            title="Select project folder",
            mustexist=True,
        )
        return selected or None
    finally:
        root.destroy()


def create_app(
    agent=None,
    start=_in_background,
    project_registry=None,
    projects_root=None,
    agent_core=None,
):
    web_app = FastAPI()

    # Separate event streams prevent the two chats from mixing messages.
    stream = EventStream()
    agent_core_stream = EventStream()

    @web_app.get("/select-folder")
    def select_folder():
        try:
            path = select_folder_dialog()
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not open the folder selection dialog.",
            ) from exc

        if not path:
            raise HTTPException(
                status_code=400,
                detail="Folder selection was cancelled.",
            )

        return {"path": path}

    @web_app.get("/")
    def page():
        return FileResponse(PAGE)

    @web_app.post("/workspace", status_code=201)
    def create_workspace(request: WorkspaceRequest):
        if projects_root is None:
            raise HTTPException(
                status_code=503,
                detail="Workspace root is not configured.",
            )

        root = Path(projects_root).resolve()
        requested_path = Path(request.path).resolve()

        if requested_path != root:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Workspace path must match the configured "
                    "workspace root."
                ),
            )

        try:
            requested_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not create workspace.",
            ) from exc

        return {"path": str(requested_path)}

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

        if projects_root is not None:
            root = Path(projects_root).resolve()
            requested_path = Path(path).resolve()

            if not requested_path.is_relative_to(root):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Project path must be inside "
                        "the approved workspace."
                    ),
                )

            path = requested_path

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

    # Project AI: requires an existing or selected project.
    @web_app.post("/tasks")
    def start_task(request: TaskRequest):
        if not request.message.strip():
            raise HTTPException(
                status_code=400,
                detail="Message is required.",
            )

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
                ) from None

        if selected_agent is None:
            raise HTTPException(
                status_code=503,
                detail="No agent configured for this project.",
            )

        start(
            lambda: selected_agent.run(request.message, stream)
        )

        return {
            "started": True,
            "scope": "project",
        }

    @web_app.get("/events")
    def events(after: int = 0):
        found = stream.since(after)

        return {
            "events": [
                {
                    "type": event.type,
                    "text": event.text,
                }
                for event in found
            ],
            "next": after + len(found),
        }

    # Agent Core: works independently of user-created projects.
    @web_app.post("/agent-core/tasks")
    def start_agent_core_task(request: AgentCoreRequest):
        if not request.message.strip():
            raise HTTPException(
                status_code=400,
                detail="Message is required.",
            )

        if agent_core is None:
            raise HTTPException(
                status_code=503,
                detail="Agent Core is not configured.",
            )

        start(
            lambda: agent_core.run(
                request.message,
                agent_core_stream,
            )
        )

        return {
            "started": True,
            "scope": "agent_core",
        }

    @web_app.get("/agent-core/events")
    def agent_core_events(after: int = 0):
        found = agent_core_stream.since(after)

        return {
            "events": [
                {
                    "type": event.type,
                    "text": event.text,
                }
                for event in found
            ],
            "next": after + len(found),
        }

    return web_app


DEFAULT_PROJECTS = {
    "default": {
        "path": PROJECTS_ROOT,
        "workflow": "software-development",
    }
}

# Build the project agent registry separately from Agent Core.
project_registry = build_project_registry(DEFAULT_PROJECTS)

# Agent Core works against the DevPilot repository itself.
agent_core_registry = build_project_registry(
    {
        "agent-core": {
            "path": PROJECT_ROOT,
            "workflow": "software-development",
        }
    },
    system_prompt=AGENT_CORE_SYSTEM_PROMPT,
)

agent_core_agent = agent_core_registry.get_agent("agent-core")

application = create_app(
    agent_core=agent_core_agent,
    project_registry=project_registry,
    projects_root=PROJECTS_ROOT,
)
