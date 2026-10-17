# The wardrobe: MakeHuman's clothes (CC0), each outfit split into the
# garments it is made of (a shirt, the jeans under it), so people can wear
# any top with any bottoms, every garment recoloured per person. Each garment
# keeps MakeHuman's binding to the body (it fits any body the way MakeHuman
# fits it), hides the body under it (the faces all of whose corners the
# outfit hid), and carries its texture's shading (folds, seams, wear) as
# brightness in a shared atlas, so any colour can be painted over it.
import os
from collections import defaultdict

import numpy as np
from PIL import Image

import mh
import textures as tx


def components(m):
    """Connected parts of a mesh (vertex sets), largest first."""
    adj = defaultdict(set)
    for fv in m.fv:
        for i in fv:
            adj[i].update(fv)
    seen = set()
    out = []
    for s in range(len(m.v)):
        if s in seen:
            continue
        st = [s]
        seen.add(s)
        c = []
        while st:
            x = st.pop()
            c.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    st.append(y)
        out.append(set(c))
    return sorted(out, key=len, reverse=True)


class Part:
    """A garment cut from an outfit: the proxy's vertices it uses, its faces, the body it hides, its colour slots."""

    def __init__(self, gid, proxy, verts, slots_of_face=None, slots=('main',)):
        self.id = gid
        self.p = proxy
        self.verts = sorted(verts)
        vs = set(self.verts)
        self.faces = [f for f, fv in enumerate(proxy.mesh.fv) if all(v in vs for v in fv)]
        self.slots = list(slots)
        self.face_slot = slots_of_face or (lambda f: 0)
        self.deletes = []


# Which part of each outfit is which garment: (garment id, source outfit, component indices, slots).
SPEC = [
    ('m_tee', 'male_casualsuit04', 'top'),
    ('m_jeans', 'male_casualsuit04', 'bottom'),
    ('m_longtee', 'male_casualsuit02', 'top'),
    ('m_shirt', 'male_casualsuit03', 'top'),
    ('m_jacket', 'male_casualsuit05', 'top'),
    ('m_suit', 'male_elegantsuit01', 'top'),
    ('m_trousers', 'male_elegantsuit01', 'bottom'),
    ('m_overalls', 'male_worksuit01', 'overalls'),
    ('m_worktee', 'male_worksuit01', 'tee'),
    ('f_tee', 'female_casualsuit01', 'top'),
    ('f_jeans', 'female_casualsuit01', 'bottom'),
    ('f_shorts', 'female_casualsuit02', 'bottom'),
    ('f_blouse', 'female_elegantsuit01', 'top'),
    ('f_skirt', 'female_elegantsuit01', 'bottom'),
]
SHOES = ['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06']


def cut(proxy, which):
    """The vertices of an outfit's top or bottom (or a named piece of the work suit)."""
    cs = components(proxy.mesh)
    v = proxy.fit(mh.base().v)
    ymid = [np.mean([v[i][1] for i in c]) for c in cs]
    if proxy.name == 'male_worksuit01':
        # the overalls (the largest piece, with its buttons), the tee under them
        if which == 'overalls':
            return set().union(*[c for c in cs if c is not cs[1]])
        return cs[1]
    if proxy.name == 'female_casualsuit02' and which == 'bottom':
        # the shorts and their belt
        return set().union(*[c for c, y in zip(cs, ymid) if y < 1.4])
    tops = [c for c, y in zip(cs, ymid) if y >= 1.5]
    bottoms = [c for c, y in zip(cs, ymid) if y < 1.5]
    return set().union(*(tops if which == 'top' else bottoms))


def assign_deletes(proxy, parts):
    """Share out the outfit's hidden body vertices: each to the part whose surface lies nearest to it."""
    b = mh.base()
    fitted = proxy.fit(b.v)
    pts = [(fitted[list(p.verts)], p) for p in parts]
    for d in proxy.delete:
        if d >= 13380:
            continue
        best = min(pts, key=lambda t: np.min(np.sum((t[0] - b.v[d]) ** 2, axis=1)))
        best[1].deletes.append(d)


