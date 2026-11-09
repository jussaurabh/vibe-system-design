from unittest.mock import MagicMock

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from vibe_system_design_agent.summarization import (
    SUMMARIZATION_KEEP_MESSAGES,
    SUMMARIZATION_TRIGGER_TOKENS,
    build_summarization_middleware,
)


def _build():
    model = FakeListChatModel(responses=["agent"])
    summarizer = FakeListChatModel(responses=["summary"])
    backend = MagicMock(name="backend")
    middleware = build_summarization_middleware(
        model=model,
        summarizer=summarizer,
        backend=backend,
    )
    return middleware, model, summarizer, backend


def test_replaces_the_built_in_summarization_slot_by_name():
    middleware, *_ = _build()
    assert middleware.name == "SummarizationMiddleware"


def test_triggers_at_60k_tokens_and_keeps_20_messages():
    middleware, *_ = _build()
    assert middleware._lc_helper.trigger == ("tokens", SUMMARIZATION_TRIGGER_TOKENS)
    assert middleware._lc_helper.keep == ("messages", SUMMARIZATION_KEEP_MESSAGES)


def test_counts_with_the_main_model_and_summarizes_with_the_summarizer():
    middleware, model, summarizer, backend = _build()
    assert middleware._lc_helper.model is model
    assert middleware._lc_helper._summary_chat_model is summarizer
    assert middleware._backend is backend


def test_does_not_trigger_below_60k_tokens():
    middleware, *_ = _build()
    assert middleware._should_summarize([], SUMMARIZATION_TRIGGER_TOKENS - 1) is False


def test_triggers_at_exactly_60k_tokens():
    middleware, *_ = _build()
    assert middleware._should_summarize([], SUMMARIZATION_TRIGGER_TOKENS) is True


def test_keeps_the_last_20_messages():
    from langchain_core.messages import HumanMessage

    middleware, *_ = _build()
    messages = [HumanMessage(content=f"message {index}") for index in range(30)]
    assert middleware._determine_cutoff_index(messages) == 10