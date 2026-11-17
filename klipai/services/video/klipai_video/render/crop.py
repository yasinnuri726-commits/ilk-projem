"""Akıllı kırpma: yüz izlerinden kırpma penceresi anahtar kareleri ve ffmpeg ifadeleri (saf fonksiyonlar).

Konuşan yüzün takibi: gerçek bir "aktif konuşmacı" modeli yerine, her örnek karede en büyük yüz seçilir ve
bir önceki hedefe yakın olan yüze süreklilik primi verilir. Tek/iki kişilik konuşma içeriklerinde bu,
kadrajı konuşanın üzerinde tutar; kalabalık sahnelerde merkezde kalmayı tercih eder.
"""
from __future__ import annotations

from typing import Any

MAX_KEYFRAMES = 40


def crop_window(src_w: int, src_h: int, out_w: int, out_h: int) -> tuple[int, int]:
    """Kaynağın içine sığan, hedef en-boy oranındaki en büyük pencere (çift sayıya yuvarlanır)."""
    target = out_w / out_h
    if src_w / src_h > target:
        h = src_h
        w = h * target
    else:
        w = src_w
        h = w / target
    return max(2, int(w) // 2 * 2), max(2, int(h) // 2 * 2)


def _primary(faces: list[dict[str, float]], prev: tuple[float, float] | None) -> tuple[float, float] | None:
    if not faces:
        return None

    def score(f: dict[str, float]) -> float:
        area = f["w"] * f["h"]
        cx, cy = f["x"] + f["w"] / 2, f["y"] + f["h"] / 2
        stick = 0.0 if prev is None else max(0.0, 1 - (abs(cx - prev[0]) + abs(cy - prev[1])) * 3)
        return area * (1 + 1.5 * stick) * f.get("score", 1.0)

    best = max(faces, key=score)
    return best["x"] + best["w"] / 2, best["y"] + best["h"] / 2


def face_keyframes(faces: dict[str, Any] | None, start: float, end: float, *, deadzone: float = 0.06, smooth: float = 0.35) -> list[dict[str, float]]:
    """Klip aralığı için [{t, x, y, scale}] (t klip başına göre; x,y hedef merkez, 0-1)."""
    frames = [f for f in (faces or {}).get("frames", []) if start <= f["t"] <= end]
    if not frames:
        return [{"t": 0.0, "x": 0.5, "y": 0.5, "scale": 1.0}]
    # İlk bulunan yüz başlangıç hedefidir: kadraj merkezden yüze "kaymaz", doğrudan yüzde açılır.
    first = next((_primary(f["faces"], None) for f in frames if f["faces"]), None)
    current = first or (0.5, 0.45)
    target = first
    raw: list[tuple[float, float, float]] = [(0.0, current[0], current[1])]
    for f in frames:
        found = _primary(f["faces"], target)
        if found:
            target = found
            # Ölü bölge: küçük baş hareketlerinde kadraj oynamaz; büyük harekette yumuşakça izler.
            if abs(found[0] - current[0]) > deadzone or abs(found[1] - current[1]) > deadzone:
                current = (current[0] + (found[0] - current[0]) * smooth, current[1] + (found[1] - current[1]) * smooth)
        if f["t"] - start > 0:
            raw.append((f["t"] - start, current[0], current[1]))
    return simplify([{"t": round(max(0.0, t), 3), "x": round(x, 4), "y": round(y, 4), "scale": 1.0} for t, x, y in raw])


def simplify(kfs: list[dict[str, float]], eps: float = 0.01, limit: int = MAX_KEYFRAMES) -> list[dict[str, float]]:
    """Doğrusal ara değerle yeniden üretilebilen anahtar kareleri atar; sayı sınırı aşılırsa eşiği büyütür."""
    if len(kfs) <= 2:
        return kfs

    def reduce(points: list[dict[str, float]], e: float) -> list[dict[str, float]]:
        out = [points[0]]
        for i in range(1, len(points) - 1):
            a, b, c = out[-1], points[i], points[i + 1]
            r = (b["t"] - a["t"]) / (c["t"] - a["t"]) if c["t"] > a["t"] else 0
            if any(abs(b[k] - (a[k] + (c[k] - a[k]) * r)) > e for k in ("x", "y", "scale")):
                out.append(b)
        out.append(points[-1])
        return out

    res = reduce(kfs, eps)
    while len(res) > limit:
        eps *= 1.6
        res = reduce(kfs, eps)
    return res


def piecewise(points: list[tuple[float, float]]) -> str:
    """(t, değer) noktalarından parçalı doğrusal ffmpeg ifadesi. İlk noktadan önce ve son noktadan sonra sabit."""
    pts = sorted(points)
    if not pts:
        return "0"
    if len(pts) == 1:
        return f"{pts[0][1]:.4f}"
    expr = f"{pts[-1][1]:.4f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(pts, pts[1:]))):
        seg = f"{v0:.4f}" if abs(v1 - v0) < 1e-6 or t1 <= t0 else f"{v0:.4f}+({v1 - v0:.4f})*(t-{t0:.3f})/{t1 - t0:.3f}"
        expr = f"if(lt(t,{t1:.3f}),{seg},{expr})"
    return f"if(lt(t,{pts[0][0]:.3f}),{pts[0][1]:.4f},{expr})"


def crop_exprs(kfs: list[dict[str, float]], src_w: int, src_h: int, cw: int, ch: int) -> tuple[str, str]:
    """Anahtar karelerden kırpma penceresinin sol-üst köşe ifadeleri (kaynak pikseli; kenarlara sıkıştırılmış)."""
    def clampf(v: float, hi: float) -> float:
        return max(0.0, min(hi, v))

    xs = [(k["t"], clampf(k["x"] * src_w - cw / 2, src_w - cw)) for k in kfs]
    # Yüz, pencerenin tam ortasında değil biraz üstünde durur (altyazıya yer kalır).
    ys = [(k["t"], clampf(k["y"] * src_h - ch * 0.42, src_h - ch)) for k in kfs]
    return piecewise(xs), piecewise(ys)


def zoom_expr(effects: list[dict[str, Any]], kfs: list[dict[str, float]]) -> str:
    """Zoom çarpanı ifadesi (>= 1). Anahtar karelerdeki `scale` ile efekt darbelerinin çarpımı."""
    terms: list[str] = []
    for e in effects:
        a, d, k = float(e["at"]), float(e.get("durationSec", 0.6)), float(e.get("intensity", 0.12))
        if e["type"] == "ZOOM_IN":  # hızlı gir, tut, yumuşak çık
            terms.append(f"{k:.3f}*clip((t-{a:.3f})/0.15,0,1)*clip(({a + d + 0.25:.3f}-t)/0.25,0,1)")
        elif e["type"] == "ZOOM_OUT":  # yakından başla, geri açıl
            terms.append(f"{k:.3f}*gte(t,{a:.3f})*clip(1-(t-{a:.3f})/{max(d, 0.1):.3f},0,1)")
    base = piecewise([(k["t"], k.get("scale", 1.0)) for k in kfs]) if any(abs(k.get("scale", 1.0) - 1) > 1e-3 for k in kfs) else "1"
    return f"({base})*(1+{'+'.join(terms)})" if terms else f"({base})"


def auto_effects(energy: dict[str, Any] | None, scenes: list[float], start: float, end: float, *, every: float = 6.0) -> list[dict[str, Any]]:
    """Otomatik efektler: açılışta bir vuruş ve her ~6 saniyelik bölmede ses enerjisinin tepe yaptığı anda hafif zoom."""
    dur = end - start
    out: list[dict[str, Any]] = [{"type": "ZOOM_OUT", "at": 0.0, "durationSec": 0.8, "intensity": 0.08}]
    rms = (energy or {}).get("rms") or []
    hop = (energy or {}).get("hop", 0.5)
    t = every / 2
    while t + 1.5 < dur and rms:
        lo, hi = int((start + t) / hop), int((start + min(dur, t + every)) / hop)
        seg = rms[lo:hi]
        if seg:
            peak = lo + max(range(len(seg)), key=seg.__getitem__)
            at = peak * hop - start
            # Sahne kesimine çok yakın zoom kesimle çakışıp rahatsız eder.
            if 1.0 < at < dur - 1.5 and all(abs((c - start) - at) > 0.5 for c in scenes):
                out.append({"type": "ZOOM_IN", "at": round(at, 2), "durationSec": 0.7, "intensity": 0.10})
        t += every
    return out
