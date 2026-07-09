"""LLM client service for the optional AI-chat feature.

Every provider is reached through the OpenAI-compatible chat-completions
API, so any local or hosted server that speaks that protocol works:
OpenAI, Anthropic, Google Gemini, Ollama, LM Studio, llama.cpp, vLLM, …

All requests go directly from this machine to the endpoint the user
configured. There is no proxy, no telemetry, and keys never leave
~/.maskbase/settings.json.
"""

import json
import httpx
from pathlib import Path
from typing import Dict, List, Optional
from openai import OpenAI, RateLimitError, APIStatusError

SETTINGS_PATH = Path.home() / ".maskbase" / "settings.json"

OLLAMA_BASE_URL = "http://127.0.0.1:11434"

PROVIDERS: Dict[str, Dict] = {
    "openai": {
        "label": "OpenAI",
        "base_url": None,
        "models": ["gpt-5", "gpt-4.1", "gpt-4.1-mini"],
        "requires_key": True,
        "billing_url": "https://platform.openai.com/settings/organization/billing",
    },
    "anthropic": {
        "label": "Anthropic",
        "base_url": "https://api.anthropic.com/v1/",
        "models": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
        "requires_key": True,
        "billing_url": "https://console.anthropic.com/settings/billing",
    },
    "gemini": {
        "label": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
        "requires_key": True,
        "billing_url": "https://aistudio.google.com/app/apikey",
    },
    "ollama": {
        "label": "Ollama (local)",
        "base_url": f"{OLLAMA_BASE_URL}/v1/",
        "models": [],  # discovered live from the Ollama daemon
        "requires_key": False,
        "billing_url": "https://ollama.com/download",
    },
    "custom": {
        "label": "Custom endpoint",
        "base_url": None,  # user-configured
        "models": [],      # discovered live or user-typed
        "requires_key": False,
        "billing_url": "",
    },
}

MODEL_TO_PROVIDER: Dict[str, str] = {}
for pid, pinfo in PROVIDERS.items():
    for m in pinfo["models"]:
        MODEL_TO_PROVIDER[m] = pid

# Persisted state
_api_keys: Dict[str, str] = {}
_model: str = "gpt-5"
_provider: str = "openai"
_threshold: float = 0.75
_ignore_pronouns: bool = True
_custom_base_url: str = ""
_clients: Dict[str, OpenAI] = {}


def _resolve_base_url(provider: str) -> Optional[str]:
    if provider == "custom":
        return _custom_base_url or None
    return PROVIDERS[provider]["base_url"]


def _build_client(provider: str) -> Optional[OpenAI]:
    base_url = _resolve_base_url(provider)
    key = _api_keys.get(provider)
    if PROVIDERS[provider]["requires_key"] and not key:
        return None
    if provider == "custom" and not base_url:
        return None
    kwargs: Dict = {"api_key": key or "not-needed"}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _save_to_disk() -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "api_keys": _api_keys,
        "model": _model,
        "provider": _provider,
        "threshold": _threshold,
        "ignore_pronouns": _ignore_pronouns,
        "custom_base_url": _custom_base_url,
    }
    SETTINGS_PATH.write_text(json.dumps(data, indent=2))


def load_from_disk() -> None:
    global _api_keys, _model, _provider, _clients, _threshold, _ignore_pronouns, _custom_base_url
    if not SETTINGS_PATH.exists():
        return
    try:
        data = json.loads(SETTINGS_PATH.read_text())
        # Support legacy single-key format
        if "api_key" in data and "api_keys" not in data:
            old_key = data["api_key"]
            if old_key:
                _api_keys = {"openai": old_key}
        else:
            _api_keys = data.get("api_keys", {})
        _model = data.get("model", "gpt-5")
        _provider = data.get("provider") or MODEL_TO_PROVIDER.get(_model, "openai")
        _threshold = float(data.get("threshold", 0.75))
        _ignore_pronouns = bool(data.get("ignore_pronouns", True))
        _custom_base_url = str(data.get("custom_base_url", "") or "")
        _clients = {}
    except Exception:
        pass


def set_provider_key(provider: str, api_key: str) -> None:
    """Set or update the API key for a provider."""
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    _api_keys[provider] = api_key
    _clients.pop(provider, None)
    _save_to_disk()


def remove_provider_key(provider: str) -> None:
    """Remove the API key for a provider."""
    _api_keys.pop(provider, None)
    _clients.pop(provider, None)
    _save_to_disk()


def set_custom_endpoint(base_url: str, api_key: Optional[str] = None) -> None:
    """Configure the user-defined OpenAI-compatible endpoint."""
    global _custom_base_url
    _custom_base_url = base_url.strip().rstrip("/") + "/" if base_url.strip() else ""
    if api_key is not None:
        if api_key:
            _api_keys["custom"] = api_key
        else:
            _api_keys.pop("custom", None)
    _clients.pop("custom", None)
    _save_to_disk()


def set_model(model: str, provider: Optional[str] = None) -> None:
    global _model, _provider
    _model = model
    if provider and provider in PROVIDERS:
        _provider = provider
    else:
        _provider = MODEL_TO_PROVIDER.get(model, _provider)
    _save_to_disk()


def get_threshold() -> float:
    return _threshold


def set_threshold(threshold: float) -> None:
    global _threshold
    _threshold = threshold
    _save_to_disk()


