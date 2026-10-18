class _ProjectRegistryStub:
    """Stands in for ProjectRegistry. It keeps agents and projects in memory and records the project that was added."""

    def __init__(self, agents=None, projects=None):
        self._agents = agents or {}
        self.projects = dict(projects or {})
        self.add_project_called_with = None

    def get_agent(self, project_id):
        return self._agents[project_id]

    def list_projects(self):
        return self.projects

    def add_project(self, project_id, config):
        self.add_project_called_with = (project_id, config)
        if project_id in self.projects:
            raise ValueError(f"Project already exists: {project_id}")
        self.projects[project_id] = dict(config)