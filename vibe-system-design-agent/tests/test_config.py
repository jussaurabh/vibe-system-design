import pytest

from vibe_system_design_agent.config import load_agent_runtime_config

FULL_ENV = {
    "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
    "OPENROUTER_API_KEY": "sk-test",
    "OPENROUTER_DEFAULT_MODEL": "openai/gpt-4o-mini",
}


def test_reads_the_three_openrouter_vars():
    config = load_agent_runtime_config(FULL_ENV)
    assert config.base_url == "https://openrouter.ai/api/v1"
    assert config.api_key == "sk-test"
    assert config.model == "openai/gpt-4o-mini"
    assert config.summary_model == "openai/gpt-4o-mini"


@pytest.mark.parametrize(
    "missing",
    ["OPENROUTER_BASE_URL", "OPENROUTER_API_KEY", "OPENROUTER_DEFAULT_MODEL"],
)
def test_raises_naming_the_first_missing_var(missing):
    env = dict(FULL_ENV)
    del env[missing]
    with pytest.raises(ValueError, match=missing):
        load_agent_runtime_config(env)


def test_summary_model_defaults_to_the_agent_model():
    config = load_agent_runtime_config(FULL_ENV)
    assert config.summary_model == "openai/gpt-4o-mini"


def test_summary_model_can_be_overridden():
    env = {**FULL_ENV, "OPENROUTER_SUMMARY_MODEL": "openai/gpt-4o-mini-cheap"}
    config = load_agent_runtime_config(env)
    assert config.summary_model == "openai/gpt-4o-mini-cheap"


def test_blank_summary_model_falls_back_to_the_agent_model():
    env = {**FULL_ENV, "OPENROUTER_SUMMARY_MODEL": ""}
    config = load_agent_runtime_config(env)
    assert config.summary_model == "openai/gpt-4o-mini"
