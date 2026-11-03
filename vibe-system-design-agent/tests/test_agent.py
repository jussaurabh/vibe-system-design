from pathlib import Path
from unittest.mock import MagicMock, patch

import vibe_system_design_agent.agent as agent_module


def test_builds_a_deep_agent_with_fixed_prompt_and_no_checkpointer():
    model_instance = MagicMock(name="model-instance")
    env = {
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENROUTER_API_KEY": "sk-test",
        "OPENROUTER_DEFAULT_MODEL": "openai/gpt-4o-mini",
    }
    with (
        patch("vibe_system_design_agent.agent.create_deep_agent") as create_deep_agent,
        patch("vibe_system_design_agent.agent.ChatOpenAI") as chat_open_ai,
    ):
        chat_open_ai.return_value = model_instance
        agent_module.build_agent(env)

        chat_open_ai.assert_called_once_with(
            model="openai/gpt-4o-mini",
            api_key="sk-test",
            base_url="https://openrouter.ai/api/v1",
        )
        create_deep_agent.assert_called_once()
        kwargs = create_deep_agent.call_args.kwargs
        assert kwargs["name"] == "vibe-system-design"
        assert "Expert teacher of high-level (HLD) and low-level (LLD) software system design" in kwargs["system_prompt"]
        assert "<user_prompt>" in kwargs["system_prompt"]
        assert kwargs["model"] is model_instance
        assert "checkpointer" not in kwargs


def test_system_prompt_matches_ts_source_verbatim():
    from vibe_system_design_agent.agent import SYSTEM_PROMPT

    ts_prompt = Path("src/agent_prompt_reference.txt").read_text(encoding="utf-8")
    assert SYSTEM_PROMPT == ts_prompt
