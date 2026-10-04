# Builds the 3D people's kit from MakeHuman's CC0 data (see fetch.ts):
#
#   python3 scripts/humans/build.py
#
# writes src/client/render3d/assets/people/{kit.bin, *.jpg, *.png}. The kit
# holds everything the client needs to make any person's body the way
# MakeHuman does, without MakeHuman: the base mesh, the macro targets (sex,
# age, muscle, weight, ancestry) and a set of detail targets (face, body
# shape, pregnancy), a skeleton whose joints are sums over the mesh (so they
# move with every target), skin weights for it, and the proxies bound to the
# base mesh (eyes, eyebrows, eyelashes, hair, clothes, a low-poly body for
# distance), each with its binding, texture coordinates into shared atlases
# and weights. Lengths are metres; y is up, the figure faces +z, its left is +x.
import json
import math
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import mh  # noqa: E402
import skin  # noqa: E402
import textures as tx  # noqa: E402
import clothes  # noqa: E402

OUT = os.path.join(mh.ROOT, 'src', 'client', 'render3d', 'assets', 'people')
U = mh.UNIT


# ── The vertices the client needs: the body and the helpers proxies bind to (not the joint cubes) ──
def shipped_vertices(b):
    inv = {v: k for k, v in b.groups.items()}
    drop = set()
    for i, g in enumerate(b.fg):
        n = inv[g]
        if n.startswith('joint-') or n == 'helper-genital':
            drop.update(b.fv[i])
    keep = [i for i in range(len(b.v)) if i not in drop]
    return np.array(keep, dtype=np.int32)


# ── The skeleton. Joints are MakeHuman joints (means of vertex sets), so every target moves them. ──
# (name, parent, MakeHuman joint(s) whose mean is the bone's head)
SIDES = ('L', 'R')


def bones_def():
    B = [
        ('root', None, None),
        ('hips', 'root', ['spine05____head']),
        ('spine', 'hips', ['spine04____head']),
        ('chest', 'spine', ['spine02____head']),
        ('neck', 'chest', ['neck01____head']),
        ('head', 'neck', ['head____head']),
        ('jaw', 'head', ['jaw____head']),
    ]
    for s in SIDES:
        B += [(f'eye{s}', 'head', [f'eye.{s}____head']), (f'lid{s}', 'head', [f'orbicularis03.{s}____head'])]
    for s in SIDES:
        B += [
            (f'clavicle{s}', 'chest', [f'clavicle.{s}____head']),
            (f'upperarm{s}', f'clavicle{s}', [f'upperarm01.{s}____head']),
            (f'forearm{s}', f'upperarm{s}', [f'lowerarm01.{s}____head']),
            (f'hand{s}', f'forearm{s}', [f'wrist.{s}____head']),
        ]
        # Finger segments: only for the rest pose's relaxed curl (merged into the hand for animation).
        for f in range(1, 6):
            parent = f'hand{s}'
            for k in range(1, 4):
                B.append((f'f{f}{k}{s}', parent, [f'finger{f}-{k}.{s}____head']))
                parent = f'f{f}{k}{s}'
    for s in SIDES:
        B += [
            (f'thigh{s}', 'hips', [f'upperleg01.{s}____head']),
            (f'shin{s}', f'thigh{s}', [f'lowerleg01.{s}____head']),
            (f'foot{s}', f'shin{s}', [f'foot.{s}____head']),
            (f'toe{s}', f'foot{s}', [f'toe{t}-1.{s}____head' for t in range(1, 6)]),
        ]
    return B


# Extra points the client measures (not bones): fingertips, the top of the head, the heel.
def points_def():
    P = [('headTop', ['head____tail'])]
    for s in SIDES:
        for f in range(1, 6):
            P.append((f'tip{f}{s}', [f'finger{f}-3.{s}____tail']))
        P.append((f'toeTip{s}', [f'toe3-3.{s}____tail']))
    return P


def mh_bone_to_ours(name):
    """Which of our bones a MakeHuman bone's weights go to: [(bone, share)]."""
    s = 'L' if name.endswith('.L') else 'R' if name.endswith('.R') else ''
    base = name[:-2] if s else name
    if base in ('root', 'spine05') or base == 'pelvis':
        return [('hips', 1.0)]
    if base in ('spine04', 'spine03'):
        return [('spine', 1.0)]
    if base in ('spine02', 'spine01', 'breast'):
        return [('chest', 1.0)]
    if base.startswith('neck'):
        return [('neck', 1.0)]
    if base in ('jaw', 'special04') or base.startswith('tongue') or base in ('oris01', 'oris02') or (base in ('oris06', 'oris07') and s):
        return [('jaw', 1.0)]
    if base == 'eye':
        return [(f'eye{s}', 1.0)]
    if base == 'orbicularis03':
        return [(f'lid{s}', 1.0)]
    if base == 'clavicle':
        return [(f'clavicle{s}', 1.0)]
    if base == 'shoulder01':
        return [(f'clavicle{s}', 0.5), (f'upperarm{s}', 0.5)]
    if base.startswith('upperarm'):
        return [(f'upperarm{s}', 1.0)]
    if base.startswith('lowerarm'):
        return [(f'forearm{s}', 1.0)]
    if base in ('wrist',) or base.startswith('metacarpal'):
        return [(f'hand{s}', 1.0)]
    if base.startswith('finger'):
        f, k = base[len('finger'):].split('-')
        return [(f'f{f}{k}{s}', 1.0)]
    if base.startswith('upperleg'):
        return [(f'thigh{s}', 1.0)]
    if base.startswith('lowerleg'):
        return [(f'shin{s}', 1.0)]
    if base == 'foot':
        return [(f'foot{s}', 1.0)]
    if base.startswith('toe'):
        return [(f'toe{s}', 1.0)]
    # Everything else in the face (lids below, brows, cheeks, the upper lip, ears) moves with the head.
    return [('head', 1.0)]


