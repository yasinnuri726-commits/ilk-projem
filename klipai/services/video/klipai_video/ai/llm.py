"""LLM çağrıları (Anthropic SDK, yapılandırılmış çıktı) ve prompt şablonları."""
from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from ..core import Ctx, StageError, settings

T = TypeVar("T", bound=BaseModel)
PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


@lru_cache
def template(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def render(name: str, **values: object) -> str:
    """`{{anahtar}}` yer tutucularını doldurur. Eksik değer hata verir: sessizce boş prompt gönderilmez."""
    text = template(name)
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", "" if v is None else str(v))
    if "{{" in text:
        missing = text[text.index("{{"): text.index("}}", text.index("{{")) + 2]
        raise ValueError(f"{name}.md: doldurulmamış yer tutucu {missing}")
    return text


def split_prompt(text: str) -> tuple[str, str]:
    """Şablon `---USER---` satırıyla sistem ve kullanıcı bölümlerine ayrılır."""
    system, _, user = text.partition("\n---USER---\n")
    return system.strip(), user.strip()


@lru_cache
def _client():
    import anthropic

    return anthropic.Anthropic(max_retries=3, timeout=180)


def _parse_sync(system: str, user: str, schema: type[T], max_tokens: int) -> tuple[T, int, int]:
    import anthropic

    try:
        res = _client().messages.parse(
            model=settings().llm_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
        )
    except anthropic.RateLimitError as e:
        raise StageError("LLM_RATE_LIMITED", str(e)) from e
    except anthropic.APIConnectionError as e:
        raise StageError("LLM_UNREACHABLE", str(e)) from e
    except anthropic.APIStatusError as e:
        # 4xx (429 hariç) istek hatasıdır; yeniden denemek sonucu değiştirmez.
        raise StageError(f"LLM_HTTP_{e.status_code}", str(e)[:500], retryable=e.status_code >= 500) from e
    if res.stop_reason == "refusal":
        raise StageError("LLM_REFUSED", "Model bu içerik için yanıt üretmeyi reddetti", retryable=False)
    if res.stop_reason == "max_tokens" or res.parsed_output is None:
        raise StageError("LLM_TRUNCATED", "Model yanıtı tamamlanamadı")
    return res.parsed_output, res.usage.input_tokens, res.usage.output_tokens


async def parse(ctx: Ctx, prompt_name: str, schema: type[T], *, max_tokens: int = 8000, **values: object) -> T:
    """Şablonu doldurur, modeli çağırır, şemaya uyan nesneyi döner ve maliyeti kaydeder."""
    system, user = split_prompt(render(prompt_name, **values))
    out, tin, tout = await asyncio.to_thread(_parse_sync, system, user, schema, max_tokens)
    ctx.add_llm_usage(tin, tout)
    return out


LANGUAGE_NAMES = {"tr": "Turkish", "en": "English", "de": "German", "fr": "French", "es": "Spanish", "ar": "Arabic", "ru": "Russian", "it": "Italian", "pt": "Portuguese"}


def language_name(code: str | None) -> str:
    return LANGUAGE_NAMES.get((code or "tr").lower()[:2], code or "Turkish")
