"""Kurgu: ffmpeg filtre grafiği kurulumu (görüntü + ses) ve yardımcı çıktılar."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import ffmpeg
from ..core import settings
from . import crop

TARGET_LUFS = -14.0


@dataclass
class RenderPlan:
    source: str  # yerel yol ya da imzalı URL
    start: float
    duration: float
    src_w: int
    src_h: int
    out_w: int
    out_h: int
    keyframes: list[dict[str, float]]
    effects: list[dict[str, Any]]
    ass_path: Path | None
    fonts_dir: str
    commentary: Path | None = None
    commentary_format: str = "NONE"
    music: Path | None = None
    music_db: float = -22.0
    ducking: bool = True
    logo: Path | None = None
    watermark_image: Path | None = None
    extra_inputs: list[str] = field(default_factory=list)


def _esc(path: Path | str) -> str:
    """Filtre argümanı içindeki yol için kaçış (':' ve '\\' özel karakterdir)."""
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def video_graph(p: RenderPlan, logo_idx: int | None, mark_idx: int | None) -> str:
    cw, ch = crop.crop_window(p.src_w, p.src_h, p.out_w, p.out_h)
    x, y = crop.crop_exprs(p.keyframes, p.src_w, p.src_h, cw, ch)
    z = crop.zoom_expr(p.effects, p.keyframes)
    chain = [
        f"[0:v]setpts=PTS-STARTPTS,crop={cw}:{ch}:x='{x}':y='{y}'",
        # Zoom: kare kare ölçeklenip ortadan çıkış boyutuna kırpılır (kırpma boyutu zamanla değişemediği için).
        f"scale=w='trunc({p.out_w}*{z}/2)*2':h='trunc({p.out_h}*{z}/2)*2':eval=frame:flags=bicubic",
        f"crop={p.out_w}:{p.out_h}",
        "setsar=1",
    ]
    for e in p.effects:
        if e["type"] == "FADE":
            d = float(e.get("durationSec", 0.4))
            chain.append(f"fade=t=in:st=0:d={d:.2f}" if float(e["at"]) < 0.05 else f"fade=t=out:st={float(e['at']):.2f}:d={d:.2f}")
    if p.ass_path:
        chain.append(f"ass='{_esc(p.ass_path)}':fontsdir='{_esc(p.fonts_dir)}'")
    graph = ",".join(chain) + "[v0]"
    last = "v0"
    if logo_idx is not None:  # logo: sol üst, genişliğin %14'ü
        graph += f";[{logo_idx}:v]scale={int(p.out_w * 0.14)}:-1[lg];[{last}][lg]overlay={int(p.out_w * 0.04)}:{int(p.out_h * 0.035)}[v1]"
        last = "v1"
    if mark_idx is not None:  # filigran görseli: sağ alt, yarı saydam
        graph += f";[{mark_idx}:v]scale={int(p.out_w * 0.18)}:-1,format=rgba,colorchannelmixer=aa=0.5[wm];[{last}][wm]overlay=W-w-{int(p.out_w * 0.04)}:H-h-{int(p.out_h * 0.04)}[v2]"
        last = "v2"
    return graph + f";[{last}]format=yuv420p[vout]"


def audio_graph(p: RenderPlan, com_idx: int | None, music_idx: int | None) -> str:
    """Kaynak ses + (yorum) + (müzik) → ducking → -14 LUFS.

    Yorum konuşurken kaynak ses kısılır (tepki formatında daha az, analiz/sıralamada daha çok);
    müzik, konuşmanın (kaynak + yorum) altında otomatik kısılır.
    """
    g = ["[0:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[src]"]
    voice = "src"
    if com_idx is not None:
        ratio = 6 if p.commentary_format == "REACTION" else 14
        g += [
            f"[{com_idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.5,asplit=2[com][comsc]",
            f"[src][comsc]sidechaincompress=threshold=0.015:ratio={ratio}:attack=15:release=350[srcd]",
            "[srcd][com]amix=inputs=2:normalize=0:duration=first[voice]",
        ]
        voice = "voice"
    if music_idx is not None:
        if p.ducking:
            g += [
                f"[{voice}]asplit=2[vmain][vsc]",
                f"[{music_idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={p.music_db:.1f}dB[mus]",
                "[mus][vsc]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=600[musd]",
                "[vmain][musd]amix=inputs=2:normalize=0:duration=first[mix]",
            ]
        else:
            g += [f"[{music_idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={p.music_db:.1f}dB[mus]", f"[{voice}][mus]amix=inputs=2:normalize=0:duration=first[mix]"]
        voice = "mix"
    g.append(f"[{voice}]loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11,aresample=48000[aout]")
    return ";".join(g)


def encoder_args(out_h: int, out_w: int) -> list[str]:
    enc = settings().video_encoder
    pixels = out_w * out_h
    bitrate = "35M" if pixels > 4_000_000 else "10M" if pixels > 1_500_000 else "5M"
    if enc == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate]
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", bitrate, "-bufsize", bitrate]


def build_command(p: RenderPlan, out: Path) -> list[str]:
    # -ss girişten önce: imzalı URL'de yalnızca gereken bayt aralığı indirilir.
    args = ["-ss", f"{p.start:.3f}", "-t", f"{p.duration:.3f}", "-i", p.source]
    idx = 1
    com_idx = music_idx = logo_idx = mark_idx = None
    if p.commentary:
        args += ["-i", str(p.commentary)]
        com_idx, idx = idx, idx + 1
    if p.music:
        args += ["-stream_loop", "-1", "-i", str(p.music)]
        music_idx, idx = idx, idx + 1
    if p.logo:
        args += ["-i", str(p.logo)]
        logo_idx, idx = idx, idx + 1
    if p.watermark_image:
        args += ["-i", str(p.watermark_image)]
        mark_idx, idx = idx, idx + 1
    graph = video_graph(p, logo_idx, mark_idx) + ";" + audio_graph(p, com_idx, music_idx)
    return [
        *args, "-filter_complex", graph, "-map", "[vout]", "-map", "[aout]", "-t", f"{p.duration:.3f}",
        *encoder_args(p.out_h, p.out_w), "-r", "30", "-g", "60", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(out),
    ]


def find_font(bold: bool = True) -> str | None:
    """drawtext için bir yazı tipi dosyası bulur."""
    root = Path(settings().font_dir)
    prefer = ["Montserrat-ExtraBold", "Montserrat-Bold", "Inter-Bold", "InterDisplay-Bold", "DejaVuSans-Bold", "NotoSans-Bold"] if bold else ["Inter-Regular", "DejaVuSans"]
    files = {f.stem: f for f in root.rglob("*") if f.suffix.lower() in (".ttf", ".otf")} if root.exists() else {}
    for name in prefer:
        if name in files:
            return str(files[name])
    return str(next(iter(files.values()))) if files else None


async def make_thumbnail(frame: Path, out: Path, text: str, width: int, height: int) -> Path:
    """Kapak görseli: kare + alt bölümde karartma + büyük başlık yazısı."""
    font = find_font()
    vf = [f"scale={width}:{height}:force_original_aspect_ratio=increase", f"crop={width}:{height}", "eq=contrast=1.08:saturation=1.15"]
    text = " ".join(text.split())
    if text and font:
        size = int(width * 0.11)
        max_chars = max(6, int(width * 0.9 / (size * 0.56)))
        lines: list[str] = []
        for word in text.upper().split(" "):
            if lines and len(lines[-1]) + 1 + len(word) <= max_chars:
                lines[-1] += " " + word
            else:
                lines.append(word)
        lines = lines[:3]
        textfile = out.with_suffix(".txt")
        textfile.write_text("\n".join(lines), encoding="utf-8")
        vf.append(f"drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.38:color=black@0.45:t=fill")
        vf.append(
            f"drawtext=fontfile='{_esc(font)}':textfile='{_esc(textfile)}':fontsize={size}:fontcolor=white:borderw={max(3, size // 14)}:bordercolor=black:"
            f"line_spacing={size // 6}:x=(w-text_w)/2:y=h*0.80-text_h/2"
        )
    await ffmpeg.run(["-i", str(frame), "-vf", ",".join(vf), "-frames:v", "1", "-q:v", "3", str(out)])
    return out


async def normalize_segment(src: Path, out: Path, width: int, height: int) -> Path:
    """Giriş/çıkış animasyonunu ana kliple aynı biçime getirir (birleştirme için)."""
    info = ffmpeg.media_info(await ffmpeg.probe(src))
    audio_in = ["-i", str(src)] if info["hasAudio"] else ["-i", str(src), "-f", "lavfi", "-t", f"{info['durationSec']:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    amap = "0:a:0" if info["hasAudio"] else "1:a:0"
    await ffmpeg.run([
        *audio_in, "-map", "0:v:0", "-map", amap,
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p",
        *encoder_args(height, width), "-r", "30", "-g", "60", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", str(out),
    ])
    return out


async def concat(parts: list[Path], out: Path) -> Path:
    """Aynı biçimdeki parçaları yeniden kodlayarak birleştirir (zaman damgası kayması olmaması için)."""
    args: list[str] = []
    for part in parts:
        args += ["-i", str(part)]
    n = len(parts)
    graph = "".join(f"[{i}:v][{i}:a]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
    info = ffmpeg.media_info(await ffmpeg.probe(parts[0]))
    await ffmpeg.run([*args, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", *encoder_args(info["height"], info["width"]), "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
    return out
