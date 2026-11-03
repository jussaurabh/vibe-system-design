import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentRuntimeConfig:
    base_url: str
    api_key: str
    model: str


_REQUIRED_VARS = ("OPENROUTER_BASE_URL", "OPENROUTER_API_KEY", "OPENROUTER_DEFAULT_MODEL")


def load_agent_runtime_config(env: Mapping[str, str] | None = None) -> AgentRuntimeConfig:
    source = env if env is not None else os.environ
    values: dict[str, str] = {}
    for var in _REQUIRED_VARS:
        value = source.get(var)
        if not value:
            raise ValueError(f"Missing required env var {var}")
        values[var] = value
    return AgentRuntimeConfig(
        base_url=values["OPENROUTER_BASE_URL"],
        api_key=values["OPENROUTER_API_KEY"],
        model=values["OPENROUTER_DEFAULT_MODEL"],
    )