def skin_weights(nverts, bone_names):
    """Four influences per base vertex, in our bones."""
    idx = {n: i for i, n in enumerate(bone_names)}
    acc = [dict() for _ in range(nverts)]
    for mb, (vs, ws) in mh.bone_weights().items():
        for ob, share in mh_bone_to_ours(mb):
            bi = idx[ob]
            for v, w in zip(vs.tolist(), ws.tolist()):
                if v < nverts:
                    acc[v][bi] = acc[v].get(bi, 0.0) + w * share
    I = np.zeros((nverts, 4), dtype=np.int32)
    W = np.zeros((nverts, 4), dtype=np.float64)
    for v, d in enumerate(acc):
        top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top)
        if tot <= 0:
            continue
        for k, (bi, w) in enumerate(top):
            I[v, k] = bi
            W[v, k] = w / tot
    return I, W, np.array([sum(d.values()) > 0 for d in acc])


# ── Targets ──
# Face and body details a person varies by (each -1..1: the 'lo' targets below zero, 'hi' above).
DETAILS = [
    ('noseWidth', ['nose/nose-scale-horiz-decr'], ['nose/nose-scale-horiz-incr']),
    ('noseLength', ['nose/nose-scale-vert-decr'], ['nose/nose-scale-vert-incr']),
    ('noseDepth', ['nose/nose-scale-depth-decr'], ['nose/nose-scale-depth-incr']),
    ('noseBridge', ['nose/nose-hump-decr'], ['nose/nose-hump-incr']),
    ('noseTip', ['nose/nose-point-width-decr'], ['nose/nose-point-width-incr']),
    ('nostrils', ['nose/nose-flaring-decr'], ['nose/nose-flaring-incr']),
    ('mouthWidth', ['mouth/mouth-scale-horiz-decr'], ['mouth/mouth-scale-horiz-incr']),
    ('upperLip', ['mouth/mouth-upperlip-volume-decr'], ['mouth/mouth-upperlip-volume-incr']),
    ('lowerLip', ['mouth/mouth-lowerlip-volume-decr'], ['mouth/mouth-lowerlip-volume-incr']),
    ('chinProminent', ['chin/chin-prominent-decr'], ['chin/chin-prominent-incr']),
    ('chinWidth', ['chin/chin-width-decr'], ['chin/chin-width-incr']),
    ('chinHeight', ['chin/chin-height-decr'], ['chin/chin-height-incr']),
    ('jawWidth', ['chin/chin-bones-decr'], ['chin/chin-bones-incr']),
    ('cheekBones', ['cheek/l-cheek-bones-decr', 'cheek/r-cheek-bones-decr'], ['cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr']),
    ('cheekVolume', ['cheek/l-cheek-volume-decr', 'cheek/r-cheek-volume-decr'], ['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr']),
    ('eyeSize', ['eyes/l-eye-scale-decr', 'eyes/r-eye-scale-decr'], ['eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr']),
    ('eyeSpacing', ['eyes/l-eye-trans-in', 'eyes/r-eye-trans-in'], ['eyes/l-eye-trans-out', 'eyes/r-eye-trans-out']),
    ('eyeOpen', ['eyes/l-eye-height2-decr', 'eyes/r-eye-height2-decr'], ['eyes/l-eye-height2-incr', 'eyes/r-eye-height2-incr']),
    ('eyeTilt', ['eyes/l-eye-corner1-down', 'eyes/r-eye-corner1-down'], ['eyes/l-eye-corner1-up', 'eyes/r-eye-corner1-up']),
    ('browsHeight', ['eyebrows/eyebrows-trans-down'], ['eyebrows/eyebrows-trans-up']),
    ('browsAngle', ['eyebrows/eyebrows-angle-down'], ['eyebrows/eyebrows-angle-up']),
    ('forehead', ['forehead/forehead-scale-vert-decr'], ['forehead/forehead-scale-vert-incr']),
    ('headFat', ['head/head-fat-decr'], ['head/head-fat-incr']),
    ('headRound', [], ['head/head-round']),
    ('headOval', [], ['head/head-oval']),
    ('headSquare', [], ['head/head-square']),
    ('earSize', ['ears/l-ear-scale-decr', 'ears/r-ear-scale-decr'], ['ears/l-ear-scale-incr', 'ears/r-ear-scale-incr']),
    ('earFlap', ['ears/l-ear-flap-decr', 'ears/r-ear-flap-decr'], ['ears/l-ear-flap-incr', 'ears/r-ear-flap-incr']),
    ('neckWidth', ['neck/neck-scale-horiz-decr'], ['neck/neck-scale-horiz-incr']),
    ('doubleChin', [], ['neck/neck-double-incr']),
    # The body
    ('pregnant', [], ['stomach/stomach-pregnant-incr']),
    ('belly', ['stomach/stomach-pregnant-decr'], []),
    ('buttocks', ['buttocks/buttocks-volume-decr'], ['buttocks/buttocks-volume-incr']),
    ('hips', ['hip/hip-scale-horiz-decr'], ['hip/hip-scale-horiz-incr']),
    ('waist', ['hip/hip-waist-down'], ['hip/hip-waist-up']),
    ('shoulders', ['torso/torso-scale-horiz-decr'], ['torso/torso-scale-horiz-incr']),
    ('vshape', ['torso/torso-vshape-decr'], ['torso/torso-vshape-incr']),
    ('femHourglass', [], ['bodyshapes/bodyshapes-elvs-fem-full-hourglass']),
    ('femPear', [], ['bodyshapes/bodyshapes-elvs-fem-triangle']),
    ('femApple', [], ['bodyshapes/bodyshapes-elvs-fem-apple']),
    ('manApple', [], ['bodyshapes/bodyshapes-elvs-man-apple']),
    ('manTrapezoid', [], ['bodyshapes/bodyshapes-elvs-man-trapezoid']),
    ('breastSize', ['measure/measure-bust-circ-decr'], ['measure/measure-bust-circ-incr']),
]


