"""Saf fonksiyonların birim testleri: aday üretimi, kırpma, altyazı, yorum yerleşimi, kalite kontrol, imza."""
import hashlib
import hmac

import pytest

from klipai_video.ai import llm
from klipai_video.core import sign
from klipai_video.render import crop, subtitles
from klipai_video.stages import candidates, edit_qc, llm_stages


def make_words(n_sentences=40, words_per=8, word_dur=0.35, pause=0.9):
    words, t = [], 0.0
    for s in range(n_sentences):
        for i in range(words_per):
            text = f"k{s}_{i}" + ("." if i == words_per - 1 else "")
            words.append({"w": text, "s": round(t, 3), "e": round(t + word_dur - 0.05, 3), "spk": "S1"})
            t += word_dur
        t += pause
    return words


# ───────────── Aday üretimi ─────────────
def test_split_sentences_on_punctuation_and_pause():
    words = [{"w": "Merhaba", "s": 0, "e": 0.4}, {"w": "dünya.", "s": 0.5, "e": 0.9}, {"w": "Evet", "s": 1.0, "e": 1.3}, {"w": "tamam", "s": 2.5, "e": 2.9}]
    s = candidates.split_sentences(words)
    assert [x.text for x in s] == ["Merhaba dünya.", "Evet", "tamam"]
    assert s[1].gap_after == pytest.approx(1.2)


def test_candidates_respect_duration_and_sentence_boundaries():
    words = make_words()
    duration = words[-1]["e"] + 1
    out = candidates.generate(words, scenes=[30.0, 61.0], energy={"hop": 0.5, "rms": [0.1] * int(duration * 2)}, faces=None, min_sec=15, max_sec=45, max_candidates=10, duration=duration)
    assert 1 <= len(out) <= 10
    starts = {w["s"] for w in words if w["w"].endswith("_0")}
    ends = {w["e"] for w in words if w["w"].endswith(".")}
    for c in out:
        # Dolgu payı dışında süre aralıkta kalır.
        assert 15 <= c["endSec"] - c["startSec"] <= 45 + candidates.PAD_START + candidates.PAD_END
        # Başlangıç bir cümlenin ilk kelimesinden hemen önce, bitiş bir cümle sonundan hemen sonradır.
        assert any(0 <= s - c["startSec"] <= candidates.PAD_START + 1e-6 for s in starts)
        assert any(0 <= c["endSec"] - e <= candidates.PAD_END + 1e-6 for e in ends)
        assert c["text"].endswith(".")
    # Çakışan adaylar elenmiştir.
    for i, a in enumerate(out):
        for b in out[i + 1:]:
            assert candidates.iou((a["startSec"], a["endSec"]), (b["startSec"], b["endSec"])) < 0.45


def test_candidates_prefer_energetic_region():
    words = make_words(n_sentences=60)
    duration = words[-1]["e"] + 1
    rms = [0.02] * int(duration * 2)
    for i in range(200, 280):  # 100-140. saniyeler yüksek enerjili
        rms[i] = 0.5
    out = candidates.generate(words, [], {"hop": 0.5, "rms": rms}, None, min_sec=20, max_sec=40, max_candidates=1, duration=duration)
    assert 90 <= out[0]["startSec"] <= 140


def test_no_candidates_when_speech_too_short():
    assert candidates.generate(make_words(n_sentences=2), [], None, None, min_sec=20, max_sec=60, max_candidates=5, duration=10) == []


# ───────────── Kırpma ─────────────
def test_crop_window_keeps_aspect_inside_source():
    assert crop.crop_window(1920, 1080, 1080, 1920) == (606, 1080)
    assert crop.crop_window(1080, 1920, 1920, 1080) == (1080, 606)
    assert crop.crop_window(1920, 1080, 1080, 1080) == (1080, 1080)


def test_piecewise_expression_shape():
    assert crop.piecewise([]) == "0"
    assert crop.piecewise([(0, 5)]) == "5.0000"
    e = crop.piecewise([(0, 0), (2, 10), (4, 10)])
    assert e.startswith("if(lt(t,0.000),0.0000,if(lt(t,2.000),") and e.count("if(") == 3 and e.count("(") == e.count(")")


