# Reading MakeHuman's CC0 data (the hm08 base mesh, its targets, skeleton,
# weights and proxies) with numpy, and evaluating a body the way MakeHuman
# does: base mesh plus the macro targets weighted by sex, age, muscle, weight
# and ancestry. Used by build.py (the client's kit) and preview.py.
#
# The data comes from data/makehuman (see fetch.ts): the MakeHuman repository
# (base mesh, targets, rig, weights) and its CC0 system asset pack (clothes,
# hair, eyebrows, eyelashes, eyes, skins, proxy meshes).
import gzip
import json
import os
import re

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MH = os.path.join(ROOT, 'data', 'makehuman')
DATA = os.path.join(MH, 'repo', 'makehuman', 'data')
ASSETS = os.path.join(MH, 'assets')
CACHE = os.path.join(MH, 'cache')

# MakeHuman's units are decimetres.
UNIT = 0.1


class Obj:
    """A Wavefront mesh: vertices, texture coordinates, faces (vertex and uv indices) and their groups."""

    def __init__(self, path):
        vs, vts, fv, ft, fg, groups = [], [], [], [], [], {}
        cur = 0
        with open(path) as f:
            for line in f:
                if line.startswith('v '):
                    vs.append([float(x) for x in line.split()[1:4]])
                elif line.startswith('vt '):
                    vts.append([float(x) for x in line.split()[1:3]])
                elif line.startswith('g '):
                    name = line.split(None, 1)[1].strip()
                    cur = groups.setdefault(name, len(groups))
                elif line.startswith('f '):
                    vi, ti = [], []
                    for tok in line.split()[1:]:
                        p = tok.split('/')
                        vi.append(int(p[0]) - 1)
                        ti.append(int(p[1]) - 1 if len(p) > 1 and p[1] else -1)
                    fv.append(vi)
                    ft.append(ti)
                    fg.append(cur)
        self.v = np.array(vs, dtype=np.float64)
        self.vt = np.array(vts, dtype=np.float64) if vts else np.zeros((0, 2))
        self.fv = fv
        self.ft = ft
        self.fg = np.array(fg, dtype=np.int32)
        self.groups = groups

    def group_faces(self, name):
        g = self.groups[name]
        return [i for i, x in enumerate(self.fg) if x == g]

    def group_verts(self, name):
        g = self.groups[name]
        out = set()
        for i, x in enumerate(self.fg):
            if x == g:
                out.update(self.fv[i])
        return sorted(out)


_base = None


def base():
    global _base
    if _base is None:
        _base = Obj(os.path.join(DATA, '3dobjs', 'base.obj'))
    return _base


def read_target(path):
    """A target file: vertex index and displacement per line (decimetres)."""
    idx, d = [], []
    op = gzip.open if path.endswith('.gz') else open
    with op(path, 'rt') as f:
        for line in f:
            if not line.strip() or line.startswith('#'):
                continue
            p = line.split()
            idx.append(int(p[0]))
            d.append((float(p[1]), float(p[2]), float(p[3])))
    return np.array(idx, dtype=np.int32), np.array(d, dtype=np.float64).reshape(-1, 3)


_targets = {}


def target(rel):
    """A target by its path under data/targets (without .target), as a dense (N, 3) array of displacements."""
    if rel in _targets:
        return _targets[rel]
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, rel.replace('/', '__') + '.npy')
    if os.path.exists(cache):
        d = np.load(cache)
    else:
        idx, dd = read_target(os.path.join(DATA, 'targets', rel + '.target'))
        d = np.zeros((len(base().v), 3))
        d[idx] = dd
        np.save(cache, d)
    _targets[rel] = d
    return d


# ── MakeHuman's macro variables → target weights (apps/human.py, _set*Vals) ──
AGES = ('baby', 'child', 'young', 'old')
MUSCLES = ('minmuscle', 'averagemuscle', 'maxmuscle')
WEIGHTS = ('minweight', 'averageweight', 'maxweight')
RACES = ('african', 'asian', 'caucasian')


def age_years_to_value(years):
    years = max(1.0, min(90.0, years))
    if years < 25:
        return (years - 1) / ((25 - 1) * 2)
    return (years - 25) / ((90 - 25) * 2) + 0.5


def age_vals(age):
    """Weights of the baby, child, young and old targets for MakeHuman's age value (0..1)."""
    if age < 0.5:
        young = max(0.0, (age - 0.1875) * 3.2)
        return {'baby': max(0.0, 1 - age * 5.333), 'child': max(0.0, min(1.0, 5.333 * age) - young), 'young': young, 'old': 0.0}
    old = max(0.0, age * 2 - 1)
    return {'baby': 0.0, 'child': 0.0, 'young': 1 - old, 'old': old}


def three_vals(x, names):
    hi = max(0.0, x * 2 - 1)
    lo = max(0.0, 1 - x * 2)
    return {names[0]: lo, names[1]: 1 - (hi + lo), names[2]: hi}


