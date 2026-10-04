# The skin maps. MakeHuman's skins are photographs painted over its texture
# layout, each for one skin colour (and with short hair painted on the
# scalp). The client paints any tone, so the kit keeps each photograph's
# colour relative to its own typical tone: skin_light (a young light-skinned
# woman's), skin_dark (a young dark-skinned woman's: lighter palms and soles,
# darker lips), the scalp cleared. The ratio is stored as log2 in 8 bits
# ((log2 r + 4) / 8), since a dark skin's palms are several times its tone. Men's stubble, the scalp's short hair and
# the fine lines of age are separate fields (fields.png):
#   R  hair on the scalp (1 inside the hairline, soft at its edge)
#   G  beard (1 on the jaw, chin and upper lip, fading up the cheeks)
#   B  age: the fine-line pattern of an old face relative to a young one (0.5 = none); on the scalp, the order
#      in which a receding hairline gives way
#   A  the grain of short hair (a close crop's curls), 0.5 = none
import os

import numpy as np

import mh
import textures as tx

N = 1024


def build_skin(out):
    b = mh.base()
    faces = [i for i, g in enumerate(b.fg) if g == b.groups['body']]
    used = tx.uv_mask(b, faces, N)
    uu = np.linspace(0, 1, N)[None, :].repeat(N, 0)
    vv = np.linspace(0, 1, N)[:, None].repeat(N, 1)  # rows, top to bottom
    head = (uu > 0.62) & used
    sk = os.path.join(mh.ASSETS, 'skins')

    def tex(name, file):
        return tx.srgb_to_lin(tx.load(os.path.join(sk, name, file), N))

    light = tex('young_caucasian_female', 'young_lightskinned_female_diffuse.png')
    dark = tex('young_african_female', 'young_darkskinned_female_diffuse.png')
    am = tex('young_african_male', 'young_darkskinned_male_diffuse.png')
    old = tex('old_caucasian_female', 'old_lightskinned_female_diffuse.png')

    # The painted hair: far darker than the face's own skin, on the head (the African skins show it plainly).
    def hair_of(t):
        L = tx.lum(t)
        ref = np.median(L[head & (uu > 0.8) & (vv > 0.4) & (vv < 0.6)])
        return tx.opening((L < ref * 0.55) & head, 5)

    hair = tx.opening(hair_of(am) | hair_of(dark), 9) & (vv < 0.86)
    hole = (tx.blur(hair.astype(np.float64), 4) > 0.08) & head
    field_hair = np.clip(tx.blur(hair.astype(np.float64), 3) * 1.15, 0, 1)

    def rel(t, name):
        t = tx.inpaint(t, hole)
        # Skin grain over the cleared scalp, borrowed from the forehead's texture, so it is not dead smooth.
        body = used & (uu < 0.6)
        tone = np.median(t[body], axis=0)
        r = t / tone
        r = tx.dilate_colors(r, used, 6)
        print(name, 'tone (linear)', np.round(tone, 4), 'rel range', np.round(r[used].min(0), 2), np.round(r[used].max(0), 2))
        return r, tone

    r_light, tone_light = rel(light, 'light')
    r_dark, tone_dark = rel(dark, 'dark')
    # Inside the mouth: in shadow when the jaw drops, not the bright red of the painted mouth bag.
    bag = []
    for f in faces:
        c = b.v[b.fv[f]].mean(0)
        uvc = np.mean([b.vt[t] for t in b.ft[f]], axis=0)
        if uvc[0] > 0.72 and uvc[1] < 0.16 and abs(c[0]) < 0.45 and 6.2 < c[1] < 7.05:
            bag.append(f)
    inside = tx.blur(tx.uv_mask(b, bag, N).astype(np.float64), 2)
    for r_ in (r_light, r_dark):
        r_ *= 1 - 0.85 * inside[..., None]
    enc = lambda r: np.clip((np.log2(np.maximum(r, 1 / 16)) + 4) / 8, 0, 1)
    tx.save_rgb(enc(r_light), os.path.join(out, 'skin_light.jpg'))
    tx.save_rgb(enc(r_dark), os.path.join(out, 'skin_dark.jpg'))

    # Beard: on the jaw, chin, upper lip and throat, not the lips; fading up the cheeks toward the sideburns.
    v = b.v
    x, y, z = np.abs(v[:, 0]), v[:, 1], v[:, 2]
    top = 6.93 + 0.22 * np.clip(x / 0.75, 0, 1) ** 2
    w = tx.smoothstep(top + 0.06, top - 0.1, y)
    w *= tx.smoothstep(0.35, 0.75, z + 0.35 * np.clip((7.0 - y) / 0.8, 0, 1))
    w *= tx.smoothstep(5.75, 6.05, y + 0.25 * np.clip(z - 0.6, 0, 1))
    lips = ((x / 0.34) ** 2 + ((y - 6.69) / np.where(y > 6.69, 0.12, 0.14)) ** 2 < 1) & (z > 1.3)
    w[lips] = 0
    # Sideburns up to the scalp in front of the ears.
    sb = tx.smoothstep(0.62, 0.52, np.abs(x - 0.62) + 0.0) * tx.smoothstep(7.35, 7.05, y) * tx.smoothstep(6.9, 7.0, y) * tx.smoothstep(0.35, 0.6, z) * tx.smoothstep(1.0, 0.8, z)
    w = np.maximum(w, sb)
    beard, cov = tx.raster_values(b, faces, w, N)
    # (not inside the mouth: its texture sits at the bottom of the head's layout)
    beard = tx.blur(beard, 2) * head * (vv < 0.86)

    # Age: an old face's fine texture relative to a young one's (high-pass of each), where the face is.
    def hp(t):
        L = tx.lum(t)
        return L / np.maximum(tx.blur(L, 6), 1e-4)

    age = np.clip(hp(tx.inpaint(old, hole)) / np.maximum(hp(tx.inpaint(light, hole)), 0.2), 0.4, 1.6)
    age = np.where(used, age, 1.0)
    # On the scalp B holds instead the order in which hair goes as a man's hairline recedes: the temples and the
    # front first, then the crown, the top joining them; the sides and back last (0 keeps longest, 1 goes first).
    front = np.clip((z - 0.25) / 1.1, 0, 1) * tx.smoothstep(7.55, 8.1, y)
    temples = tx.smoothstep(0.35, 0.75, x) * np.clip((z - 0.4) / 0.9, 0, 1) * tx.smoothstep(7.4, 7.9, y)
    crown = tx.smoothstep(8.05, 8.45, y) * (1 - np.clip(np.abs(z - 0.25) / 0.9, 0, 1))
    bald_v = np.clip(np.maximum(np.maximum(front, temples * 1.1), crown * 0.8), 0, 0.95)
    bald, _ = tx.raster_values(b, faces, bald_v, N)
    bald = tx.blur(bald, 2)
    scalp = tx.blur(hair.astype(np.float64), 4) > 0.02
    ageB = np.where(scalp, bald * 2.0, age)
    # The grain of short hair: the painted crop's curls (high-pass), where the hair is.
    L = tx.lum(am)
    grain = np.clip(L / np.maximum(tx.blur(L, 2.5), 1e-4), 0, 2)
    grain = np.where(hair, grain, 1.0)
    fields = np.stack([field_hair, np.clip(beard, 0, 1), np.clip(ageB * 0.5, 0, 1), np.clip(grain * 0.5, 0, 1)], axis=-1)
    tx.save_rgba(fields, os.path.join(out, 'fields.png'))
    return {'toneLight': tone_light.tolist(), 'toneDark': tone_dark.tolist()}


if __name__ == '__main__':
    import sys
    print(build_skin(sys.argv[1] if len(sys.argv) > 1 else '.'))