def hidden_triangles(body_faces, tri_of_face, deletes):
    """The body's triangles a garment hides: those of the faces all of whose corners it hides (MakeHuman's rule)."""
    b = mh.base()
    D = set(deletes)
    out = []
    for fi, f in enumerate(body_faces):
        if all(v in D for v in b.fv[f]):
            out.extend(tri_of_face[fi])
    return out


# Outfits woven in stripes: their shading is taken smoothed well past the stripes.
STRIPED = {'male_casualsuit03', 'female_elegantsuit01'}


def detail_map(tex_path, size, uvs_by_slot, original=False, striped=False, sub=None):
    """The texture's shading as brightness around 1 (stored x0.5 in red and blue), each slot region on its own:
    prints, logos and piping (colour or brightness far from the region's own) painted out, fine stripes smoothed,
    nothing from outside the region mixed in; green holds which of a garment's colours each texel takes (sub: 0, 1 or
    2, stored as 0, 0.5, 1; nought when not given). original=True keeps the texture's colours instead (shoes)."""
    im = Image.open(tex_path).convert('RGB').resize((size, size), Image.LANCZOS)
    srgb = np.asarray(im, dtype=np.float64) / 255.0
    rgb = tx.srgb_to_lin(srgb)
    L = tx.lum(rgb)
    out = np.full((size, size, 3), 0.5)
    known = np.zeros((size, size), dtype=bool)
    for slot, mask in uvs_by_slot.items():
        if not mask.any():
            continue
        known |= mask
        if original:
            out[mask] = srgb[mask]
            continue
        inner = mask & (tx.blur(mask.astype(np.float64), 1.0) > 0.9)
        stat = inner if inner.sum() > 50 else mask
        if striped:
            clean = tx.normalized_blur(L, mask.astype(np.float64), 6.0)
            mean = clean[stat].mean()
            out[mask] = (np.clip(clean / mean, 0.6, 1.4) * 0.5)[mask][:, None]
            continue
        chroma = rgb / np.maximum(L[..., None], 1e-4)
        med = np.median(chroma[stat], axis=0)
        Lm = np.median(L[stat])
        far = mask & ((np.sqrt(((chroma - med) ** 2).sum(-1)) > 0.4) | (L > Lm * 2.2) | (L < Lm * 0.3))
        far = mask & (tx.blur(far.astype(np.float64), 1.5) > 0.1)
        good = (mask & ~far).astype(np.float64)
        clean = L.copy()
        for r in (24, 12, 6, 3):
            fill = tx.normalized_blur(clean, good, r)
            clean = np.where(far, fill, clean)
        # Smooth within the region only (the texel outside it is another island or background).
        clean = tx.normalized_blur(clean, mask.astype(np.float64), 1.0)
        mean = clean[stat].mean()
        d = np.clip(clean / mean, 0.55, 1.45) * 0.5
        out[mask] = d[mask][:, None]
    if not original:
        out[..., 1] = 0.0 if sub is None else np.clip(sub, 0, 2) * 0.5
    return tx.dilate_colors(out, known, 8)