def macro_weights(gender, age, muscle, weight, races):
    """{target path: weight} for the macro targets, as MakeHuman computes them.
    gender 0 female .. 1 male; age MakeHuman's 0..1; muscle, weight 0..1 (0.5 average); races {name: share}."""
    g = {'female': 1 - gender, 'male': gender}
    a = age_vals(age)
    m = three_vals(muscle, MUSCLES)
    w = three_vals(weight, WEIGHTS)
    out = {}
    for gn, gv in g.items():
        if gv <= 0:
            continue
        for an, av in a.items():
            if av <= 0:
                continue
            for mn, mv in m.items():
                if mv <= 0:
                    continue
                for wn, wv in w.items():
                    if wv <= 0:
                        continue
                    out[f'macrodetails/universal-{gn}-{an}-{mn}-{wn}'] = gv * av * mv * wv
            for rn in RACES:
                rv = races.get(rn, 0.0)
                if rv > 0:
                    out[f'macrodetails/{rn}-{gn}-{an}'] = out.get(f'macrodetails/{rn}-{gn}-{an}', 0.0) + gv * av * rv
    return out


def evaluate(weights):
    """The base mesh with these targets applied (decimetres)."""
    v = base().v.copy()
    for rel, w in weights.items():
        if w:
            v += target(rel) * w
    return v


# ── Skeleton (rigs/default.mhskel: joints are means of vertex groups) ──
_skel = None


def skeleton():
    global _skel
    if _skel is None:
        with open(os.path.join(DATA, 'rigs', 'default.mhskel')) as f:
            _skel = json.load(f)
    return _skel


def joint(v, name):
    return v[skeleton()['joints'][name]].mean(0)


_weights = None


def bone_weights():
    """{MakeHuman bone: (vertex indices, weights)} for the default rig."""
    global _weights
    if _weights is None:
        with open(os.path.join(DATA, 'rigs', 'default_weights.mhw')) as f:
            d = json.load(f)['weights']
        _weights = {b: (np.array([p[0] for p in l], dtype=np.int32), np.array([p[1] for p in l])) for b, l in d.items()}
    return _weights


# ── Proxies (.mhclo / .proxy): meshes bound to the base mesh ──
class Proxy:
    """A mesh bound to the base: each vertex is a weighted sum of three base vertices plus a scaled offset."""

    def __init__(self, path):
        self.path = path
        self.dir = os.path.dirname(path)
        self.ref = []
        self.w = []
        self.off = []
        self.scale = [None, None, None]
        self.delete = []
        self.obj_file = None
        self.material = None
        self.name = os.path.splitext(os.path.basename(path))[0]
        self.z_depth = 0
        self.weights_file = None
        self.tags = []
        mode = None
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith('#'):
                    continue
                p = s.split()
                key = p[0]
                if key == 'verts':
                    mode = 'verts'
                    continue
                if key == 'delete_verts':
                    mode = 'delete'
                    continue
                if mode == 'verts' and re.match(r'^-?\d', key):
                    if len(p) == 1:
                        self.ref.append((int(p[0]), int(p[0]), int(p[0])))
                        self.w.append((1.0, 0.0, 0.0))
                        self.off.append((0.0, 0.0, 0.0))
                    else:
                        self.ref.append((int(p[0]), int(p[1]), int(p[2])))
                        self.w.append((float(p[3]), float(p[4]), float(p[5])))
                        self.off.append((float(p[6]), float(p[7]), float(p[8])) if len(p) >= 9 else (0.0, 0.0, 0.0))
                    continue
                if mode == 'delete' and re.match(r'^\d', key):
                    toks = s.split()
                    i = 0
                    while i < len(toks):
                        if toks[i] == '-':
                            a = int(toks[i - 1])
                            b = int(toks[i + 1])
                            self.delete.extend(range(a + 1, b + 1))
                            i += 2
                        else:
                            self.delete.append(int(toks[i]))
                            i += 1
                    continue
                # (Keywords may come between 'verts' and the vertex lines: the section carries on.)
                if key == 'obj_file':
                    self.obj_file = os.path.join(self.dir, p[1])
                elif key == 'material':
                    self.material = os.path.join(self.dir, p[1])
                elif key in ('x_scale', 'y_scale', 'z_scale'):
                    self.scale['xyz'.index(key[0])] = (int(p[1]), int(p[2]), float(p[3]))
                elif key == 'z_depth':
                    self.z_depth = int(p[1])
                elif key == 'vertexboneweights_file':
                    self.weights_file = os.path.join(self.dir, p[1])
                elif key == 'tag':
                    self.tags.append(' '.join(p[1:]).lower())
                elif key == 'name':
                    self.name = p[1]
        self.ref = np.array(self.ref, dtype=np.int32)
        self.w = np.array(self.w)
        self.off = np.array(self.off)
        self.mesh = Obj(self.obj_file) if self.obj_file else None

    def scales(self, v):
        s = np.ones(3)
        for n in range(3):
            if self.scale[n]:
                a, b, den = self.scale[n]
                s[n] = abs(v[a][n] - v[b][n]) / den
        return s

    def fit(self, v):
        """Vertex positions over a body v (decimetres)."""
        return (v[self.ref] * self.w[:, :, None]).sum(1) + self.off * self.scales(v)

    def texture(self):
        """The diffuse texture named by the proxy's material, if any."""
        if not self.material or not os.path.exists(self.material):
            return None
        with open(self.material, encoding='utf-8', errors='replace') as f:
            for line in f:
                p = line.split()
                if len(p) >= 2 and p[0] == 'diffuseTexture':
                    t = os.path.join(os.path.dirname(self.material), p[1])
                    return t if os.path.exists(t) else None
        return None


def proxy(kind, name):
    d = os.path.join(ASSETS, kind, name)
    for ext in ('.mhclo', '.proxy'):
        p = os.path.join(d, name + ext)
        if os.path.exists(p):
            return Proxy(p)
    raise FileNotFoundError(d)