def test_face_keyframes_follow_moving_face_and_ignore_jitter():
    frames = [{"t": t / 2, "faces": [{"x": 0.2 + 0.001 * (t % 2), "y": 0.3, "w": 0.1, "h": 0.2, "score": 0.9}]} for t in range(0, 20)]
    frames += [{"t": t / 2, "faces": [{"x": 0.7, "y": 0.3, "w": 0.1, "h": 0.2, "score": 0.9}]} for t in range(20, 40)]
    kfs = crop.face_keyframes({"frames": frames}, 0, 20)
    assert kfs[0]["x"] == pytest.approx(0.25, abs=0.01)  # doğrudan yüzde açılır
    assert kfs[-1]["x"] == pytest.approx(0.75, abs=0.08)  # ölü bölge nedeniyle hedefe yakın bir noktada durur
    assert kfs[-1]["x"] > 0.6
    assert len(kfs) <= crop.MAX_KEYFRAMES
    # Titreme (±0.001) anahtar kare üretmez: ilk 10 saniyede kadraj sabittir.
    assert all(abs(k["x"] - kfs[0]["x"]) < 1e-6 for k in kfs if k["t"] < 9.5)


def test_face_keyframes_without_faces_center():
    assert crop.face_keyframes(None, 0, 10) == [{"t": 0.0, "x": 0.5, "y": 0.5, "scale": 1.0}]


def test_crop_exprs_clamped_to_source():
    x, y = crop.crop_exprs([{"t": 0, "x": 0.0, "y": 0.0, "scale": 1}, {"t": 5, "x": 1.0, "y": 1.0, "scale": 1}], 1920, 1080, 606, 1080)
    assert "0.0000" in x and "1314.0000" in x  # 1920 - 606
    assert y == "if(lt(t,0.000),0.0000,if(lt(t,5.000),0.0000,0.0000))"


def test_zoom_expr_and_auto_effects():
    assert crop.zoom_expr([], [{"t": 0, "x": 0.5, "y": 0.5, "scale": 1.0}]) == "(1)"
    z = crop.zoom_expr([{"type": "ZOOM_IN", "at": 2, "durationSec": 0.5, "intensity": 0.1}], [{"t": 0, "x": 0.5, "y": 0.5, "scale": 1.0}])
    assert z.startswith("(1)*(1+0.100*clip(")
    fx = crop.auto_effects({"hop": 0.5, "rms": [0.1] * 20 + [0.9] + [0.1] * 60}, [], 0, 30)
    assert fx[0]["type"] == "ZOOM_OUT" and any(e["type"] == "ZOOM_IN" and abs(e["at"] - 10) < 0.01 for e in fx)


# ───────────── Altyazı ─────────────
def test_ass_time_and_color():
    assert subtitles.ass_time(0) == "0:00:00.00"
    assert subtitles.ass_time(3661.239) == "1:01:01.24"
    assert subtitles.ass_color("#FFD400") == "&H0000D4FF"


def test_group_words_limits():
    words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "text": t} for i, t in enumerate(["bir", "iki", "üç", "dört", "beş."])]
    words.append({"start": 3.0, "end": 3.3, "text": "altı"})
    groups = subtitles.group_words(words, 72, 1080)
    assert [len(g) for g in groups] == [3, 2, 1]


def test_build_ass_highlights_each_word_and_adds_hook_and_watermark():
    words = [{"start": 0.0, "end": 0.4, "text": "Merhaba"}, {"start": 0.4, "end": 0.9, "text": "{dünya}"}]
    doc = subtitles.build_ass(words, width=1080, height=1920, duration=5, style={"fontSize": 72, "highlightColor": "#FFD400", "position": "BOTTOM"}, hook={"text": "Bunu bekleme", "durationSec": 2}, watermark="KlipAI")
    lines = [l for l in doc.splitlines() if l.startswith("Dialogue")]
    assert sum(",Sub," in l for l in lines) == 2 and sum(",Hook," in l for l in lines) == 1 and sum(",Mark," in l for l in lines) == 1
    assert "{\\c&H00D4FF&\\fscx108\\fscy108}Merhaba" in lines[2]
    assert "(dünya)" in doc and "{dünya}" not in doc  # süslü parantez ASS etiketi sanılmasın
    assert "PlayResX: 1080" in doc


def test_overflow_and_shrink():
    long = "A" * 40
    assert subtitles.overflow_report([{"text": long}], 72, 1080) == [long]
    doc = subtitles.build_ass([{"start": 0, "end": 1, "text": long}], width=1080, height=1920, duration=2, style={})
    assert "\\fs" in doc.split("[Events]")[1]


def test_retime_translation_spreads_duration():
    out = subtitles.retime_translation([{"start": 1.0, "end": 3.0}], ["ab cdef"])
    assert out[0] == {"start": 1.0, "end": pytest.approx(1.667, abs=0.01), "text": "ab"}
    assert out[1]["end"] == pytest.approx(3.0)


