from collections.abc import Mapping

from deepagents import create_deep_agent
from deepagents.backends import StateBackend
from langchain_openai import ChatOpenAI

from vibe_system_design_agent.config import load_agent_runtime_config
from vibe_system_design_agent.prompt import SYSTEM_PROMPT
from vibe_system_design_agent.summarization import build_summarization_middleware

AGENT_NAME = "vibe-system-design"


def build_agent(env: Mapping[str, str] | None = None):
    config = load_agent_runtime_config(env)
    model = ChatOpenAI(
        model=config.model,
        api_key=lambda: config.api_key,
        base_url=config.base_url,
        stream_usage=True,
    )
    summarizer = ChatOpenAI(
        model=config.summary_model,
        api_key=lambda: config.api_key,
        base_url=config.base_url,
    )
    backend = StateBackend()
    return create_deep_agent(
        model=model,
        name=AGENT_NAME,
        system_prompt=SYSTEM_PROMPT,
        backend=backend,
        middleware=[
            build_summarization_middleware(
                model=model,
                summarizer=summarizer,
                backend=backend,
            )
        ],
    )


try:
    agent = build_agent()
except ValueError:
    agent = None  # type: ignore
