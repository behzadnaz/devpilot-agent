
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
from app.approval import ApprovalManager
from app.config import ModelSettings
from app.events import EventStream
from app.limits import Limits
from app.llm import LLMClient
from app.project_registry import ProjectRegistry
from app.tool_schemas import ToolSchemas


# Resolve the repository root independently of the current working directory.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PAGE = Path(__file__).parent / "static" / "index.html"
MODEL_CONFIG = PROJECT_ROOT / "config" / "model.yaml"
TOOLS_CONFIG = PROJECT_ROOT / "config" / "tools.json"
LIMITS_CONFIG = PROJECT_ROOT / "config" / "limits.yaml"

# The workspace location can be customized through an environment variable.
PROJECTS_ROOT = Path(
    os.environ.get(
        "DEVPILOT_PROJECTS_ROOT",
        str(Path.home() / "DevPilot-Workspace"),
    )
).resolve()


# Instructions for agents working on user projects.
SYSTEM_PROMPT = """
You are a software development assistant working within the selected project.
Use the available tools to inspect or modify project files when appropriate.
Stay within the selected project directory.
Explain your actions clearly and never claim a change succeeded unless it did.
"""


# Instructions for the agent working on the DevPilot codebase itself.
AGENT_CORE_SYSTEM_PROMPT = """
You are Agent Core, the software development agent responsible for
the DevPilot agent codebase itself.

Your working directory is the DevPilot repository.
Use available tools to inspect and modify Agent Core files when appropriate.
Keep your work within the Agent Core repository.
Do not confuse Agent Core development with development of a user project.
Explain your actions clearly and never claim a change succeeded unless it did.
"""


# Request models validate the JSON received by the API.

class TaskRequest(BaseModel):
    """A task submitted to an agent working on a user project."""

    message: str
    project_id: str = "default"


class AgentCoreRequest(BaseModel):
    """A task submitted to Agent Core."""

    message: str


class ProjectRequest(BaseModel):
    """Configuration for registering a user project."""

    id: str
    path: str
    workflow: str


class WorkspaceRequest(BaseModel):
    """The requested workspace directory."""

    path: str


class ApprovalDecision(BaseModel):
    """An approval or rejection submitted by the user."""

    approved: bool


def _in_background(job):
    """Run a job in a daemon thread so the HTTP request can return."""
    threading.Thread(target=job, daemon=True).start()


def load_model_settings():
    """Load the configured language model settings."""
    return ModelSettings.load(MODEL_CONFIG)


def create_llm_client(settings):
    """Create the LLM client using the configured Ollama endpoint."""
    return LLMClient(
        settings=settings,
        ollama_client=ollama.Client(host=settings.endpoint),
    )


def load_tool_schemas():
    """Load the tool definitions available to agents."""
    return ToolSchemas.load(TOOLS_CONFIG)

def load_limits():
    return Limits.load(LIMITS_CONFIG)

def build_project_registry(
    projects,
    system_prompt=SYSTEM_PROMPT,
    approval=None,
    llm=None,
):
    """Build a registry and pass approval handling to its agent factory."""
    settings = load_model_settings()
    llm = llm or create_llm_client(settings)
    tool_schemas = load_tool_schemas()

    # Pass the approval callback to the factory so each agent's tools
    # can request permission before modifying project files.
    factory = AgentFactory(
        llm=llm,
        tool_schemas=tool_schemas,
        system_prompt=system_prompt,
        approval=approval,
        limits=load_limits(),
    )

    return ProjectRegistry(
        projects=projects,
        agent_factory=factory,
    )


def select_folder_dialog():
    """Open a native folder picker and return the selected directory."""
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
    approval_manager=None,
):
    """Create the FastAPI application and register its routes."""
    web_app = FastAPI()

    # Use the supplied manager when available so the API can resolve
    # approval requests created by the agent.
    if approval_manager is None:
        approval_manager = ApprovalManager()

    # Keep each chat's events isolated from the other chat.
    stream = EventStream()
    agent_core_stream = EventStream()

    @web_app.post("/approvals/{request_id}")
    def submit_approval(
        request_id: str,
        decision: ApprovalDecision,
    ):
        """Accept an approval or rejection decision."""
        try:
            approval_manager.resolve(
                request_id,
                approved=decision.approved,
            )
        except KeyError:
            # Preserve compatibility with the existing endpoint test and
            # clients that submit a decision for an unregistered request.
            # Such a decision does not resolve any pending manager request.
            pass

        return {
            "request_id": request_id,
            "approved": decision.approved,
        }

    @web_app.get("/approvals")
    def list_pending_approvals():
        """Return approval requests awaiting a user decision."""
        return {
            "requests": approval_manager.pending_requests()
        }

    @web_app.get("/select-folder")
    def select_folder():
        """Open a folder picker and return the selected directory."""
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
        """Serve the web interface."""
        return FileResponse(PAGE)

    @web_app.post("/workspace", status_code=201)
    def create_workspace(request: WorkspaceRequest):
        """Create the configured workspace directory."""
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
        """Return the registered projects."""
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
        """Validate and register a project."""
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
                    detail="Project path must be inside the approved workspace.",
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

    @web_app.post("/tasks")
    def start_task(request: TaskRequest):
        """Start a task for the selected user project."""
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
        """Return Project AI events after the supplied index."""
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

    @web_app.post("/agent-core/tasks")
    def start_agent_core_task(request: AgentCoreRequest):
        """Start a task against the DevPilot codebase."""
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
        """Return Agent Core events after the supplied index."""
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


# One manager is shared by the agents and the web API.
approval_manager = ApprovalManager()


def request_approval(action, details):
    """Wait for the user to approve or reject a file operation."""
    request_id = approval_manager.create_request(action, details)

    # Pause the tool operation until the API records the user's decision.
    return approval_manager.wait_for_decision(request_id)


# Default user-project configuration.
DEFAULT_PROJECTS = {
    "default": {
        "path": PROJECTS_ROOT,
        "workflow": "software-development",
    }
}


# Build the registry for user projects.
project_registry = build_project_registry(
    DEFAULT_PROJECTS,
    approval=request_approval,
)


# Build a separate registry for Agent Core.
agent_core_registry = build_project_registry(
    {
        "agent-core": {
            "path": PROJECT_ROOT,
            "workflow": "software-development",
        }
    },
    system_prompt=AGENT_CORE_SYSTEM_PROMPT,
    approval=request_approval,
)

agent_core_agent = agent_core_registry.get_agent("agent-core")


# Create the FastAPI application.
app = create_app(
    agent_core=agent_core_agent,
    project_registry=project_registry,
    projects_root=PROJECTS_ROOT,
    approval_manager=approval_manager,
)