# ───────────── Yorum / meta veri ─────────────
def test_script_round_trip_and_layout():
    lines = llm_stages.script_to_lines("[4.5] ikinci\nzaman yok\n\n[1] birinci")
    assert [l["at"] for l in lines] == [0.0, 1.0, 4.5]
    placed = llm_stages.layout_lines(lines, [2.0, 2.0, 3.0], clip_duration=9.0)
    assert [p["at"] for p in placed] == [0.0, 2.3, 4.6]  # üst üste binmez (2 sn + 0.3 sn boşluk)
    pulled = llm_stages.layout_lines([{"at": 8.5, "text": "geç"}], [2.0], clip_duration=9.0)
    assert pulled[0]["at"] == 7.0  # sona sığmayan satır geri çekilir
    assert llm_stages.script_to_lines(llm_stages.lines_to_script(placed))[1]["text"] == "birinci"
    assert llm_stages.layout_lines([{"at": 0, "text": "x"}], [20.0], clip_duration=10) == []


def test_clip_words_are_relative():
    w = llm_stages.clip_words([{"w": "a", "s": 9.8, "e": 10.2}, {"w": "b", "s": 12, "e": 12.5}, {"w": "c", "s": 30, "e": 31}], 10, 20)
    assert [(x["w"], x["s"]) for x in w] == [("a", 0.0), ("b", 2.0)]


def test_tag_cleanup():
    assert llm_stages.clean_tag("  #Komik,  Anlar ") == "komik anlar"
    assert llm_stages.clean_hashtag("#kısa video!") == "kısavideo"


def test_all_prompts_render_without_leftover_placeholders():
    common = dict(tone="t", max_sec="10", words_per_sec=2.3, max_words=23, language="Turkish", custom_block="", clip_duration="30.0", video_title="v", transcript="x")
    for name in ("commentary_reaction", "commentary_analysis", "commentary_ranking"):
        system, user = llm.split_prompt(llm.render(name, **common))
        assert system and user
    assert llm.render("score", language="Turkish", video_title="v", channel_title="c", insights_block=llm.render("learning", insights="- x"), excerpts="e")
    assert llm.render("metadata", title_language="Turkish", video_title="v", channel_title="c", hook_text="h", commentary="c", fixed_tags="a", insights_block="", instruction_block="", transcript="x")
    assert llm.render("translate", target_language="English", source_language="Turkish", lines="1. x")
    with pytest.raises(ValueError):
        llm.render("translate", target_language="English")


def test_score_mapping_matches_api_contract():
    s = llm_stages.CandidateScore(id="c1", hook=80, emotion=70, standalone=60, curiosity=50, shareability=40, summary="s",
                                  reasons=llm_stages.Reasons(hook="a", emotion="b", standalone="c", curiosity="d", shareability="e"), suggested_hook="Bak şuna", risks=[])
    out = llm_stages.to_api_score(s)
    assert {k: out[k] for k in ("hook", "emotion", "standalone", "curiosity", "shareability")} == {"hook": 80, "emotion": 70, "standalone": 60, "curiosity": 50, "shareability": 40}
    assert out["rationale"]["suggestedHook"] == "Bak şuna" and out["rationale"]["hook"] == "a"


# ───────────── Kalite kontrol ─────────────
def test_qc_evaluate():
    p = {"minDurationSec": 5, "maxDurationSec": 180, "width": 1080, "height": 1920}
    ok = edit_qc.evaluate({"durationSec": 30, "width": 1080, "height": 1920}, -14.3, [(0, 0.2)], [], p)
    assert all(i["passed"] for i in ok)
    bad = {i["check"]: i for i in edit_qc.evaluate({"durationSec": 200, "width": 720, "height": 1280}, -20.0, [(0, 30)], ["uzunkelime"], p)}
    assert not any(i["passed"] for i in bad.values())
    assert bad["LOUDNESS"]["fixable"] and not bad["DURATION"]["fixable"]


def test_pick_music_is_stable():
    keys = ["music/lofi/a.mp3", "music/lofi/b.mp3", "music/lofi/readme.txt"]
    assert edit_qc.pick_music(keys, "clip1") == edit_qc.pick_music(list(reversed(keys)), "clip1")
    assert edit_qc.pick_music([], "x") is None


# ───────────── Servis imzası ─────────────
def test_signature_format_matches_api_verifier():
    body, ts, secret = b'{"a":1}', "1700000000", "s" * 32
    assert sign(body, secret, ts) == "sha256=" + hmac.new(secret.encode(), b"1700000000." + body, hashlib.sha256).hexdigest()
