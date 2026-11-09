from deepagents.backends import BackendProtocol
from deepagents.middleware import SummarizationMiddleware
from langchain_core.language_models import BaseChatModel

SUMMARIZATION_TRIGGER_TOKENS = 60_000
SUMMARIZATION_KEEP_MESSAGES = 20


def build_summarization_middleware(
    *,
    model: BaseChatModel,
    summarizer: BaseChatModel,
    backend: BackendProtocol,
) -> SummarizationMiddleware:
    return SummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=("tokens", SUMMARIZATION_TRIGGER_TOKENS),
        keep=("messages", SUMMARIZATION_KEEP_MESSAGES),
        trim_tokens_to_summarize=None,
        summarizer=summarizer,
    )