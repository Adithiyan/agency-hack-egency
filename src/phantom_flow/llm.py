"""LLM provider abstraction for case-writing agents."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

import httpx
from dotenv import load_dotenv


class LLMClient(Protocol):
    provider: str
    model: str

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        """Return a single text completion."""


@dataclass(frozen=True)
class LLMConfig:
    provider: str = "template"
    model: str = ""
    temperature: float = 0.2
    timeout_seconds: float = 30.0


class TemplateLLMClient:
    provider = "template"
    model = "deterministic-template"

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        raise RuntimeError("TemplateLLMClient does not call an external model.")


class OpenAICompatibleClient:
    """Small REST client for OpenAI-compatible chat-completions APIs."""

    def __init__(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.2,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.provider = provider
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.timeout_seconds = timeout_seconds

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "temperature": self.temperature,
                "max_tokens": max_tokens,
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return payload["choices"][0]["message"]["content"].strip()


class ClaudeClient:
    provider = "claude"

    def __init__(
        self,
        api_key: str,
        model: str,
        temperature: float = 0.2,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.timeout_seconds = timeout_seconds

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        import anthropic

        client = anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout_seconds)
        message = client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=self.temperature,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(block.text for block in message.content if getattr(block, "type", "") == "text").strip()


def build_llm_client(provider: str | None = None) -> LLMClient:
    load_dotenv()
    selected = (provider or os.getenv("PHANTOM_FLOW_LLM_PROVIDER") or "template").lower()

    if selected in {"off", "none", "template"}:
        return TemplateLLMClient()

    if selected == "groq":
        api_key = _required_env("GROQ_API_KEY")
        model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
        return OpenAICompatibleClient(
            provider="groq",
            base_url="https://api.groq.com/openai/v1",
            api_key=api_key,
            model=model,
        )

    if selected == "gemini":
        api_key = _required_env("GEMINI_API_KEY")
        model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        return OpenAICompatibleClient(
            provider="gemini",
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            api_key=api_key,
            model=model,
        )

    if selected == "claude":
        api_key = _required_env("ANTHROPIC_API_KEY")
        model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        return ClaudeClient(api_key=api_key, model=model)

    raise ValueError(f"Unsupported LLM provider: {selected}")


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required for the selected LLM provider.")
    return value