def uv_region(mesh, faces, size):
    im = Image.new('L', (size, size), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for f in faces:
        pts = [(mesh.vt[t][0] * size, (1 - mesh.vt[t][1]) * size) for t in mesh.ft[f]]
        d.polygon(pts, fill=255, outline=255)
    return np.asarray(im) > 127


def suit_slots(proxy, part):
    """Colour slots within a garment: the suit's jacket, shirt and tie (told apart texel by texel, see texel_slots);
    every face takes the garment's first slot."""
    if proxy.name != 'male_elegantsuit01' or part != 'top':
        return None, ('main',)
    return (lambda f: 0), ('main', 'shirt', 'tie')


def texel_slots(tex_path, size, region):
    """The suit's texels told apart (within its region): 2 the tie (the blue of its cloth, its pale stripes closed
    over), 1 the shirt (its collar, front and cuffs: pale and grey), 0 the jacket (dark)."""
    im = Image.open(tex_path).convert('RGB').resize((size, size), Image.LANCZOS)
    srgb = np.asarray(im, dtype=np.float64) / 255.0
    L = srgb.mean(-1)
    blue = (srgb[..., 2] - srgb[..., 0] > 0.07) & (srgb[..., 2] > 0.2) & region
    # Close the tie's stripes into it (a blur and threshold), and keep it to where the blue is.
    near = tx.blur(blue.astype(np.float64), 2.5 * size / 512) > 0.18
    tie = near & region & (tx.blur(blue.astype(np.float64), 6.0 * size / 512) > 0.12)
    shirt = region & ~tie & (L > 0.42)
    out = np.zeros((size, size), dtype=np.int32)
    out[shirt] = 1
    out[tie] = 2
    return out


def body_triangles(b):
    """The base mesh's body as triangles (vertex index triples), and their unit normals as modelled."""
    g = b.groups['body']
    tris = []
    for f, x in enumerate(b.fg):
        if x != g:
            continue
        vs = b.fv[f]
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    tris = np.array(tris)
    n = np.cross(b.v[tris[:, 1]] - b.v[tris[:, 0]], b.v[tris[:, 2]] - b.v[tris[:, 0]])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return tris, n


def group_triangles(b, group):
    g = b.groups[group]
    tris = []
    for f, x in enumerate(b.fg):
        if x != g:
            continue
        vs = b.fv[f]
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    return np.array(tris)


def boundary_loops(fv):
    """The open edges of a mesh (faces as vertex lists) chained into loops (lists of vertices)."""
    use = defaultdict(int)
    for vs in fv:
        for k in range(len(vs)):
            a, c = vs[k], vs[(k + 1) % len(vs)]
            use[(min(a, c), max(a, c))] += 1
    nxt = defaultdict(list)
    for (a, c), n in use.items():
        if n == 1:
            nxt[a].append(c)
            nxt[c].append(a)
    seen = set()
    loops = []
    for s in nxt:
        if s in seen:
            continue
        loop = [s]
        seen.add(s)
        cur = s
        while True:
            step = [w for w in nxt[cur] if w not in seen]
            if not step:
                break
            cur = step[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return loops


def lengthen(sub, b, drop, rows=4):
    """A top made longer: its hem, and the rows of the garment above it, moved down the body (the hem by `drop`
    decimetres, each row above by less), each as far off the skin as it lay, and bound to the tights helper again
    where it now lies (as MakeHuman binds clothes)."""
    pos = (b.v[sub.ref] * sub.w[:, :, None]).sum(1) + sub.off
    fv = sub.mesh.fv
    # The hem: the bottom of the open loop round the trunk lowest down (not a cuff: those lie out along the arms; and
    # not the rest of that loop, which in a top open down the front runs on up to the collar).
    loops = [l for l in boundary_loops(fv) if abs(np.mean(pos[l][:, 0])) < 1.0 and len(l) > 12]
    low = min(loops, key=lambda l: np.min(pos[l][:, 1]))
    bottom = np.min(pos[low][:, 1])
    hem = [v for v in low if pos[v][1] < bottom + 0.6]
    # Rows above it, by steps along the garment's edges.
    adj = defaultdict(set)
    for vs in fv:
        for k in range(len(vs)):
            adj[vs[k]].add(vs[(k + 1) % len(vs)])
            adj[vs[(k + 1) % len(vs)]].add(vs[k])
    row = {v: 0 for v in hem}
    q = list(hem)
    while q:
        nq = []
        for v in q:
            for w in adj[v]:
                if w not in row and row[v] + 1 < rows:
                    row[w] = row[v] + 1
                    nq.append(w)
        q = nq
    tris, tn = body_triangles(b)
    cen = b.v[tris].mean(1)

    def nearest(p):
        """The nearest point on the body to p and that triangle's normal (from the triangles round about it)."""
        near = np.nonzero(((cen - p) ** 2).sum(1) < 2.0 ** 2)[0]
        t = tris[near]
        q, _ = closest_on_triangles(p, b.v[t[:, 0]], b.v[t[:, 1]], b.v[t[:, 2]])
        k = int(np.argmin(((q - p) ** 2).sum(1)))
        return q[k], tn[near[k]]

    moved = sorted(row)
    new = []
    for v in moved:
        p = pos[v]
        q0, n0 = nearest(p)
        lift = max(float(np.dot(p - q0, n0)), 0.05)
        target = p - np.array([0.0, drop * (1 - row[v] / rows), 0.0])
        q1, n1 = nearest(target)
        new.append(q1 + n1 * lift)
    ref, w, off = auto_bind(np.array(new), b.v, group_triangles(b, 'helper-tights'))
    for i, v in enumerate(moved):
        sub.ref[v] = ref[i]
        sub.w[v] = w[i]
        sub.off[v] = off[i]
    return len(moved)


def ring_rows(b, group):
    """The rings of a tube-shaped helper (the skirt), counted down from its top edge: {vertex: ring}."""
    g = b.groups[group]
    faces = [i for i, x in enumerate(b.fg) if x == g]
    fv = [b.fv[f] for f in faces]
    loops = boundary_loops(fv)
    top = max(loops, key=lambda l: np.mean(b.v[l][:, 1]))
    adj = defaultdict(set)
    for vs in fv:
        for k in range(len(vs)):
            adj[vs[k]].add(vs[(k + 1) % len(vs)])
            adj[vs[(k + 1) % len(vs)]].add(vs[k])
    ring = {v: 0 for v in top}
    q = list(top)
    while q:
        nq = []
        for v in q:
            for w in adj[v]:
                if w not in ring:
                    ring[w] = ring[v] + 1
                    nq.append(w)
        q = nq
    return ring


# ── Garments made here: the sari's pallu (the end of the sari, draped from the waist across the body over the left
# shoulder and down the back) ──

def closest_on_triangles(p, A, B, C):
    """For point p, the closest point on each triangle (A, B, C arrays (T, 3)) and its barycentric weights."""
    ab = B - A
    ac = C - A
    ap = p - A
    d1 = (ab * ap).sum(1)
    d2 = (ac * ap).sum(1)
    bp = p - B
    d3 = (ab * bp).sum(1)
    d4 = (ac * bp).sum(1)
    cp = p - C
    d5 = (ab * cp).sum(1)
    d6 = (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) < 1e-12, 1e-12, va + vb + vc)
    v = vb / den
    w = vc / den
    # Fall back to the edges and corners where the projection falls outside (clamped, which is close enough for binding).
    v = np.clip(v, 0, 1)
    w = np.clip(w, 0, 1)
    s = v + w
    over = s > 1
    v = np.where(over, v / s, v)
    w = np.where(over, w / s, w)
    u = 1 - v - w
    q = A * u[:, None] + B * v[:, None] + C * w[:, None]
    return q, np.stack([u, v, w], axis=1)


def auto_bind(points, verts, tris):
    """Bind points to a surface (vertex positions, triangles as index triples): three vertices, weights and offset."""
    A, B, C = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    ref = np.zeros((len(points), 3), dtype=np.int64)
    w = np.zeros((len(points), 3))
    off = np.zeros((len(points), 3))
    for i, p in enumerate(points):
        q, bc = closest_on_triangles(p, A, B, C)
        k = int(np.argmin(((q - p) ** 2).sum(1)))
        ref[i] = tris[k]
        w[i] = bc[k]
        off[i] = p - q[k]
    return ref, w, off


def surface_hit(origin, direction, verts, tris):
    """Where a ray first meets the surface (Möller–Trumbore over all triangles), or None."""
    A, B, C = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    e1 = B - A
    e2 = C - A
    h = np.cross(direction, e2)
    a = (e1 * h).sum(1)
    ok = np.abs(a) > 1e-9
    f = np.where(ok, 1 / np.where(ok, a, 1), 0)
    s = origin - A
    u = f * (s * h).sum(1)
    q = np.cross(s, e1)
    v = f * (q * direction).sum(1)
    t = f * (e2 * q).sum(1)
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    if not hit.any():
        return None
    t = np.where(hit, t, np.inf)
    return origin + direction * t.min()


# Across the pallu: the border (a narrow band at each edge), then the body of the cloth.
ACROSS = [0.0, 0.07, 0.25, 0.5, 0.75, 0.93, 1.0]


def pallu(b, tight_group='helper-tights', width=2.4, lift=0.32, segments=44):
    """The pallu as a band of quads (base-mesh decimetres): from the right of the waist in front, up across the
    chest to the left shoulder, over it, and down the back to the hips; its edges are the border. Returns
    (vertices, faces (quads), slot per face, uvs)."""
    g = b.groups[tight_group]
    faces = [f for f, x in enumerate(b.fg) if x == g]
    tris = []
    for f in faces:
        vs = b.fv[f]
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    tris = np.array(tris)
    V = b.v
    # The path, as (x, y, side): side +1 on the front, -1 on the back, 0 over the shoulder (cast from above).
    ctrl = [(-1.05, 0.7, 1), (-0.55, 1.9, 1), (0.05, 3.1, 1), (0.55, 4.1, 1), (0.95, 4.95, 1), (1.2, 5.3, 0), (1.05, 4.95, -1), (0.85, 3.8, -1), (0.7, 2.4, -1), (0.6, 0.9, -1), (0.55, -0.6, -1)]
    pts = np.array([(c[0], c[1]) for c in ctrl], dtype=np.float64)
    # Arc-length parameter, Catmull-Rom through the points.
    def cr(i, t):
        p0 = pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[min(i + 1, len(pts) - 1)]
        p3 = pts[min(i + 2, len(pts) - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    samples = []
    for i in range(len(pts) - 1):
        for k in range(8):
            t = k / 8
            xy = cr(i, t)
            side = ctrl[i][2] if t < 0.5 else ctrl[i + 1][2]
            samples.append((xy[0], xy[1], side))
    samples.append((pts[-1][0], pts[-1][1], ctrl[-1][2]))
    # Onto the body: cast from in front, behind, or above.
    centre = []
    normals = []
    for x, y, side in samples:
        if side > 0:
            o, d = np.array([x, y, 6.0]), np.array([0.0, 0.0, -1.0])
        elif side < 0:
            o, d = np.array([x, y, -6.0]), np.array([0.0, 0.0, 1.0])
        else:
            o, d = np.array([x, 9.0, 0.25]), np.array([0.0, -1.0, 0.0])
        hit = surface_hit(o, d, V, tris)
        if hit is None:
            continue
        centre.append(hit)
        normals.append(-d)
    centre = np.array(centre)
    normals = np.array(normals, dtype=np.float64)
    # Smooth the normals along the band (the shoulder turns them from front to top to back), then resample evenly.
    for _ in range(6):
        normals[1:-1] = (normals[:-2] + normals[1:-1] * 2 + normals[2:]) / 4
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    seg = np.linalg.norm(np.diff(centre, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    even = np.linspace(0, s[-1], segments + 1)
    C = np.stack([np.interp(even, s, centre[:, k]) for k in range(3)], axis=1)
    N = np.stack([np.interp(even, s, normals[:, k]) for k in range(3)], axis=1)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    Wd = np.cross(N, T)
    Wd /= np.linalg.norm(Wd, axis=1, keepdims=True)
    verts = []
    uvs = []
    across = len(ACROSS)
    for i in range(segments + 1):
        # Narrower where it gathers over the shoulder.
        f = i / segments
        wid = width * (1 - 0.38 * np.exp(-((f - 0.52) / 0.09) ** 2))
        for j, fr in enumerate(ACROSS):
            a = (fr - 0.5) * wid
            verts.append(C[i] + Wd[i] * a + N[i] * lift)
            uvs.append((fr, f))
    verts = np.array(verts)
    quads = []
    slot = []
    for i in range(segments):
        for j in range(across - 1):
            a = i * across + j
            quads.append([a, a + across, a + across + 1, a + 1])
            slot.append(1 if j == 0 or j == across - 2 else 0)
    return verts, quads, slot, np.array(uvs)
