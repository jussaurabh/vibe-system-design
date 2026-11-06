from collections.abc import Mapping

from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

from vibe_system_design_agent.config import load_agent_runtime_config
from vibe_system_design_agent.prompt import SYSTEM_PROMPT

AGENT_NAME = "vibe-system-design"


def build_agent(env: Mapping[str, str] | None = None):
    config = load_agent_runtime_config(env)
    model = ChatOpenAI(
        model=config.model,
        api_key=lambda: config.api_key,
        base_url=config.base_url,
        stream_usage=True,
    )
    return create_deep_agent(
        model=model,
        name=AGENT_NAME,
        system_prompt=SYSTEM_PROMPT,
    )


try:
    agent = build_agent()
except ValueError:
    agent = None  # type: ignore