class Blob:
    """The binary part of the kit: typed arrays appended one after another (8-byte aligned)."""

    def __init__(self):
        self.parts = []
        self.size = 0
        self.index = {}

    def add(self, name, arr):
        arr = np.ascontiguousarray(arr)
        kind = {np.dtype('float32'): 'f32', np.dtype('int16'): 'i16', np.dtype('uint16'): 'u16', np.dtype('uint8'): 'u8', np.dtype('int8'): 'i8', np.dtype('uint32'): 'u32', np.dtype('int32'): 'i32'}[arr.dtype]
        pad = (-self.size) % 8
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        data = arr.tobytes()
        assert name not in self.index, name
        self.index[name] = {'type': kind, 'offset': self.size, 'length': int(arr.size)}
        self.parts.append(data)
        self.size += len(data)
        return name


def quantize(d):
    m = float(np.abs(d).max())
    scale = m / 32767 if m > 0 else 1.0
    return np.round(d / scale).astype(np.int16), scale


def write_kit(blob, meta, path):
    head = json.dumps({**meta, 'arrays': blob.index}, separators=(',', ':')).encode()
    head += b' ' * ((-len(head) - 8) % 8)
    with open(path, 'wb') as f:
        f.write(b'MHK1')
        f.write(struct.pack('<I', len(head)))
        f.write(head)
        for p in blob.parts:
            f.write(p)
    print('wrote', path, round(os.path.getsize(path) / 1e6, 2), 'MB')