def get_ignore_pronouns() -> bool:
    return _ignore_pronouns


def set_ignore_pronouns(ignore: bool) -> None:
    global _ignore_pronouns
    _ignore_pronouns = ignore
    _save_to_disk()


def _discover_ollama_models() -> List[str]:
    try:
        with httpx.Client(timeout=1.5) as client:
            resp = client.get(f"{OLLAMA_BASE_URL}/api/tags")
        if resp.status_code == 200:
            data = resp.json()
            return sorted(m.get("name", "") for m in data.get("models", []) if m.get("name"))
    except Exception:
        pass
    return []


def _discover_custom_models() -> List[str]:
    if not _custom_base_url:
        return []
    try:
        headers = {}
        key = _api_keys.get("custom")
        if key:
            headers["Authorization"] = f"Bearer {key}"
        with httpx.Client(timeout=2.5) as client:
            resp = client.get(f"{_custom_base_url.rstrip('/')}/models", headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("data", data if isinstance(data, list) else [])
            return sorted(str(m.get("id", "")) for m in items if isinstance(m, dict) and m.get("id"))
    except Exception:
        pass
    return []


def list_providers() -> Dict:
    """Full provider catalog for the frontend model picker."""
    providers = []
    for pid, pinfo in PROVIDERS.items():
        key = _api_keys.get(pid)
        masked = None
        if key:
            masked = key[:3] + "…" + key[-4:] if len(key) > 8 else "••••"

        models = list(pinfo["models"])
        available = bool(key) if pinfo["requires_key"] else True
        if pid == "ollama":
            models = _discover_ollama_models()
            available = len(models) > 0
        elif pid == "custom":
            models = _discover_custom_models()
            available = bool(_custom_base_url)

        providers.append({
            "id": pid,
            "label": pinfo["label"],
            "models": models,
            "requires_key": pinfo["requires_key"],
            "key_set": key is not None,
            "key_masked": masked,
            "available": available,
            "base_url": _custom_base_url if pid == "custom" else (pinfo["base_url"] or ""),
        })

    return {
        "providers": providers,
        "model": _model,
        "provider": _provider,
    }


def get_current_settings() -> Dict:
    keys_info: Dict[str, Dict] = {}
    for pid in PROVIDERS:
        key = _api_keys.get(pid)
        masked = None
        if key:
            masked = key[:3] + "…" + key[-4:] if len(key) > 8 else "••••"
        keys_info[pid] = {"set": key is not None, "masked": masked}

    chat_ready = is_configured()

    return {
        "api_key_set": chat_ready,
        "api_keys": keys_info,
        "model": _model,
        "provider": _provider,
        "threshold": _threshold,
        "ignore_pronouns": _ignore_pronouns,
        "custom_base_url": _custom_base_url,
    }


def is_configured() -> bool:
    """True when at least one chat provider can be used."""
    if any(_api_keys.get(pid) for pid in ("openai", "anthropic", "gemini")):
        return True
    if _custom_base_url:
        return True
    return len(_discover_ollama_models()) > 0


def _get_client(provider: str) -> OpenAI:
    client = _clients.get(provider)
    if client is None:
        client = _build_client(provider)
        if client is not None:
            _clients[provider] = client
    if client is None:
        if provider == "custom":
            raise ValueError("No custom endpoint configured. Set a base URL in Settings.")
        raise ValueError(
            f"No API key set for {PROVIDERS[provider]['label']}. "
            f"Please add your key in Settings."
        )
    return client


SYSTEM_MSG = (
    "You are a helpful AI assistant inside MaskBase, a local PII-redaction tool. "
    "If the user has attached documents, they have been redacted for privacy — "
    "PII is replaced with placeholders like [REDACTED_PERSON_1]. "
    "Use these placeholders when referring to redacted data. "
    "Never attempt to guess or reconstruct the original PII."
)


def chat(
    redacted_text: str,
    user_message: str,
    history: List[Dict[str, str]],
    model_override: Optional[str] = None,
    provider_override: Optional[str] = None,
) -> str:
    model = model_override or _model
    provider = provider_override or (
        MODEL_TO_PROVIDER.get(model) or (_provider if model == _model else None)
    )
    if not provider or provider not in PROVIDERS:
        # Fall back to the saved provider for custom/ollama model names
        provider = _provider if _provider in PROVIDERS else None
    if not provider:
        raise ValueError(f"Could not resolve a provider for model: {model}")

    client = _get_client(provider)

    messages = [{"role": "system", "content": SYSTEM_MSG}]
    if redacted_text:
        messages.append({"role": "user", "content": f"Here is the redacted document:\n\n{redacted_text}"})
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    try:
        response = client.chat.completions.create(model=model, messages=messages)
        return response.choices[0].message.content or ""
    except (RateLimitError, APIStatusError) as e:
        is_quota = isinstance(e, RateLimitError) or (
            isinstance(e, APIStatusError) and e.status_code == 429
        ) or "429" in str(e)
        if is_quota:
            label = PROVIDERS[provider]["label"]
            billing_url = PROVIDERS[provider].get("billing_url", "")
            hint = f" Check your billing at: {billing_url}" if billing_url else ""
            raise ValueError(
                f"You've exceeded your {label} token quota or rate limit.{hint}"
            )
        raise
