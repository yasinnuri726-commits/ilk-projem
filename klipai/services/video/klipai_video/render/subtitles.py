"""Kelime kelime animasyonlu altyazı (ASS), kanca yazısı ve filigran (saf fonksiyonlar)."""
from __future__ import annotations

from typing import Any

REF_WIDTH = 1080  # yazı boyutları 1080 px genişliğe göre tanımlanır
CHAR_WIDTH = 0.56  # kalın sans yazı tipinde ortalama karakter genişliği / punto
MAX_LINE_FRACTION = 0.86


def ass_time(t: float) -> str:
    cs = max(0, round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB → &HAABBGGRR."""
    h = hex_color.lstrip("#")
    return f"&H{alpha:02X}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def escape(text: str) -> str:
    return text.replace("\\", "⧵").replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def text_width(text: str, font_px: float) -> float:
    return len(text) * font_px * CHAR_WIDTH


def group_words(words: list[dict[str, Any]], font_px: float, width: int, *, max_words: int = 3, max_gap: float = 0.45) -> list[list[dict[str, Any]]]:
    """Kelimeleri ekranda birlikte görünecek kümelere böler: en çok 3 kelime, satıra sığacak kadar,
    duraklama veya cümle sonunda yeni küme."""
    limit = width * MAX_LINE_FRACTION
    groups: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    for w in words:
        candidate = " ".join(x["text"] for x in cur + [w])
        gap = w["start"] - cur[-1]["end"] if cur else 0.0
        ended = bool(cur) and cur[-1]["text"].rstrip().endswith((".", "!", "?", "…"))
        if cur and (len(cur) >= max_words or text_width(candidate, font_px) > limit or gap > max_gap or ended):
            groups.append(cur)
            cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def overflow_report(words: list[dict[str, Any]], font_px: float, width: int) -> list[str]:
    """Tek başına bile satıra sığmayan kelimeler (kalite kontrol için)."""
    return [w["text"] for w in words if text_width(w["text"], font_px * 1.08) > width * MAX_LINE_FRACTION]


def build_ass(
    words: list[dict[str, Any]],
    *,
    width: int,
    height: int,
    duration: float,
    style: dict[str, Any],
    hook: dict[str, Any] | None = None,
    watermark: str | None = None,
) -> str:
    """ASS belgesi üretir.

    Her kelime için bir satır yazılır: küme görünür kalır, o an söylenen kelime vurgu rengiyle ve hafif büyüyerek gösterilir.
    """
    k = width / REF_WIDTH
    font_px = float(style.get("fontSize", 72)) * k
    font = style.get("fontFamily", "Montserrat")
    primary = ass_color(style.get("color", "#FFFFFF"))
    highlight = ass_color(style.get("highlightColor", "#FFD400"))
    position = style.get("position", "BOTTOM")
    align = {"TOP": 8, "MIDDLE": 5, "BOTTOM": 2}[position]
    # Alt konumda Shorts arayüzü (başlık, düğmeler) için güvenli pay bırakılır.
    margin_v = int(height * (0.20 if position == "BOTTOM" else 0.12 if position == "TOP" else 0))
    outline = max(2, round(font_px * 0.07))

    head = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Sub,{font},{font_px:.0f},{primary},{primary},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline},{max(1, outline // 2)},{align},{int(width * 0.06)},{int(width * 0.06)},{margin_v},1",
        f"Style: Hook,{font},{font_px * 0.92:.0f},&H00FFFFFF,&H00FFFFFF,&H00000000,&HE6000000,-1,0,0,0,100,100,0,0,3,{max(6, round(font_px * 0.22))},0,8,{int(width * 0.08)},{int(width * 0.08)},{int(height * 0.11)},1",
        f"Style: Mark,{font},{font_px * 0.42:.0f},&H80FFFFFF,&H80FFFFFF,&HB0000000,&H00000000,-1,0,0,0,100,100,0,0,1,{max(1, outline // 3)},0,9,{int(width * 0.04)},{int(width * 0.04)},{int(height * 0.035)},1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events: list[str] = []

    if watermark:
        events.append(f"Dialogue: 0,{ass_time(0)},{ass_time(duration)},Mark,,0,0,0,,{escape(watermark)}")

    hook_end = 0.0
    if hook and hook.get("text"):
        hook_end = min(duration, float(hook.get("durationSec", 2.0)))
        text = escape(hook["text"])
        # Uzun kanca iki satıra bölünür.
        if text_width(text, font_px * 0.92) > width * 0.8 and " " in text:
            parts = text.split(" ")
            mid = min(range(1, len(parts)), key=lambda i: abs(len(" ".join(parts[:i])) - len(" ".join(parts[i:]))))
            text = " ".join(parts[:mid]) + r"\N" + " ".join(parts[mid:])
        events.append(f"Dialogue: 2,{ass_time(0)},{ass_time(hook_end)},Hook,,0,0,0,,{{\\fad(120,180)}}{text}")

    clean = [{**w, "text": escape(w["text"])} for w in words if w.get("text", "").strip() and w["end"] > 0 and w["start"] < duration]
    for group in group_words(clean, font_px, width):
        # Küme satıra sığmıyorsa (tek uzun kelime) yazı o küme için küçültülür.
        need = text_width(" ".join(w["text"] for w in group), font_px * 1.04)
        shrink = min(1.0, width * MAX_LINE_FRACTION / need) if need else 1.0
        size_tag = f"\\fs{font_px * shrink:.0f}" if shrink < 0.999 else ""
        for i, w in enumerate(group):
            start = max(0.0, w["start"])
            end = group[i + 1]["start"] if i + 1 < len(group) else max(w["end"], start + 0.12)
            end = min(duration, end)
            if end <= start:
                continue
            parts = []
            for j, x in enumerate(group):
                if j == i:
                    parts.append(f"{{\\c{highlight[:2] + highlight[4:]}&\\fscx108\\fscy108}}{x['text']}{{\\c{primary[:2] + primary[4:]}&\\fscx100\\fscy100}}")
                else:
                    parts.append(x["text"])
            # Kanca görünürken üst konumdaki altyazı onunla çakışmasın diye bir alta alınır.
            pos = "{\\an5}" if position == "TOP" and start < hook_end else ""
            events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Sub,,0,0,0,,{pos}{{{size_tag}}}{' '.join(parts)}" if size_tag else f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Sub,,0,0,0,,{pos}{' '.join(parts)}")
    return "\n".join(head + events) + "\n"


def retime_translation(sentences: list[dict[str, Any]], translations: list[str]) -> list[dict[str, Any]]:
    """Çevrilmiş cümleleri kelimelere böler ve her kelimeye, cümlenin süresinden harf sayısıyla orantılı pay verir."""
    out: list[dict[str, Any]] = []
    for s, text in zip(sentences, translations):
        tokens = text.split()
        if not tokens:
            continue
        total = sum(len(t) for t in tokens)
        t = s["start"]
        for tok in tokens:
            d = (s["end"] - s["start"]) * len(tok) / total
            out.append({"start": round(t, 3), "end": round(t + d, 3), "text": tok})
            t += d
    return out
