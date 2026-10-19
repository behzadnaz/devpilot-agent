
import inspect
import os
import threading
from pathlib import Path

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from send2trash import send2trash

from app.agent_factory import AgentFactory
from app.approval import ApprovalManager
from app.config import ModelSettings
from app.events import EventStream
from app.limits import Limits
from app.llm import LLMClient
from app.project_registry import ProjectRegistry
from app.tool_schemas import ToolSchemas


# ---------------------------------------------------------
# Paths and configuration
# ---------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = WEB_ROOT / "static"
PAGE = STATIC_ROOT / "index.html"

MODEL_CONFIG = PROJECT_ROOT / "config" / "model.yaml"
TOOLS_CONFIG = PROJECT_ROOT / "config" / "tools.json"
LIMITS_CONFIG = PROJECT_ROOT / "config" / "limits.yaml"

PROJECTS_ROOT = Path(
    os.environ.get(
        "DEVPILOT_PROJECTS_ROOT",
        str(Path.home() / "DevPilot-Workspace"),
    )
).expanduser().resolve()


# ---------------------------------------------------------
# Agent instructions
# ---------------------------------------------------------

SYSTEM_PROMPT = """
You are a software development assistant working within the selected project.

Use the available tools to inspect or modify project files when appropriate.
Stay within the selected project directory.
Explain your actions clearly.
Never claim a change succeeded unless it did.
"""

AGENT_CORE_SYSTEM_PROMPT = """
You are Agent Core, the software development agent responsible for
the DevPilot agent codebase itself.

Your working directory is the DevPilot repository.
Use available tools to inspect and modify Agent Core files when appropriate.
Keep your work within the Agent Core repository.
Do not confuse Agent Core development with development of a user project.
Explain your actions clearly.
Never claim a change succeeded unless it did.
"""


# ---------------------------------------------------------
# API request models
# ---------------------------------------------------------

class TaskRequest(BaseModel):
    message: str
    project_id: str = "default"
    mode: str = "ask"
    tags: list[str] = Field(default_factory=list)


class AgentCoreRequest(BaseModel):
    message: str
    mode: str = "ask"
    tags: list[str] = Field(default_factory=list)


class ProjectRequest(BaseModel):
    id: str
    path: str
    workflow: str
    tags: list[str] = Field(default_factory=list)


class WorkspaceRequest(BaseModel):
    path: str


class ApprovalDecision(BaseModel):
    approved: bool


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _in_background(job):
    """Run a job in a daemon thread."""
    threading.Thread(target=job, daemon=True).start()


def _run_agent_safely(
    agent_instance,
    message,
    events,
    mode="ask",
    tags=None,
):
    """Run an agent and publish an error if the task crashes."""
    try:
        run_method = agent_instance.run
        parameters = inspect.signature(run_method).parameters

        accepts_extra_keywords = any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in parameters.values()
        )

        kwargs = {}

        if "mode" in parameters or accepts_extra_keywords:
            kwargs["mode"] = mode

        if "tags" in parameters or accepts_extra_keywords:
            kwargs["tags"] = tags or []

        run_method(message, events, **kwargs)

    except Exception as exc:
        events.publish("status", "failed")
        events.publish("message", f"Agent failed: {exc}")


def _safe_project_path(project_registry, project_id):
    """Return a registered project's resolved directory."""
    if project_registry is None:
        raise HTTPException(
            status_code=503,
            detail="Project registry is not configured.",
        )

    try:
        config = project_registry.get_config(project_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Project not found.",
        ) from None

    if not config.get("path"):
        raise HTTPException(
            status_code=400,
            detail="Project has no configured path.",
        )

    return Path(config["path"]).expanduser().resolve()


def _resolve_project_file(project_root, relative_path):
    """Resolve a requested file while preventing path traversal."""
    root = Path(project_root).resolve()
    requested = (root / relative_path).resolve()

    if not requested.is_relative_to(root):
        raise HTTPException(
            status_code=400,
            detail="The requested path is outside the project directory.",
        )

    return requested


# ---------------------------------------------------------
# Configuration factories
# ---------------------------------------------------------

def load_model_settings():
    return ModelSettings.load(MODEL_CONFIG)


