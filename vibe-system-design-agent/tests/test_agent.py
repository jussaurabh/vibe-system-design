from pathlib import Path
from unittest.mock import MagicMock, patch

from deepagents.backends import StateBackend

import vibe_system_design_agent.agent as agent_module


def test_builds_a_deep_agent_with_summarization_and_no_checkpointer():
    model_instance = MagicMock(name="model-instance")
    summarizer_instance = MagicMock(name="summarizer-instance")
    middleware_instance = MagicMock(name="middleware-instance")
    env = {
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENROUTER_API_KEY": "sk-test",
        "OPENROUTER_DEFAULT_MODEL": "openai/gpt-4o-mini",
    }
    with (
        patch("vibe_system_design_agent.agent.create_deep_agent") as create_deep_agent,
        patch("vibe_system_design_agent.agent.ChatOpenAI") as chat_open_ai,
        patch("vibe_system_design_agent.agent.build_summarization_middleware") as build_summarization_middleware,
    ):
        chat_open_ai.side_effect = [model_instance, summarizer_instance]
        build_summarization_middleware.return_value = middleware_instance
        agent_module.build_agent(env)

        first_call, second_call = chat_open_ai.call_args_list
        assert first_call.kwargs["model"] == "openai/gpt-4o-mini"
        assert first_call.kwargs["base_url"] == "https://openrouter.ai/api/v1"
        assert first_call.kwargs["stream_usage"] is True
        assert first_call.kwargs["api_key"]() == "sk-test"
        assert second_call.kwargs["model"] == "openai/gpt-4o-mini"
        assert second_call.kwargs["base_url"] == "https://openrouter.ai/api/v1"
        assert second_call.kwargs["api_key"]() == "sk-test"
        assert "stream_usage" not in second_call.kwargs

        create_deep_agent.assert_called_once()
        kwargs = create_deep_agent.call_args.kwargs
        assert kwargs["name"] == "vibe-system-design"
        assert "Expert teacher of high-level (HLD) and low-level (LLD) software system design" in kwargs["system_prompt"]
        assert "<user_prompt>" in kwargs["system_prompt"]
        assert kwargs["model"] is model_instance
        assert isinstance(kwargs["backend"], StateBackend)
        assert kwargs["middleware"] == [middleware_instance]
        assert "checkpointer" not in kwargs
        build_summarization_middleware.assert_called_once_with(
            model=model_instance,
            summarizer=summarizer_instance,
            backend=kwargs["backend"],
        )


def test_system_prompt_matches_ts_source_verbatim():
    from vibe_system_design_agent.agent import SYSTEM_PROMPT

    ts_prompt = Path("src/agent_prompt_reference.txt").read_text(encoding="utf-8")
    assert SYSTEM_PROMPT == ts_prompt


def test_requests_streaming_usage_only_from_the_main_model():
    env = {
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENROUTER_API_KEY": "sk-test",
        "OPENROUTER_DEFAULT_MODEL": "openai/gpt-4o-mini",
    }
    with (
        patch("vibe_system_design_agent.agent.create_deep_agent"),
        patch("vibe_system_design_agent.agent.ChatOpenAI") as chat_open_ai,
        patch("vibe_system_design_agent.agent.build_summarization_middleware"),
    ):
        agent_module.build_agent(env)

        assert chat_open_ai.call_args_list[0].kwargs["stream_usage"] is True
        assert "stream_usage" not in chat_open_ai.call_args_list[1].kwargs


def test_summarizer_uses_the_configured_summary_model():
    env = {
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENROUTER_API_KEY": "sk-test",
        "OPENROUTER_DEFAULT_MODEL": "openai/gpt-4o-mini",
        "OPENROUTER_SUMMARY_MODEL": "openai/gpt-4o-mini-cheap",
    }
    with (
        patch("vibe_system_design_agent.agent.create_deep_agent"),
        patch("vibe_system_design_agent.agent.ChatOpenAI") as chat_open_ai,
        patch("vibe_system_design_agent.agent.build_summarization_middleware"),
    ):
        agent_module.build_agent(env)

        assert chat_open_ai.call_args_list[1].kwargs["model"] == "openai/gpt-4o-mini-cheap"

