"""Model resolution — Python port of ``src/runtime/model.ts``.

Builds pydantic-ai Model instances from ``AppConfig``, with provider-aware
API-key resolution and summarization-tuned model overrides.
"""

from __future__ import annotations

import os
from typing import Any

from deepagents_template.runtime.config.config_schema import AppConfig
from deepagents_template.runtime.logger import logger

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
# pydantic-ai models are lightweight wrappers; caching avoids redundant
# instantiation during repeated calls within the same agent lifecycle.
_model_cache: dict[str, Any] = {}
_summarizer_cache: dict[str, Any] = {}


def resolve_model_string(config: AppConfig) -> str:
    """Return the ``provider:model-name`` string that pydantic-ai expects.

    Mirrors the TS template's ``resolveModelString()``.
    """
    return f"{config.model.provider}:{config.model.name}"


def _resolve_api_key(config: AppConfig) -> str | None:
    """Resolve the API key with provider-aware priority.

    For Anthropic (provider starts with ``anthropic``):
      AUTH_TOKEN_ENV > API_KEY_ENV > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY

    For OpenAI (provider starts with ``openai``):
      OPENAI_API_KEY > API_KEY_ENV > AUTH_TOKEN_ENV

    Returns ``None`` when no key is found — pydantic-ai will fall through
    to its own env-var detection or raise a helpful error at call time.
    """
    provider = config.model.provider.lower()
    api_key_env = config.model.api_key_env or ""
    auth_token_env = config.model.auth_token_env or ""

    if "openai" in provider:
        return (
            os.environ.get("OPENAI_API_KEY")
            or os.environ.get(api_key_env)
            or os.environ.get(auth_token_env)
            or None
        )

    # Anthropic / default
    return (
        os.environ.get(auth_token_env)
        or os.environ.get(api_key_env)
        or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        or os.environ.get("ANTHROPIC_API_KEY")
        or None
    )


def resolve_model(config: AppConfig) -> Any:
    """Build the pydantic-ai ``Model`` instance for the agent's primary model.

    Returns a pydantic-ai-compatible model object. The caller passes it to
    ``Agent(model=...)``.

    Cached so repeated calls during the same lifecycle do not re-instantiate.
    """
    cache_key = (
        f"{config.model.provider}:{config.model.name}"
        f"|{config.model.base_url or ''}"
        f"|{config.model.settings.temperature}"
        f"|{config.model.settings.max_tokens or ''}"
    )
    if cache_key in _model_cache:
        return _model_cache[cache_key]

    api_key = _resolve_api_key(config)
    provider = config.model.provider.lower()
    model_name = config.model.name

    log = logger.child("model")
    log.info("Resolving model", {"provider": provider, "name": model_name})

    model: Any
    if "openai" in provider:
        from pydantic_ai.models.openai import OpenAIModel

        model = OpenAIModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )
    elif "anthropic" in provider or "claude" in provider:
        from pydantic_ai.models.anthropic import AnthropicModel

        model = AnthropicModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )
    elif "google" in provider or "gemini" in provider:
        from pydantic_ai.models.gemini import GeminiModel

        model = GeminiModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )
    elif "groq" in provider:
        from pydantic_ai.models.openai import OpenAIModel

        model = OpenAIModel(
            model_name,
            base_url=config.model.base_url or "https://api.groq.com/openai/v1",
            api_key=api_key,
        )
    else:
        # Fallback: try OpenAI-compatible
        from pydantic_ai.models.openai import OpenAIModel

        model = OpenAIModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )

    _model_cache[cache_key] = model
    return model


def resolve_summarizer_model(config: AppConfig) -> Any:
    """Build a model tuned for LLM-based summarization (compaction).

    Uses ``config.compaction.summarizer_model`` if set, else the agent's
    primary model. Always applies temperature 0 and bounded ``max_tokens``
    so summaries are deterministic and cheap.
    """
    model_name = config.compaction.summarizer_model or config.model.name
    cache_key = f"{config.model.provider}:{model_name}|{config.model.base_url or ''}"
    if cache_key in _summarizer_cache:
        return _summarizer_cache[cache_key]

    api_key = _resolve_api_key(config)
    provider = config.model.provider.lower()

    model: Any
    if "openai" in provider:
        from pydantic_ai.models.openai import OpenAIModel

        model = OpenAIModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )
    else:
        from pydantic_ai.models.anthropic import AnthropicModel

        model = AnthropicModel(
            model_name,
            base_url=config.model.base_url or None,
            api_key=api_key,
        )

    _summarizer_cache[cache_key] = model
    return model
