
class _ProjectRegistryStub:
    """Stand in for ProjectRegistry during web API tests."""

    def __init__(self, agents=None, projects=None):
        self._agents = agents or {}
        self.projects = dict(projects or {})
        self.add_project_called_with = None

    def get_agent(self, project_id):
        return self._agents[project_id]

    def get_config(self, project_id):
        try:
            return self.projects[project_id]
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None

    def list_projects(self):
        return self.projects

    def add_project(self, project_id, config):
        """Register a project without replacing an existing project."""
        if project_id in self.projects:
            raise ValueError(f"Project already exists: {project_id}")

        self.add_project_called_with = (project_id, config)
        self.projects[project_id] = dict(config)

    def remove_project(self, project_id):
        try:
            return self.projects.pop(project_id)
        except KeyError:
            raise KeyError(f"Unknown project: {project_id}") from None