def main():
    os.makedirs(OUT, exist_ok=True)
    b = mh.base()
    ship = shipped_vertices(b)
    remap = -np.ones(len(b.v), dtype=np.int32)
    remap[ship] = np.arange(len(ship))
    n = len(ship)
    print('shipped vertices', n)
    blob = Blob()
    meta = {'version': 1, 'unit': 'm'}

    # Base positions.
    blob.add('base', (b.v[ship] * U).astype(np.float32).reshape(-1))

    # Skeleton and joints.
    B = bones_def()
    names = [x[0] for x in B]
    parents = [names.index(x[1]) if x[1] else -1 for x in B]
    J = mh.skeleton()['joints']
    jdefs = [x[2] for x in B] + [x[1] for x in points_def()]
    jnames = names + [x[0] for x in points_def()]

    def joint_of(v, defs):
        if defs is None:
            return np.zeros(3)
        return np.mean([v[J[d]].mean(0) for d in defs], axis=0)

    joints_base = np.array([joint_of(b.v, d) for d in jdefs]) * U
    blob.add('joints', joints_base.astype(np.float32).reshape(-1))
    meta['bones'] = {'names': names, 'parents': parents}
    meta['points'] = [x[0] for x in points_def()]

    # Skin weights (base vertices), for our bones.
    I, W, has = skin_weights(len(b.v), names)
    blob.add('skinIndex', I[ship].astype(np.uint8).reshape(-1))
    blob.add('skinWeight', np.round(W[ship] * 255).astype(np.uint8).reshape(-1))
    print('vertices without weights (shipped):', int((~has[ship]).sum()))

    # Targets: the macro set (dense for the ancestry ones, sparse for the rest) and the details.
    targets = []
    dense_parts, idx_parts, val_parts, joint_parts = [], [], [], []
    dense_n = sparse_n = 0

    def add_target(name):
        nonlocal dense_n, sparse_n
        d = mh.target(name)
        jd = np.array([joint_of(d, dd) for dd in jdefs]) * U
        ds = d[ship] * U
        mag = np.sqrt((ds ** 2).sum(1))
        nz = np.nonzero(mag > 5e-6)[0]
        t = {'name': name, 'joint': len(joint_parts)}
        joint_parts.append(jd.astype(np.float32))
        if len(nz) > n * 0.6:
            q, scale = quantize(ds)
            t.update(kind='dense', offset=dense_n, scale=scale)
            dense_parts.append(q.reshape(-1))
            dense_n += q.size
        else:
            q, scale = quantize(ds[nz]) if len(nz) else (np.zeros((0, 3), np.int16), 1.0)
            t.update(kind='sparse', offset=sparse_n, count=int(len(nz)), scale=scale)
            idx_parts.append(nz.astype(np.uint16))
            val_parts.append(q.reshape(-1))
            sparse_n += len(nz)
        targets.append(t)
        return len(targets) - 1

    macro = {}
    for g in ('female', 'male'):
        for a in mh.AGES:
            for r in mh.RACES:
                macro[f'{r}-{g}-{a}'] = add_target(f'macrodetails/{r}-{g}-{a}')
            for m in mh.MUSCLES:
                for w in mh.WEIGHTS:
                    key = f'universal-{g}-{a}-{m}-{w}'
                    d = mh.target('macrodetails/' + key)
                    if np.abs(d).max() > 0:
                        macro[key] = add_target('macrodetails/' + key)
    details = []
    for key, lo, hi in DETAILS:
        details.append({'name': key, 'lo': [add_target(t) for t in lo], 'hi': [add_target(t) for t in hi]})
    meta['targets'] = targets
    meta['macro'] = macro
    meta['details'] = details
    blob.add('targets.dense', np.concatenate(dense_parts) if dense_parts else np.zeros(0, np.int16))
    blob.add('targets.index', np.concatenate(idx_parts) if idx_parts else np.zeros(0, np.uint16))
    blob.add('targets.value', np.concatenate(val_parts) if val_parts else np.zeros(0, np.int16))
    blob.add('targets.joints', np.concatenate([j.reshape(-1) for j in joint_parts]))
    print('targets', len(targets), 'dense values', dense_n, 'sparse entries', sparse_n)

    # The body's surface: triangles, split at texture seams.
    body = mesh_from_faces(b, [i for i, g in enumerate(b.fg) if g == b.groups['body']], remap)
    blob.add('body.src', body['src'].astype(np.uint16))
    blob.add('body.uv', body['uv'].astype(np.float32).reshape(-1))
    blob.add('body.index', body['index'].astype(np.uint16).reshape(-1))
    meta['body'] = {'vertices': int(len(body['src'])), 'triangles': int(len(body['index']))}
    print('body', meta['body'])

    # Skin.
    meta['skin'] = skin.build_skin(OUT)

    # Proxies: eyes, eyebrows, eyelashes, hair (their textures packed into atlases).
    ctx = {'blob': blob, 'remap': remap, 'I': I, 'W': W, 'names': names, 'n': n}
    proxies = []
    eyes = mh.proxy('eyes', 'high-poly')
    # (Each eye is an eyeball and a clear cornea over it; the cornea, drawn opaque, would hide the eye: leave it out.)
    ball = [f for f, ts in enumerate(eyes.mesh.ft) if not (np.mean([eyes.mesh.vt[t][0] for t in ts]) > 0.85 and np.mean([eyes.mesh.vt[t][1] for t in ts]) < 0.15)]
    proxies.append(add_proxy(ctx, eyes, 'eyes', 'eyes', uv=lambda uv: uv, faces=ball))
    build_eye_texture(os.path.join(OUT, 'eyes.png'))
    hair_atlas = tx.Atlas(2048, 2048, 4, fill=(0.5, 0.5, 0.5, 0.0))
    for i, name in enumerate(HAIRS):
        pr = mh.proxy('hair', name)
        hair_atlas.put(name, hair_cell(pr.texture(), 512), (i % 4) * 512, (i // 4) * 512)
        proxies.append(add_proxy(ctx, pr, 'hair', name, uv=lambda uv, k=name: hair_atlas.uv(k, uv)))
    for i, name in enumerate(BROWS):
        pr = mh.proxy('eyebrows', name)
        cell = 10 + i // 4
        hair_atlas.put(name, hair_cell(pr.texture(), 256), (cell % 4) * 512 + (i % 2) * 256, (cell // 4) * 512 + ((i % 4) // 2) * 256)
        proxies.append(add_proxy(ctx, pr, 'brows', name, uv=lambda uv, k=name: hair_atlas.uv(k, uv)))
    for i, name in enumerate(LASHES):
        pr = mh.proxy('eyelashes', name)
        cell = 13
        hair_atlas.put(name, hair_cell(pr.texture(), 256), (cell % 4) * 512 + (i % 2) * 256, (cell // 4) * 512 + ((i % 4) // 2) * 256)
        proxies.append(add_proxy(ctx, pr, 'lashes', name, uv=lambda uv, k=name: hair_atlas.uv(k, uv)))
    save_webp(hair_atlas.img, os.path.join(OUT, 'hair.webp'))

    # Clothes: each outfit cut into its garments; the shading of their textures in one atlas.
    body_faces = [i for i, g in enumerate(b.fg) if g == b.groups['body']]
    cloth = tx.Atlas(2048, 2048, 3, fill=(0.5, 0.5, 0.5))
    suits = {}
    parts_made = []
    garment_sources = {}
    for gid, src, which in clothes.SPEC:
        suits.setdefault(src, []).append((gid, which))
    for ci, (src, parts) in enumerate(suits.items()):
        pr = mh.proxy('clothes', src)
        cells = []
        for gid, which in parts:
            fs, slots = clothes.suit_slots(pr, which)
            cells.append(clothes.Part(gid, pr, clothes.cut(pr, which), fs, slots))
        # Every piece of the outfit takes its share of the body it hides, worn here or not (a shirt must not hide
        # the legs its jeans covered).
        pieces = ['overalls', 'tee'] if src == 'male_worksuit01' else ['top', 'bottom']
        spare = [clothes.Part(None, pr, clothes.cut(pr, w)) for w in pieces if w not in [x[1] for x in parts]]
        clothes.assign_deletes(pr, cells + [x for x in spare if x.verts])
        # The texture's shading per slot region, in this outfit's cell.
        regions = {}
        for part in cells:
            for k in range(len(part.slots)):
                fl = [f for f in part.faces if part.face_slot(f) == k]
                regions[(part.id, k)] = clothes.uv_region(pr.mesh, fl, 512)
        cell = clothes.detail_map(pr.texture(), 512, regions, striped=src in clothes.STRIPED)
        x, y = (ci % 4) * 512, (ci // 4) * 512
        cloth.put(src, cell, x, y)
        parts_made.extend(cells)
        for part in cells:
            sub = SubProxy(pr, part.verts, part.faces, part.deletes, part.id)
            garment_sources[part.id] = SubProxyFit(sub)
            hide = clothes.hidden_triangles(body_faces, body['tri_of_face'], part.deletes)
            fsub = (lambda fi, part=part: part.face_slot(part.faces[fi]))
            proxies.append(add_proxy(ctx, sub, 'clothes', part.id, uv=lambda uv, k=src: cloth.uv(k, uv), hide=hide, face_slot=fsub, slots=part.slots))
    # Shoes (with their socks), four to a cell.
    base_cell = len(suits)
    for i, name in enumerate(clothes.SHOES):
        pr = mh.proxy('clothes', name)
        whole = list(range(len(pr.mesh.fv)))
        # Shoes keep their own colours (leather, canvas, soles, socks): slot 'own'.
        cell = clothes.detail_map(pr.texture(), 256, {('shoe', 0): clothes.uv_region(pr.mesh, whole, 256)}, original=True)
        c = base_cell + i // 4
        cloth.put(name, cell, (c % 4) * 512 + (i % 2) * 256, (c // 4) * 512 + ((i % 4) // 2) * 256)
        hide = clothes.hidden_triangles(body_faces, body['tri_of_face'], [d for d in pr.delete if d < 13380])
        garment_sources[name] = pr
        proxies.append(add_proxy(ctx, pr, 'clothes', name, uv=lambda uv, k=name: cloth.uv(k, uv), hide=hide, face_slot=lambda f: 0, slots=['own']))
    # Plain cotton for the garments made here (skirts, night clothes, hats): an even weave, no print.
    rng = np.random.default_rng(7)
    weave = 0.5 + tx.blur(rng.normal(0, 1, (512, 512)), 0.8) * 0.05
    cloth.put('plain', np.repeat(weave[..., None], 3, axis=-1), 3 * 512, 3 * 512)
    plain_uv = lambda uv: cloth.uv('plain', uv * 0.9 + 0.05)
    body_v = b.v[:13380]
    # Shorts: the jeans cut above the knee.
    for gid, src, cut_y in [('m_shorts', 'm_jeans', -2.6), ('f_capri', 'f_jeans', -4.6)]:
        pr = mh.proxy('clothes', 'male_casualsuit04' if gid == 'm_shorts' else 'female_casualsuit01')
        part = [x for x in parts_made if x.id == src][0]
        fitted = pr.fit(b.v)
        keep = [v for v in part.verts if fitted[v][1] > cut_y]
        ks = set(keep)
        faces = [f for f in part.faces if all(v in ks for v in pr.mesh.fv[f])]
        dels = [d for d in part.deletes if b.v[d][1] > cut_y + 0.35]
        sub = SubProxy(pr, keep, faces, dels, gid)
        garment_sources[gid] = SubProxyFit(sub)
        hide = clothes.hidden_triangles(body_faces, body['tri_of_face'], dels)
        proxies.append(add_proxy(ctx, sub, 'clothes', gid, uv=lambda uv, k=pr.name: cloth.uv(k, uv), hide=hide, face_slot=lambda f: 0, slots=['main']))
    # MakeHuman's own helpers as garments: the tights (a baby's onesie, night clothes), the skirt tube (skirts, a coat's tails).
    for gid, group, lo, hi, lift in [('onesie', 'helper-tights', -99, 6.0, 0.03), ('skirt_long', 'helper-skirt', -99, 99, 0.06), ('skirt_knee', 'helper-skirt', -3.3, 99, 0.06), ('coat', 'helper-skirt', -3.8, 99, 0.28)]:
        hp = HelperProxy(b, group, lo, hi, lift, gid)
        near = hp.covering(body_v, 0.25 if group == 'helper-tights' else 1.3)
        if group == 'helper-skirt':
            # under a skirt: the hips and thighs down to a hand above the hem (the legs swing inside it)
            hem = min(b.v[v][1] for v in hp.verts)
            near = [d for d in near if hem + 0.9 < b.v[d][1] < 1.3 and abs(b.v[d][0]) < 1.9]
        hp.delete = near
        garment_sources[gid] = SubProxyFit(hp)
        hide = clothes.hidden_triangles(body_faces, body['tri_of_face'], near)
        proxies.append(add_proxy(ctx, hp, 'clothes', gid, uv=plain_uv, hide=hide, face_slot=lambda f: 0, slots=['main']))
    # The sari's pallu, draped over the left shoulder: bound to the tights helper as MakeHuman binds clothes.
    mp = MadeProxy(b, 'sari_pallu', *clothes.pallu(b))
    garment_sources['sari_pallu'] = SubProxyFit(mp)
    proxies.append(add_proxy(ctx, mp, 'clothes', 'sari_pallu', uv=lambda uv: cloth.uv('plain', uv * 0.9 + 0.05), hide=[], face_slot=lambda f, mp=mp: mp.slot[f], slots=['main', 'trim']))
    # Hats from the earlier model (a peaked cap, a hard hat, a straw hat, a head wrap, a beanie), fitted to this head.
    for name in ['cap', 'hard', 'straw', 'wrap', 'beanie']:
        hp = HatProxy(b, name)
        garment_sources['hat_' + name] = SubProxyFit(hp)
        proxies.append(add_proxy(ctx, hp, 'clothes', 'hat_' + name, uv=lambda uv: cloth.uv('plain', np.full_like(uv, 0.5)), face_slot=lambda f, hp=hp: hp.slot[f], slots=['main', 'trim']))
    tx.save_rgb(cloth.img, os.path.join(OUT, 'clothes.jpg'))

    # Bodies for distance: MakeHuman's light proxies, painted per vertex (skin, hair, each garment's colour).
    garments = [x for x in proxies if x['kind'] == 'clothes']
    hair_mask = skin_hair_mask()
    lods = []
    for name in ('female1605', 'male1591'):
        pr = mh.proxy('proxymeshes', name)
        info = add_proxy(ctx, pr, 'lod', name, uv=lambda uv: uv)
        fitted = pr.fit(b.v)
        # Which of its vertices each garment covers: most of the body under it hidden, or its surface close by.
        cover = {}
        for g in garments:
            gp = garment_sources[g['name']]
            D = set(gp.delete)
            wts = np.zeros(len(pr.ref))
            for k in range(3):
                wts += pr.w[:, k] * np.array([1.0 if r in D else 0.0 for r in pr.ref[:, k]])
            hit = set(np.nonzero(wts > 0.5)[0].tolist())
            if not D or g['name'].startswith('hat_') or g['name'] in ('skirt_long', 'skirt_knee', 'coat'):
                gv = gp.fit(b.v) if hasattr(gp, 'fit') else None
                if gv is None:
                    gv = gp.mesh.v if not hasattr(gp, 'verts') else b.v[gp.verts]
                reach = 0.25 if g['name'].startswith('hat_') else 0.9
                for i0 in range(0, len(fitted), 400):
                    ch = fitted[i0:i0 + 400]
                    d2 = ((ch[:, None, :] - gv[None, :, :]) ** 2).sum(-1).min(1)
                    hit |= set((i0 + np.nonzero(d2 < reach * reach)[0]).tolist())
            cover[g['name']] = sorted(hit)
            blob.add(f"lod.{name}.cover.{g['name']}", np.array(sorted(hit), dtype=np.uint16))
        # Where hair grows on the scalp (for a close crop, or under hair): from the skin's hair field at the body's uvs.
        hv = np.zeros(len(b.v))
        for f in body_faces:
            for v, t in zip(b.fv[f], b.ft[f]):
                u, w_ = b.vt[t]
                hv[v] = max(hv[v], hair_mask[int(np.clip((1 - w_) * 1023, 0, 1023)), int(np.clip(u * 1023, 0, 1023))])
        hair = (pr.w * hv[pr.ref]).sum(1)
        blob.add(f'lod.{name}.hair', np.round(np.clip(hair, 0, 1) * 255).astype(np.uint8))
        lods.append(info)
    proxies.extend(lods)
    meta['proxies'] = proxies
    print('proxies', [(p['name'], p['vertices']) for p in proxies])

    write_kit(blob, meta, os.path.join(OUT, 'kit.bin'))


HAIRS = ['short01', 'short02', 'short03', 'short04', 'afro01', 'bob01', 'bob02', 'braid01', 'long01', 'ponytail01']
# Brows: fuller and straighter for men, finer and arched for women (see dress.ts).
BROWS = ['eyebrow001', 'eyebrow002', 'eyebrow006', 'eyebrow007', 'eyebrow008', 'eyebrow009', 'eyebrow010', 'eyebrow011', 'eyebrow012']
LASHES = ['eyelashes01', 'eyelashes02']


def save_webp(a, path):
    from PIL import Image
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8), 'RGBA').save(path, 'WEBP', quality=90, alpha_quality=100, method=6)


def hair_cell(path, size):
    """A hair-like texture for the atlas: RGB the strands' brightness relative to their average (x0.5), A coverage."""
    from PIL import Image
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im, dtype=np.float64) / 255.0
    rgb = tx.srgb_to_lin(a[..., :3])
    al = a[..., 3]
    # Resize premultiplied, so the strands' edges do not pick up the background.
    pre = np.concatenate([rgb * al[..., None], al[..., None]], axis=-1)
    small = np.stack([np.asarray(Image.fromarray(pre[..., c].astype(np.float32), mode='F').resize((size, size), Image.BOX)) for c in range(4)], axis=-1).astype(np.float64)
    al = np.clip(small[..., 3], 0, 1)
    rgb = small[..., :3] / np.maximum(al[..., None], 1e-4)
    L = tx.lum(rgb)
    solid = al > 0.5
    mean = L[solid].mean() if solid.any() else max(L.mean(), 1e-4)
    detail = np.clip(L / mean, 0, 2) * 0.5
    detail = tx.dilate_colors(np.repeat(detail[..., None], 3, axis=-1), al > 0.05, 8)[..., 0]
    return np.stack([detail, detail, detail, al], axis=-1)


def build_eye_texture(path):
    """The eyeballs, linear, no alpha: R the sclera's brightness, G the iris's detail (x0.5), B the iris's mask."""
    img = tx.load(os.path.join(mh.ASSETS, 'eyes', 'materials', 'brown_eye.png'), 512, 'RGBA')
    rgb = img[..., :3]
    lin = tx.srgb_to_lin(rgb)
    L = tx.lum(lin)
    chroma = rgb[..., 0] - rgb[..., 2]
    iris = tx.opening(((chroma > 0.12) | (L < 0.03)) & (L < 0.2), 2)
    m = np.clip(tx.blur(iris.astype(np.float64), 1.0) * 1.3, 0, 1)
    mean = L[iris & (L > 0.01)].mean()
    # The iris detail carries on past its edge as the dark ring at its rim; the sclera's brightness in under the iris.
    ring = np.percentile(np.clip(L[iris] / mean, 0, 2), 15)
    detail = np.where(iris, np.clip(L / mean, 0, 2), ring)
    sclera = np.where(iris, np.nan, L)
    sclera = np.where(np.isnan(sclera), np.nanmedian(sclera), sclera)
    tx.save_rgb(np.stack([np.clip(sclera, 0, 1), detail * 0.5, m], axis=-1), path)


def add_proxy(ctx, p, kind, name, uv, weights=None, faces=None, hide=None, face_slot=None, slots=None):
    """A proxy's arrays: binding (three shipped vertices, weights, offset), its surface (uv split), skin weights."""
    blob, remap, I, W, names, n = ctx['blob'], ctx['remap'], ctx['I'], ctx['W'], ctx['names'], ctx['n']
    ref = remap[p.ref]
    w = p.w.copy()
    for k in range(3):
        bad = ref[:, k] < 0
        if bad.any():
            assert (np.abs(w[bad, k]) < 1e-6).all(), f'{name}: binds to a vertex that is not shipped'
            ref[bad, k] = ref[bad, 0]
            w[bad, k] = 0
    key = f'{kind}.{name}'
    blob.add(key + '.ref', ref.astype(np.uint16).reshape(-1))
    # Weights and offsets in 16 bits: offsets in steps of the largest (a proxy's are a few centimetres).
    # (MakeHuman binds some vertices by extrapolation, weights up to ±5: kept in 16-bit steps of 1/4096.)
    assert np.abs(w).max() < 7.99, name
    blob.add(key + ".w", np.round(w * 4096).astype(np.int16).reshape(-1))
    off_q, off_scale = quantize(p.off * U)
    blob.add(key + '.off', off_q.reshape(-1))
    scale = []
    for sc in p.scale:
        scale.append([int(remap[sc[0]]), int(remap[sc[1]]), sc[2] * U] if sc else None)
    # Skin weights: the proxy follows the vertices it is bound to (or its own, for shoes).
    nv = len(ref)
    if getattr(p, 'head_only', False):
        acc = [{names.index('head'): 1.0} for _ in range(nv)]
    elif p.weights_file:
        acc = [dict() for _ in range(nv)]
        with open(p.weights_file) as f:
            wd = json.load(f)['weights']
        idx = {x: i for i, x in enumerate(names)}
        for mb, lst in wd.items():
            for ob, share in mh_bone_to_ours(mb):
                for v, wt in lst:
                    acc[v][idx[ob]] = acc[v].get(idx[ob], 0.0) + wt * share
    else:
        acc = [dict() for _ in range(nv)]
        for v in range(nv):
            for k in range(3):
                if w[v, k] <= 0:
                    continue
                r = p.ref[v, k]
                for j in range(4):
                    if W[r, j] > 0:
                        acc[v][I[r, j]] = acc[v].get(I[r, j], 0.0) + w[v, k] * W[r, j]
    SI = np.zeros((nv, 4), dtype=np.uint8)
    SW = np.zeros((nv, 4), dtype=np.uint8)
    for v, d in enumerate(acc):
        top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top) or 1
        q = [int(round(x / tot * 255)) for _, x in top]
        if q:
            q[0] += 255 - sum(q)
        for k, (bi, _) in enumerate(top):
            SI[v, k] = bi
            SW[v, k] = q[k]
    blob.add(key + '.skinIndex', SI.reshape(-1))
    blob.add(key + '.skinWeight', SW.reshape(-1))
    mesh = mesh_from_faces(p.mesh, faces if faces is not None else list(range(len(p.mesh.fv))), None)
    blob.add(key + '.src', mesh['src'].astype(np.uint16))
    blob.add(key + '.uv', np.round(np.clip(uv(mesh['uv']), 0, 1) * 65535).astype(np.uint16).reshape(-1))
    blob.add(key + '.index', mesh['index'].astype(np.uint16).reshape(-1))
    dels = sorted({int(remap[d]) for d in p.delete if d < 13380 and remap[d] >= 0})
    blob.add(key + '.deletes', np.array(dels, dtype=np.uint16))
    info = {'name': name, 'kind': kind, 'key': key, 'vertices': int(nv), 'renderVertices': int(len(mesh['src'])), 'triangles': int(len(mesh['index'])), 'scale': scale, 'deletes': len(dels), 'offScale': off_scale}
    if hide is not None:
        blob.add(key + '.hide', np.array(sorted(hide), dtype=np.uint16))
        info['hides'] = len(hide)
    if face_slot is not None:
        blob.add(key + '.slot', np.array([face_slot(f) for f in mesh['face_of']], dtype=np.uint8))
        info['slots'] = list(slots)
    return info


def mesh_from_faces(obj, faces, remap):
    """Triangles over the faces, a vertex per (position, uv) pair: src = shipped vertex index, uv; and for each render
    vertex the face that made it, for each face its triangles."""
    key = {}
    src, uv, tris, face_of, tri_of_face = [], [], [], [], []
    for f in faces:
        vs, ts = obj.fv[f], obj.ft[f]
        ids = []
        for v, t in zip(vs, ts):
            k = (v, t)
            if k not in key:
                key[k] = len(src)
                src.append(remap[v] if remap is not None else v)
                uv.append(obj.vt[t] if t >= 0 else (0.0, 0.0))
                face_of.append(f)
            ids.append(key[k])
        mine = []
        for k in range(1, len(ids) - 1):
            mine.append(len(tris))
            tris.append((ids[0], ids[k], ids[k + 1]))
        tri_of_face.append(mine)
    src = np.array(src, dtype=np.int64)
    assert (src >= 0).all(), 'a face uses a vertex that is not shipped'
    return {'src': src, 'uv': np.array(uv), 'index': np.array(tris, dtype=np.int64), 'face_of': face_of, 'tri_of_face': tri_of_face}


class SubMesh:
    """Part of a proxy's mesh: its vertices renumbered, its faces."""

    def __init__(self, mesh, verts, faces):
        at = {v: i for i, v in enumerate(verts)}
        self.v = mesh.v[verts]
        self.vt = mesh.vt
        self.fv = [[at[v] for v in mesh.fv[f]] for f in faces]
        self.ft = [mesh.ft[f] for f in faces]


class HelperProxy:
    """Part of the base mesh's own helpers worn as a garment: each vertex bound to itself, lifted off the skin along
    its normal."""

    def __init__(self, b, group, lo, hi, lift, name):
        g = b.groups[group]
        faces = [i for i, x in enumerate(b.fg) if x == g and lo < min(b.v[v][1] for v in b.fv[i]) and max(b.v[v][1] for v in b.fv[i]) < hi]
        verts = sorted({v for f in faces for v in b.fv[f]})
        at = {v: i for i, v in enumerate(verts)}
        # Normals of the helper surface (area-weighted), outward.
        nrm = np.zeros((len(verts), 3))
        for f in faces:
            P = b.v[b.fv[f]]
            n = np.cross(P[1] - P[0], P[2] - P[0])
            for v in b.fv[f]:
                nrm[at[v]] += n
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        self.name = name
        self.verts = verts
        self.ref = np.array([[v, v, v] for v in verts], dtype=np.int32)
        self.w = np.tile([1.0, 0.0, 0.0], (len(verts), 1))
        self.off = nrm * lift
        self.scale = [None, None, None]
        self.delete = []
        self.weights_file = None

        class M:
            pass

        m = M()
        m.v = b.v[verts]
        m.vt = b.vt
        m.fv = [[at[v] for v in b.fv[f]] for f in faces]
        m.ft = [b.ft[f] for f in faces]
        self.mesh = m

    def covering(self, body_v, within):
        """Body vertices within this distance (decimetres) of the helper's surface."""
        P = self.mesh.v
        out = []
        for i0 in range(0, len(body_v), 2000):
            chunk = body_v[i0:i0 + 2000]
            d2 = ((chunk[:, None, :] - P[None, :, :]) ** 2).sum(-1).min(1)
            out.extend((i0 + np.nonzero(d2 < within * within)[0]).tolist())
        return out


# The earlier model's head and this one's: crown to temples, the head's width and depth there.
OLD_CROWN = np.array([0.0, 17.5, -0.067])
NEW_CROWN = np.array([0.0, 8.491, 0.582])
OLD_TO_NEW = np.array([0.747 / 0.81, 0.923, 1.904 / 2.061])


class HatProxy:
    """A hat from the earlier model, moved onto this model's head and bound to the scalp as MakeHuman binds hair
    (the nearest scalp vertex and an offset, scaled with the head)."""

    def __init__(self, b, name):
        # (hats.json: the hats of the earlier, sculpted model, as Blender held them: z up, facing -y, metres.)
        with open(os.path.join(os.path.dirname(__file__), 'hats.json')) as f:
            old = json.load(f)['Hat_' + name]
        o = np.asarray(old['v'])
        v = (np.stack([o[:, 0], o[:, 2], -o[:, 1]], axis=1) * 10 - OLD_CROWN) * OLD_TO_NEW + NEW_CROWN
        head = [i for i in range(13380) if b.v[i][1] > 6.8]
        H = b.v[head]
        near = [head[int(np.argmin(((H - p) ** 2).sum(1)))] for p in v]
        self.name = 'hat_' + name
        self.ref = np.array([[i, i, i] for i in near], dtype=np.int32)
        self.w = np.tile([1.0, 0.0, 0.0], (len(v), 1))
        self.off = v - b.v[near]
        # The head's own measures (as MakeHuman's hair uses): temples, chin to crown, back to brow.
        self.scale = [(5399, 11998, abs(b.v[5399][0] - b.v[11998][0])), (791, 881, abs(b.v[791][1] - b.v[881][1])), (962, 5320, abs(b.v[962][2] - b.v[5320][2]))]
        self.delete = []
        # Rigid on the head.
        self.weights_file = None
        self.head_only = True
        # Per face: 0 the hat, 1 its trim (a band, a visor).
        self.slot = old['slot']

        class M:
            pass

        m = M()
        m.v = v
        m.vt = np.zeros((1, 2))
        m.fv = old['f']
        m.ft = [[0] * len(f) for f in old['f']]
        self.mesh = m


class MadeProxy:
    """A garment made here (vertices, quads, a slot per quad, uvs; base-mesh decimetres), bound to the tights helper
    as MakeHuman binds clothes, as a sheet with two faces (a thin cloth seen from both sides)."""

    def __init__(self, b, name, verts, quads, slot, uvs, thickness=0.03):
        g = b.groups['helper-tights']
        tris = []
        for f, x in enumerate(b.fg):
            if x != g:
                continue
            vs = b.fv[f]
            for k in range(1, len(vs) - 1):
                tris.append((vs[0], vs[k], vs[k + 1]))
        tris = np.array(tris)
        n = len(verts)
        # The underside: the same sheet a few millimetres in, faces turned the other way.
        nrm = np.zeros_like(verts)
        for q in quads:
            P = verts[q]
            nq = np.cross(P[1] - P[0], P[3] - P[0])
            for v in q:
                nrm[v] += nq
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        allv = np.concatenate([verts, verts - nrm * thickness])
        ref, w, off = clothes.auto_bind(allv, b.v, tris)
        self.name = name
        self.ref = ref.astype(np.int32)
        self.w = w
        self.off = off
        self.scale = [(5399, 11998, abs(b.v[5399][0] - b.v[11998][0])), (791, 881, abs(b.v[791][1] - b.v[881][1])), (962, 5320, abs(b.v[962][2] - b.v[5320][2]))]
        self.delete = []
        self.weights_file = None
        faces = [list(q) for q in quads] + [[v + n for v in reversed(q)] for q in quads]
        self.slot = list(slot) + list(slot)

        class M:
            pass

        m = M()
        m.v = allv
        m.vt = np.concatenate([uvs, uvs])
        m.fv = faces
        m.ft = faces
        self.mesh = m


class SubProxyFit:
    """Fit any of the proxies above to a body (as mh.Proxy.fit)."""

    def __init__(self, p):
        self.p = p
        self.delete = p.delete

    def fit(self, v):
        p = self.p
        s = np.ones(3)
        for n in range(3):
            if p.scale[n]:
                a, b_, den = p.scale[n]
                s[n] = abs(v[a][n] - v[b_][n]) / den
        return (v[p.ref] * p.w[:, :, None]).sum(1) + p.off * s


def skin_hair_mask():
    """The skin's scalp-hair field (R of fields.png), 1024 square, rows top to bottom."""
    from PIL import Image
    return np.asarray(Image.open(os.path.join(OUT, 'fields.png')).convert('RGBA'), dtype=np.float64)[..., 0] / 255.0


class SubProxy:
    """A proxy made of some of another's vertices and faces (a garment cut from an outfit)."""

    def __init__(self, p, verts, faces, deletes, name):
        verts = list(verts)
        self.name = name
        self.ref = p.ref[verts]
        self.w = p.w[verts]
        self.off = p.off[verts]
        self.scale = p.scale
        self.delete = deletes
        self.mesh = SubMesh(p.mesh, verts, faces)
        self.weights_file = None


if __name__ == '__main__':
    main()
