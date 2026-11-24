#!/usr/bin/env python3
"""Polrware image enhancer: AI 2x upscale + gentle detail and clarity, transparency preserved.

  python3 tools/enhance.py IMAGE [IMAGE ...]      enhance files in place
  python3 tools/enhance.py --all                  enhance every product image in public/rack and public/gear
  python3 tools/enhance.py --all --dry-run        list what would change

Upscaling uses OpenCV's super-resolution networks (EDSR, falling back to FSRCNN, then Lanczos) with model
weights cached in ~/.cache/polrware-enhance/models. Images that are already large enough are only sharpened,
so running it twice never keeps doubling the size.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MODELS = Path.home() / '.cache' / 'polrware-enhance' / 'models'
TARGET = 900  # longest side we aim for: sharp on 2x screens at the sizes the site shows products
EXTS = {'.webp', '.png', '.jpg', '.jpeg'}
MANIFEST = ROOT / 'tools' / 'enhanced.json'  # fingerprints of files already enhanced, so a re-run skips them


def fingerprint(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


def load_manifest() -> dict:
    try:
        return json.loads(MANIFEST.read_text())
    except (OSError, ValueError):
        return {}

_sr = None


VENV_PY = Path.home() / '.cache' / 'polrware-enhance' / 'venv' / 'bin' / 'python'


def reexec_in_venv_if_needed():
    """The super-resolution wrapper lives in opencv-contrib; use the enhancer's own venv when this Python lacks it."""
    try:
        import cv2

        if hasattr(cv2, 'dnn_superres') and hasattr(cv2.dnn_superres, 'DnnSuperResImpl_create'):
            return
    except ImportError:
        pass
    venv_dir = VENV_PY.parent.parent
    if VENV_PY.exists() and Path(sys.prefix).resolve() != venv_dir.resolve():
        os.execv(str(VENV_PY), [str(VENV_PY), '-I', *sys.argv])


def upscaler():
    """Best available 2x super-resolution network: EDSR, then FSRCNN, then Lanczos resampling."""
    global _sr
    if _sr is not None:
        return _sr
    try:
        import cv2

        for name, file in (('edsr', 'EDSR_x2.pb'), ('fsrcnn', 'FSRCNN_x2.pb')):
            path = MODELS / file
            if path.exists():
                sr = cv2.dnn_superres.DnnSuperResImpl_create()
                sr.readModel(str(path))
                sr.setModel(name, 2)
                _sr = (name.upper(), sr)
                return _sr
    except Exception as exc:
        print(f'  (AI upscaler unavailable: {exc}; using Lanczos)', file=sys.stderr)
    _sr = ('Lanczos', None)
    return _sr


def upscale_rgb(rgb: np.ndarray) -> np.ndarray:
    name, sr = upscaler()
    h, w = rgb.shape[:2]
    if sr is None:
        return np.asarray(Image.fromarray(rgb).resize((w * 2, h * 2), Image.LANCZOS))
    import cv2

    return cv2.cvtColor(sr.upsample(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)), cv2.COLOR_BGR2RGB)


def bleed(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Spread edge colours into transparent pixels so upscaling doesn't pull a dark halo into the edges."""
    a = np.clip(np.nan_to_num(alpha.astype(np.float32) / 255), 0, 1)
    fill, out, known = rgb.astype(np.float32) * a[..., None], rgb.astype(np.float32), a > 0.98
    for r in (2, 4, 8, 16, 32):
        p = np.asarray(Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32)
        w = np.asarray(Image.fromarray((a * 255).round().astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
        est = p / np.maximum(w, 1e-3)[..., None]
        m = (~known) & (w > 0.02)
        out[m] = est[m]
        known |= m
    return np.clip(out, 0, 255).astype(np.uint8)


def enhance(img: Image.Image) -> Image.Image:
    has_alpha = img.mode in ('RGBA', 'LA', 'P') and 'A' in img.convert('RGBA').getbands()
    rgba = img.convert('RGBA')
    rgb = np.asarray(rgba.convert('RGB'))
    alpha = np.asarray(rgba.getchannel('A'))
    if has_alpha and alpha.min() < 250:
        rgb = bleed(rgb, alpha)
    if max(img.size) < TARGET * 0.75:
        rgb = upscale_rgb(rgb)
        alpha = np.asarray(Image.fromarray(alpha).resize((rgb.shape[1], rgb.shape[0]), Image.LANCZOS))
        # tighten the soft edge the resample leaves on the outline
        alpha = np.clip((alpha.astype(np.float32) - 128) * 1.35 + 128, 0, 255).astype(np.uint8)
    out = Image.fromarray(rgb)
    out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))  # fine detail
    out = out.filter(ImageFilter.UnsharpMask(radius=12, percent=10, threshold=0))  # gentle clarity
    if has_alpha:
        out = out.convert('RGBA')
        out.putalpha(Image.fromarray(alpha))
    return out


def save(img: Image.Image, path: Path):
    ext = path.suffix.lower()
    if ext == '.webp':
        img.save(path, 'WEBP', quality=88, method=6)
    elif ext in ('.jpg', '.jpeg'):
        img.convert('RGB').save(path, 'JPEG', quality=90)
    else:
        img.save(path, optimize=True)


def targets_all():
    files = []
    for folder in (ROOT / 'public' / 'rack', ROOT / 'public' / 'gear'):
        for p in sorted(folder.glob('*')):
            # masks and the wood texture are not product photos; masks are resized to match their photo instead
            if p.suffix.lower() in EXTS and not p.stem.endswith('-mask') and p.stem != 'wood':
                files.append(p)
    return files


def main():
    reexec_in_venv_if_needed()
    ap = argparse.ArgumentParser(description='Enhance product images: AI 2x upscale, detail and clarity.')
    ap.add_argument('images', nargs='*')
    ap.add_argument('--all', action='store_true', help='every product image in public/rack and public/gear')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--force', action='store_true', help='enhance again even if a file was already enhanced')
    ap.add_argument('--mark-done', action='store_true', help='record the given files as enhanced without changing them')
    args = ap.parse_args()
    files = targets_all() if args.all else [Path(p) for p in args.images]
    if not files:
        ap.error('give image paths or --all')
    manifest = load_manifest()
    key = lambda p: str(p.resolve().relative_to(ROOT)) if p.resolve().is_relative_to(ROOT) else str(p.resolve())
    if args.mark_done:
        for p in files:
            manifest[key(p)] = fingerprint(p)
        MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True))
        print(f'Recorded {len(files)} file(s) as enhanced.')
        return 0
    todo = [p for p in files if args.force or manifest.get(key(p)) != fingerprint(p)]
    if len(todo) < len(files):
        print(f'Skipping {len(files) - len(todo)} already enhanced (use --force to redo).')
    files = todo
    if not files:
        return 0
    name, _ = upscaler()
    print(f'Enhancer: {name} 2x upscale, {len(files)} image(s)')
    for p in files:
        img = Image.open(p)
        before = img.size
        if args.dry_run:
            print(f'  {p.name}: {before[0]}x{before[1]}' + (' -> 2x' if max(before) < TARGET * 0.75 else ' (sharpen only)'))
            continue
        out = enhance(img)
        save(out, p)
        mask = p.with_name(p.stem + '-mask.png')
        if mask.exists() and Image.open(mask).size != out.size:  # keep 3D outline masks the same size as their photo
            Image.open(mask).convert('L').resize(out.size, Image.LANCZOS).save(mask, optimize=True)
        manifest[key(p)] = fingerprint(p)
        MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True))
        print(f'  {p.name}: {before[0]}x{before[1]} -> {out.size[0]}x{out.size[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
