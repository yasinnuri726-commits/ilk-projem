"""Uçtan uca kurgu testi: sentetik bir kaynaktan gerçek ffmpeg ile 9:16 klip üretir ve çıktıyı ölçer."""
import shutil
import subprocess
from pathlib import Path

import pytest

from klipai_video import ffmpeg
from klipai_video.render import compose, crop, subtitles
from klipai_video.stages import edit_qc

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg yok")
FONTS = "/usr/share/fonts"


@pytest.fixture(scope="module")
def source(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("src") / "source.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=14", "-f", "lavfi", "-i", "sine=frequency=330:duration=14",
         "-af", "volume=0.05", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(out)], check=True)
    return out


async def test_render_vertical_clip_with_subtitles_effects_commentary_and_music(source: Path, tmp_path: Path):
    duration = 8.0
    words = [{"start": i * 0.5, "end": i * 0.5 + 0.4, "text": w} for i, w in enumerate("Bu bir deneme klibidir ve altyazılar kelime kelime akar".split())]
    ass = tmp_path / "subs.ass"
    ass.write_text(subtitles.build_ass(words, width=540, height=960, duration=duration, style={"fontFamily": "DejaVu Sans", "fontSize": 72}, hook={"text": "İlk iki saniye kanca", "durationSec": 2}, watermark="KlipAI"), encoding="utf-8")
    for name, freq in (("commentary.wav", 880), ("music.mp3", 220)):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=3", str(tmp_path / name)], check=True)

    faces = {"frames": [{"t": t / 2, "faces": [{"x": 0.6, "y": 0.3, "w": 0.12, "h": 0.2, "score": 0.9}]} for t in range(0, 40)]}
    plan = compose.RenderPlan(
        source=str(source), start=2.0, duration=duration, src_w=1280, src_h=720, out_w=540, out_h=960,
        keyframes=crop.face_keyframes(faces, 2.0, 10.0),
        effects=[{"type": "ZOOM_OUT", "at": 0, "durationSec": 0.8, "intensity": 0.08}, {"type": "ZOOM_IN", "at": 3, "durationSec": 0.6, "intensity": 0.1}, {"type": "FADE", "at": 7.5, "durationSec": 0.5}],
        ass_path=ass, fonts_dir=FONTS, commentary=tmp_path / "commentary.wav", commentary_format="REACTION", music=tmp_path / "music.mp3", music_db=-20,
    )
    out = tmp_path / "out.mp4"
    seen: list[float] = []

    async def progress(p: float) -> None:
        seen.append(p)

    await ffmpeg.run(compose.build_command(plan, out), duration=duration, on_progress=progress)

    info = ffmpeg.media_info(await ffmpeg.probe(out))
    assert (info["width"], info["height"]) == (540, 960)
    assert info["durationSec"] == pytest.approx(duration, abs=0.15)
    assert info["hasAudio"] and info["videoCodec"] == "h264"
    assert seen and max(seen) <= 99

    loud = await ffmpeg.measure_loudness(out)
    assert abs(loud["i"] - compose.TARGET_LUFS) < 2.0  # tek geçiş loudnorm; kalan fark kalite kontrolde düzeltilir

    # Kalite kontrol raporu bu çıktıyı geçirir (süre, çözünürlük, siyah kare).
    report = {i["check"]: i for i in edit_qc.evaluate(info, loud["i"], await ffmpeg.detect_black(out), [], {"minDurationSec": 5, "maxDurationSec": 180, "width": 540, "height": 960})}
    assert report["DURATION"]["passed"] and report["RESOLUTION"]["passed"] and report["BLACK_FRAMES"]["passed"]

    # Kapak görseli
    frame = tmp_path / "frame.jpg"
    await ffmpeg.run(["-ss", "3", "-i", str(out), "-frames:v", "1", str(frame)])
    thumb = await compose.make_thumbnail(frame, tmp_path / "thumb.jpg", "Bunu kimse beklemiyordu", 540, 960)
    assert thumb.stat().st_size > 5000


async def test_probe_rejects_non_media(tmp_path: Path):
    bad = tmp_path / "x.mp4"
    bad.write_text("video değil")
    with pytest.raises(Exception) as e:
        await ffmpeg.probe(bad)
    assert getattr(e.value, "code", "") == "UNSUPPORTED_MEDIA"
