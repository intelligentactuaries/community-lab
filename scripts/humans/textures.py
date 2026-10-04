# Texture work for the people's kit: the skin maps (relative colour for light
# and dark skin, so any skin tone can be painted over them), the face fields
# (where scalp hair, beard and age show), and atlases for hair, brows, lashes,
# eyes and clothes. Pillow + numpy.
import numpy as np
from PIL import Image, ImageDraw

import mh


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def load(path, size=None, mode='RGB'):
    im = Image.open(path).convert(mode)
    if size and im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64) / 255.0


def blur(a, r):
    """Gaussian blur of a float image (H, W) or (H, W, C), per channel."""
    if a.ndim == 2:
        return _blur1(a, r)
    return np.stack([_blur1(a[..., c], r) for c in range(a.shape[2])], axis=-1)


def _blur1(a, r):
    """Gaussian blur (sigma r texels) by FFT, the edges extended."""
    a = np.asarray(a, dtype=np.float64)
    if r <= 0:
        return a.copy()
    pad = int(3 * r) + 1
    p = np.pad(a, pad, mode='edge')
    h, w = p.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * r) ** 2 * (fx ** 2 + fy ** 2))
    out = np.fft.irfft2(np.fft.rfft2(p) * g, s=p.shape)
    return out[pad:pad + a.shape[0], pad:pad + a.shape[1]]


def normalized_blur(a, w, r):
    """Blur of a where weight w, ignoring the rest (normalized convolution)."""
    num = blur(a * (w[..., None] if a.ndim == 3 else w), r)
    den = blur(w, r)
    den = np.maximum(den, 1e-6)
    return num / (den[..., None] if a.ndim == 3 else den)


def inpaint(img, hole, radii=(64, 32, 16, 8, 4)):
    """Fill the hole (bool mask) from its surroundings, coarse to fine."""
    out = img.copy()
    known = (~hole).astype(np.float64)
    fill = normalized_blur(img, known, radii[0])
    out[hole] = fill[hole]
    for r in radii[1:]:
        f = normalized_blur(out, np.ones_like(known) * 0.25 + known * 0.75, r)
        out[hole] = f[hole]
    return out


def uv_mask(obj, faces, size):
    """Which texels the faces' texture coordinates cover (bool, image rows top to bottom)."""
    im = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(im)
    for f in faces:
        pts = [(obj.vt[t][0] * size, (1 - obj.vt[t][1]) * size) for t in obj.ft[f]]
        d.polygon(pts, fill=255)
    return np.asarray(im) > 127


def dilate_colors(rgb, known, r=4):
    """Spread colours outward from the known texels (so mipmaps and filtering do not pull in the background)."""
    out = rgb.copy()
    k = known.copy()
    for _ in range(r):
        grown = normalized_blur(out, k.astype(np.float64), 1.5)
        k2 = blur(k.astype(np.float64), 1.5) > 0.05
        new = k2 & ~k
        out[new] = grown[new]
        k = k | k2
    out[~k] = normalized_blur(out, k.astype(np.float64), 24)[~k]
    return out


def save_rgb(a, path, quality=92):
    im = Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8), 'RGB')
    if path.endswith('.jpg'):
        im.save(path, quality=quality, optimize=True)
    else:
        im.save(path, optimize=True)


def save_rgba(a, path):
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)


class Atlas:
    """Images packed into a grid of equal cells; uv() maps a placed image's own uvs into the atlas."""

    def __init__(self, width, height, channels=4, fill=(0.5, 0.5, 0.5, 0.0)):
        self.w = width
        self.h = height
        self.img = np.zeros((height, width, channels))
        self.img[:] = fill[:channels]
        self.rects = {}

    def put(self, key, img, x, y):
        h, w = img.shape[:2]
        self.img[y:y + h, x:x + w, :img.shape[2]] = img
        self.rects[key] = (x, y, w, h)

    def uv(self, key, uv):
        x, y, w, h = self.rects[key]
        u = (x + uv[:, 0] * w) / self.w
        v = 1 - (y + (1 - uv[:, 1]) * h) / self.h
        return np.stack([u, v], axis=1)


def raster_values(obj, faces, values, size):
    """Per-vertex values (by base vertex index) interpolated over the faces' texture coordinates: (size, size) image
    (rows top to bottom), and the coverage mask."""
    out = np.zeros((size, size))
    cov = np.zeros((size, size), dtype=bool)
    for f in faces:
        vs = obj.fv[f]
        ts = obj.ft[f]
        for k in range(1, len(vs) - 1):
            tri = (0, k, k + 1)
            P = np.array([[obj.vt[ts[i]][0] * size, (1 - obj.vt[ts[i]][1]) * size] for i in tri])
            val = np.array([values[vs[i]] for i in tri])
            x0 = max(int(np.floor(P[:, 0].min())), 0)
            x1 = min(int(np.ceil(P[:, 0].max())), size - 1)
            y0 = max(int(np.floor(P[:, 1].min())), 0)
            y1 = min(int(np.ceil(P[:, 1].max())), size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = P
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
            if not inside.any():
                continue
            v = l1 * val[0] + l2 * val[1] + l3 * val[2]
            sub = out[y0:y1 + 1, x0:x1 + 1]
            sub[inside] = v[inside]
            cov[y0:y1 + 1, x0:x1 + 1] |= inside
    return out, cov


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lum(a):
    return (a[..., :3] * np.array([0.2126, 0.7152, 0.0722])).sum(-1)


def opening(mask, r):
    """Remove specks smaller than about r texels, keep the rest's shape."""
    m = blur(mask.astype(np.float64), r) > 0.5
    return blur(m.astype(np.float64), r) > 0.15
