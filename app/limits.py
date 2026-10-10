from dataclasses import dataclass

import yaml


@dataclass(frozen=True)
class Limits:
    allowed_commands: tuple = ()
    timeout: int = 60

    @staticmethod
    def load(path):
        with open(path, encoding="utf-8") as file:
            data = yaml.safe_load(file)
        return Limits(allowed_commands=tuple(data["allowed_commands"]), timeout=data["timeout"])

    def allows(self, command):
        return command in self.allowed_commands