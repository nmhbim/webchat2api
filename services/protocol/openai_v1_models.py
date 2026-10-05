from __future__ import annotations

from typing import Any

from services.providers.base import GEMINI_PROVIDER, GPT_PROVIDER, GROK_PROVIDER
from services.providers.gemini.models import gemini_model_metadata
from services.providers.gpt.models import GPT_IMAGE_MODEL_IDS, gpt_fallback_model_metadata, gpt_image_model_metadata
from services.providers.grok.models import grok_model_metadata


def _append_model(data: list[dict[str, Any]], seen: set[str], item: dict[str, Any]) -> None:
    model = str(item.get("id") or "").strip()
    if not model or model in seen:
        return
    seen.add(model)
    data.append(item)


def _with_provider(item: dict[str, Any], provider: str) -> dict[str, Any]:
    model = str(item.get("id") or "").strip()
    result = dict(item)
    result["provider"] = provider
    result.setdefault("root", model)
    result.setdefault("parent", None)
    result.setdefault("permission", [])
    return result


def _empty_model_result() -> dict[str, Any]:
    return {"object": "list", "data": []}


def _fetch_chatgpt_models(OpenAIBackendAPI: type, access_token: str = "") -> dict[str, Any]:
    with OpenAIBackendAPI(access_token) as backend:
        return backend.list_models()


def _get_gpt_access_token() -> str:
    try:
        from services.account_service import account_service
        return account_service.get_text_access_token(provider=GPT_PROVIDER)
    except Exception:
        return ""


def _provider_has_active_accounts(provider: str) -> bool:
    try:
        from services.account_service import account_service
        accounts = account_service.list_accounts(provider)
        return any(str(acc.get("status") or "") != "禁用" for acc in accounts)
    except Exception:
        return False


def _has_any_accounts() -> bool:
    try:
        from services.account_service import account_service
        all_accounts = account_service.list_accounts()
        return len(all_accounts) > 0
    except Exception:
        return False


def list_models() -> dict[str, Any]:
    pool_has_accounts = _has_any_accounts()
    if pool_has_accounts:
        include_gpt = _provider_has_active_accounts(GPT_PROVIDER)
        include_grok = _provider_has_active_accounts(GROK_PROVIDER)
        include_gemini = _provider_has_active_accounts(GEMINI_PROVIDER)
    else:
        include_gpt = True
        include_grok = True
        include_gemini = True

    result = _empty_model_result()
    if include_gpt:
        try:
            from services.openai_backend_api import OpenAIBackendAPI
        except Exception:
            pass
        else:
            access_token = _get_gpt_access_token()
            if access_token:
                try:
                    result = _fetch_chatgpt_models(OpenAIBackendAPI, access_token)
                except Exception:
                    try:
                        result = _fetch_chatgpt_models(OpenAIBackendAPI)
                    except Exception:
                        result = _empty_model_result()
            else:
                try:
                    result = _fetch_chatgpt_models(OpenAIBackendAPI)
                except Exception:
                    result = _empty_model_result()

    data = result.get("data")
    if not isinstance(data, list):
        result = _empty_model_result()
        data = result["data"]

    normalized_data: list[dict[str, Any]] = []
    seen: set[str] = set()

    if include_gpt:
        for item in data:
            if isinstance(item, dict):
                _append_model(normalized_data, seen, _with_provider(item, GPT_PROVIDER))
        for item in gpt_fallback_model_metadata():
            _append_model(normalized_data, seen, item)
        for item in gpt_image_model_metadata():
            _append_model(normalized_data, seen, item)

    if include_grok:
        for item in grok_model_metadata():
            _append_model(normalized_data, seen, item)

    if include_gemini:
        for item in gemini_model_metadata():
            _append_model(normalized_data, seen, item)

    result["data"] = normalized_data
    return result

