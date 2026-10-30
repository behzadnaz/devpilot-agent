import importlib.metadata
import json
import re
import shutil
import subprocess
import sys


class EnvironmentChecker:
    """Detect installed development tools and compare their versions."""

    def __init__(self):
        # False = not loaded yet; None = npm unusable; dict = global packages.
        self._npm_globals_cache = False

    # canonical key: (display name, executables, version args, versions comparable)
    _EXECUTABLE_TOOLS = {
        "python": ("Python", ("python", "python3", "py"), ("--version",), True),
        "node": ("Node.js", ("node",), ("--version",), True),
        "npm": ("npm", ("npm",), ("--version",), True),
        "java": ("Java", ("java",), ("-version",), True),
        "go": ("Go", ("go",), ("version",), True),
        "rust": ("Rust", ("rustc",), ("--version",), True),
        "php": ("PHP", ("php",), ("--version",), True),
        "ruby": ("Ruby", ("ruby",), ("--version",), True),
        "dotnet": (".NET", ("dotnet",), ("--version",), True),
        "docker": ("Docker", ("docker",), ("--version",), True),
        "git": ("Git", ("git",), ("--version",), True),
        "postgresql": ("PostgreSQL", ("psql",), ("--version",), True),
        "mysql": ("MySQL", ("mysql",), ("--version",), True),
        "sqlite": ("SQLite", ("sqlite3",), ("--version",), True),
        "mongodb": ("MongoDB", ("mongosh", "mongo"), ("--version",), True),
        "redis": ("Redis", ("redis-server",), ("--version",), True),
    }

    # Python packages detected through the current interpreter's metadata.
    _PYTHON_PACKAGES = {
        "fastapi": "FastAPI",
        "flask": "Flask",
        "django": "Django",
        "pytest": "pytest",
        "uvicorn": "uvicorn",
        "playwright": "Playwright",
        "sqlalchemy": "SQLAlchemy",
    }

    # Alternate spellings of the same tool; version comparison still applies.
    _ALIASES = {
        "nodejs": "node",
        "node.js": "node",
        "postgres": "postgresql",
        "psql": "postgresql",
        "golang": "go",
        "rustc": "rust",
        "sqlite3": "sqlite",
        "mongo": "mongodb",
        "mongosh": "mongodb",
        "c#": "dotnet",
        "csharp": "dotnet",
        ".net": "dotnet",
    }

    # npm libraries: per-project dependencies checked against the machine's
    # global npm packages (`npm ls -g`). They are not machine-wide installs,
    # so their presence is reported honestly instead of inferred from Node.js.
    _NPM_PACKAGES = {
        "react": "react",
        "vue": "vue",
        "vue.js": "vue",
        "angular": "@angular/cli",
        "svelte": "svelte",
        "next.js": "next",
        "nextjs": "next",
        "express": "express",
        "express.js": "express",
        "vite": "vite",
        "tailwind": "tailwindcss",
        "tailwindcss": "tailwindcss",
    }

    # Frameworks that do not install anything themselves: their availability
    # follows a runtime. The runtime version is not the framework version, so
    # a requested version is never compared for these.
    _RUNTIME_FRAMEWORKS = {
        "javascript": "node",
        "typescript": "node",
        "spring": "java",
        "spring boot": "java",
        "laravel": "php",
        "rails": "ruby",
        "ruby on rails": "ruby",
    }

    def _resolve(self, name: str) -> dict | None:
        normalized = " ".join(name.strip().lower().split())
        if not normalized:
            return None

        key = self._ALIASES.get(normalized)
        if key is None and normalized in self._EXECUTABLE_TOOLS:
            key = normalized

        if key is not None:
            display, executables, args, comparable = self._EXECUTABLE_TOOLS[key]
            return {
                "key": key,
                "display": display,
                "kind": "executable",
                "executables": executables,
                "args": args,
                "compare": comparable,
                "via": None,
            }

        if normalized in self._PYTHON_PACKAGES:
            return {
                "key": normalized,
                "display": self._PYTHON_PACKAGES[normalized],
                "kind": "package",
                "compare": True,
                "via": None,
            }

        npm_name = self._NPM_PACKAGES.get(normalized)
        if npm_name is not None:
            return {
                "key": npm_name,
                "display": npm_name,
                "kind": "npm",
                "compare": False,
                "via": None,
            }

        runtime = self._RUNTIME_FRAMEWORKS.get(normalized)
        if runtime is not None:
            display, executables, args, _ = self._EXECUTABLE_TOOLS[runtime]
            return {
                "key": runtime,
                "display": display,
                "kind": "executable",
                "executables": executables,
                "args": args,
                "compare": False,
                "via": display,
            }

        # Multi-word input such as "Docker compose": fall back to the first
        # token that names a recognizable tool.
        tokens = normalized.split()
        if len(tokens) > 1:
            for token in tokens:
                resolved = self._resolve(token)
                if resolved is not None:
                    return resolved

        return None

    def canonical_name(self, name: str) -> str | None:
        """Canonical catalog key for a technology name, or None if unknown."""

        spec = self._resolve(name)
        return spec["key"] if spec else None

    def reset_caches(self) -> None:
        """Clear cached lookups so the next check sees fresh machine state."""

        self._npm_globals_cache = False

    def _detect_version(self, name: str) -> str | None:
        spec = self._resolve(name)

        if spec is None:
            return None

        try:
            if spec["kind"] == "package":
                try:
                    return (
                        f"{spec['display']} "
                        f"{importlib.metadata.version(spec['key'])}"
                    )
                except importlib.metadata.PackageNotFoundError:
                    return None

            candidates = spec["executables"]
            if spec["key"] == "python":
                candidates = (sys.executable, *candidates)

            for executable in candidates:
                path = shutil.which(executable)
                if not path:
                    continue

                result = subprocess.run(
                    [path, *spec["args"]],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )

                output = (result.stdout or "").strip()
                if not output:
                    output = (result.stderr or "").strip()

                return output.splitlines()[0] if output else None

        except (OSError, subprocess.TimeoutExpired):
            return None

        return None

    @staticmethod
    def _version_from_output(output: str | None) -> str | None:
        if not output:
            return None

        match = re.search(r"(?<!\d)(\d+(?:\.\d+)+)", output)
        return match.group(1) if match else None

    @staticmethod
    def _split_embedded_version(name: str) -> tuple[str, str]:
        """Split "Python 3.12" into ("Python", "3.12")."""

        match = re.search(r"\s+v?(\d+(?:\.\d+)*)\s*$", name)
        if not match:
            return name, ""

        remainder = name[: match.start()].strip()
        if not remainder:
            return name, ""

        return remainder, match.group(1)

    def check_one(
        self,
        component: str,
        name: str,
        requested_version: str | None = None,
    ) -> dict:
        clean_name = " ".join(str(name or "").strip().split())
        requested = (requested_version or "").strip()

        if not requested:
            clean_name, embedded = self._split_embedded_version(clean_name)
            requested = embedded

        result = {
            "component": component,
            "name": clean_name,
            "requested_version": requested or None,
            "detected_version": None,
            "runtime": None,
            "note": None,
            "status": "check_failed",
        }

        spec = self._resolve(clean_name)

        if spec is None:
            return result

        result["runtime"] = spec["via"]

        if spec["kind"] == "npm":
            self._apply_npm_result(result, spec)
            return result

        output = self._detect_version(clean_name)
        detected_version = self._version_from_output(output)

        if detected_version is None:
            result["status"] = "not_installed"
            return result

        result["detected_version"] = detected_version

        if (
            requested
            and spec["compare"]
            and not detected_version.startswith(requested)
        ):
            result["status"] = "version_mismatch"
        else:
            result["status"] = "installed"

        return result

    def _npm_globals(self) -> dict | None:
        """Global npm packages as {name: {"version": ...}}, or None when npm
        itself is unusable. Loaded once per check run."""

        if self._npm_globals_cache is not False:
            return self._npm_globals_cache

        npm = shutil.which("npm")
        if not npm:
            self._npm_globals_cache = None
            return None

        try:
            result = subprocess.run(
                [npm, "ls", "-g", "--depth=0", "--json"],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            data = json.loads(result.stdout or "{}")
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            self._npm_globals_cache = {}
            return self._npm_globals_cache

        dependencies = data.get("dependencies") if isinstance(data, dict) else None
        self._npm_globals_cache = (
            dependencies if isinstance(dependencies, dict) else {}
        )
        return self._npm_globals_cache

    def _apply_npm_result(self, result: dict, spec: dict) -> None:
        globals_ = self._npm_globals()

        if globals_ is None:
            result["status"] = "not_installed"
            result["note"] = (
                f"{result['name']} is an npm library, but npm is not available "
                "on this computer, so it could not be checked."
            )
            return

        entry = globals_.get(spec["key"])
        version = entry.get("version") if isinstance(entry, dict) else None

        if version:
            result["detected_version"] = version
            result["status"] = "installed"
            return

        node_version = self._version_from_output(self._detect_version("node"))
        node_note = (
            f"Node.js {node_version} is available"
            if node_version
            else "Node.js is not installed on this computer either"
        )
        result["status"] = "not_installed"
        result["note"] = (
            f"{result['name']} was not found in this computer's global npm "
            f"packages. It is an npm library that gets added per project with "
            f"`npm install {spec['key']}` during setup ({node_note})."
        )

    def check(self, requirements: list[dict]) -> list[dict]:
        self._npm_globals_cache = False
        return [
            self.check_one(
                component=item.get("component", ""),
                name=item.get("name", ""),
                requested_version=item.get(
                    "version",
                    item.get("requested_version"),
                ),
            )
            for item in requirements
        ]