def create_llm_client(settings):
    return LLMClient(
        settings=settings,
        ollama_client=ollama.Client(host=settings.endpoint),
    )


def load_tool_schemas():
    return ToolSchemas.load(TOOLS_CONFIG)


def load_limits():
    return Limits.load(LIMITS_CONFIG)


def build_project_registry(
    projects,
    system_prompt=SYSTEM_PROMPT,
    approval=None,
    llm=None,
):
    settings = load_model_settings()
    llm = llm or create_llm_client(settings)

    factory = AgentFactory(
        llm=llm,
        tool_schemas=load_tool_schemas(),
        system_prompt=system_prompt,
        approval=approval,
        limits=load_limits(),
    )

    return ProjectRegistry(
        projects=projects,
        agent_factory=factory,
    )


def select_folder_dialog():
    """Open a native folder picker when running locally."""
    import tkinter as tk
    from tkinter import filedialog

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


# ---------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------

def create_app(
    agent=None,
    start=_in_background,
    project_registry=None,
    projects_root=None,
    agent_core=None,
    approval_manager=None,
):
    web_app = FastAPI()

    web_app.mount(
        "/static",
        StaticFiles(directory=STATIC_ROOT),
        name="static",
    )

    if approval_manager is None:
        approval_manager = ApprovalManager()

    project_stream = EventStream()
    agent_core_stream = EventStream()

    # -----------------------------------------------------
    # Main page
    # -----------------------------------------------------

    @web_app.get("/")
    def page():
        return FileResponse(PAGE)

    # -----------------------------------------------------
    # Workspace
    # -----------------------------------------------------

    @web_app.post("/workspace", status_code=201)
    def create_workspace(request: WorkspaceRequest):
        if projects_root is None:
            raise HTTPException(
                status_code=503,
                detail="Workspace root is not configured.",
            )

        root = Path(projects_root).expanduser().resolve()
        requested = Path(request.path).expanduser().resolve()

        if requested != root:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Workspace path must match the configured "
                    "workspace root."
                ),
            )

        try:
            requested.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not create workspace.",
            ) from exc

        return {"path": str(requested)}

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

    # -----------------------------------------------------
    # Projects
    # -----------------------------------------------------

    @web_app.get("/projects")
    def list_projects():
        if project_registry is None:
            return {"projects": []}

        projects = project_registry.list_projects()

        return {
            "projects": [
                {
                    "id": project_id,
                    "workflow": config.get(
                        "workflow",
                        "software-development",
                    ),
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
        raw_path = request.path.strip()
        workflow = request.workflow.strip()

        if not project_id or not raw_path or not workflow:
            raise HTTPException(
                status_code=400,
                detail="Project ID, path, and workflow are required.",
            )

        existing_projects = project_registry.list_projects()

        if project_id in existing_projects:
            raise HTTPException(
                status_code=409,
                detail=f"Project already exists: {project_id}",
            )

        requested_path = Path(raw_path).expanduser().resolve()

        if not requested_path.exists() or not requested_path.is_dir():
            raise HTTPException(
                status_code=400,
                detail="Project path must be an existing directory.",
            )

        try:
            project_registry.add_project(
                project_id,
                {
                    "path": requested_path,
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

    @web_app.delete("/projects/{project_id}")
    def delete_project(project_id: str):
        """Move a registered project to the Recycle Bin."""
        if project_registry is None:
            raise HTTPException(
                status_code=503,
                detail="Project registry is not configured.",
            )

        project_path = _safe_project_path(
            project_registry,
            project_id,
        )

        workspace_root = Path(
            projects_root if projects_root is not None
            else PROJECTS_ROOT
        ).expanduser().resolve()

        # Reject anything outside the configured workspace.
        # Also protect the workspace root and the DevPilot repository.
        if (
            project_path == workspace_root
            or not project_path.is_relative_to(workspace_root)
            or project_path == PROJECT_ROOT
            or project_path in PROJECT_ROOT.parents
            or PROJECT_ROOT in project_path.parents
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Project folder must be inside the workspace "
                    "and cannot be a protected folder."
                ),
            )

        if not project_path.exists() or not project_path.is_dir():
            raise HTTPException(
                status_code=400,
                detail="Project folder does not exist.",
            )

        try:
            # Move the folder to the OS Recycle Bin.
            send2trash(str(project_path))
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not move the project to the Recycle Bin.",
            ) from exc

        try:
            project_registry.remove_project(project_id)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail="Project not found in the registry.",
            ) from None

        return {"deleted": project_id}

    # -----------------------------------------------------
    # Project file tree
    # -----------------------------------------------------

    @web_app.get("/tree")
    def project_tree(project_id: str = "default"):
        root = _safe_project_path(project_registry, project_id)

        if not root.is_dir():
            return {"files": []}

        files = []

        try:
            for item in sorted(root.rglob("*")):
                if not item.is_file():
                    continue

                relative = item.relative_to(root)

                if any(
                    part in {
                        ".git",
                        ".venv",
                        "venv",
                        "__pycache__",
                        "node_modules",
                        ".pytest_cache",
                    }
                    for part in relative.parts
                ):
                    continue

                files.append(relative.as_posix())

                if len(files) >= 2000:
                    break

        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not read the project file tree.",
            ) from exc

        return {"files": files}

    # -----------------------------------------------------
    # Read a project file
    # -----------------------------------------------------

    @web_app.get("/file")
    def read_project_file(
        project_id: str = "default",
        path: str = "",
    ):
        if not path.strip():
            raise HTTPException(
                status_code=400,
                detail="A file path is required.",
            )

        root = _safe_project_path(project_registry, project_id)
        requested = _resolve_project_file(root, path)

        if not requested.exists() or not requested.is_file():
            raise HTTPException(
                status_code=404,
                detail="File not found.",
            )

        try:
            content = requested.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not read the file.",
            ) from exc

        return {"content": content}

    # -----------------------------------------------------
    # Canvas/preview data
    # -----------------------------------------------------

    @web_app.get("/outputs")
    def project_outputs(project_id: str = "default"):
        _safe_project_path(project_registry, project_id)

        return {
            "preview": None,
            "story_map": None,
        }

    # -----------------------------------------------------
    # Project AI tasks
    # -----------------------------------------------------

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
            lambda: _run_agent_safely(
                selected_agent,
                request.message,
                project_stream,
                request.mode,
                request.tags,
            )
        )

        return {
            "started": True,
            "scope": "project",
        }

    @web_app.get("/events")
    def project_events(after: int = 0):
        found = project_stream.since(after)

        return {
            "events": [
                {"type": event.type, "text": event.text}
                for event in found
            ],
            "next": after + len(found),
        }

    # -----------------------------------------------------
    # Agent Core tasks
    # -----------------------------------------------------

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
            lambda: _run_agent_safely(
                agent_core,
                request.message,
                agent_core_stream,
                request.mode,
                request.tags,
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
                {"type": event.type, "text": event.text}
                for event in found
            ],
            "next": after + len(found),
        }

    # -----------------------------------------------------
    # Approvals
    # -----------------------------------------------------

    @web_app.get("/approvals")
    def list_pending_approvals():
        return {
            "requests": approval_manager.pending_requests(),
        }

    @web_app.post("/approvals/{request_id}")
    def submit_approval(
        request_id: str,
        decision: ApprovalDecision,
    ):
        try:
            approval_manager.resolve(
                request_id,
                approved=decision.approved,
            )
        except KeyError:
            pass

        return {
            "request_id": request_id,
            "approved": decision.approved,
        }

    return web_app


# ---------------------------------------------------------
# Default application configuration
# ---------------------------------------------------------

approval_manager = ApprovalManager()


def request_approval(action, details):
    request_id = approval_manager.create_request(
        action,
        details,
    )
    return approval_manager.wait_for_decision(request_id)


DEFAULT_PROJECTS = {
    "default": {
        "path": PROJECTS_ROOT,
        "workflow": "software-development",
    }
}


project_registry = build_project_registry(
    DEFAULT_PROJECTS,
    approval=request_approval,
)


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


app = create_app(
    project_registry=project_registry,
    projects_root=PROJECTS_ROOT,
    agent_core=agent_core_agent,
    approval_manager=approval_manager,
)

# Compatibility with deployment platforms that expect `application`.
application = app
