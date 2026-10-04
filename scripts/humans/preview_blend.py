# Blender preview of MakeHuman bodies from mh.py, in a row (dev aid):
#   blender -b --python scripts/humans/preview_blend.py -- out.png "spec;spec;..." [view] [texture]
# spec: sex,age,muscle,weight,african,asian,caucasian  (sex M/F, age in MakeHuman years)
# view: front | face | side
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import mh  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
SPECS = [s.split(',') for s in argv[1].split(';') if s]
VIEW = argv[2] if len(argv) > 2 else 'front'
TEX = argv[3] if len(argv) > 3 else ''

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
b = mh.base()
body_faces = [i for i, g in enumerate(b.fg) if g == b.groups['body']]
used = sorted({v for i in body_faces for v in b.fv[i]})


def mesh_for(v, name, x):
    me = bpy.data.meshes.new(name)
    co = v[used] * mh.UNIT
    remap = {o: n for n, o in enumerate(used)}
    faces = [[remap[i] for i in b.fv[f]] for f in body_faces]
    # MakeHuman: y up, facing +z → Blender: z up, facing -y
    verts = [(p[0] + x, -p[2], p[1]) for p in co]
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    li = 0
    for f in body_faces:
        for t in b.ft[f]:
            uv.data[li].uv = b.vt[t]
            li += 1
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    scn.collection.objects.link(o)
    return o


mat = bpy.data.materials.new('Skin')
mat.use_nodes = True
if TEX:
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(TEX)
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
else:
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.62, 0.52, 1)

x = 0.0
tops = []
for i, s in enumerate(SPECS):
    sex, age, muscle, weight, af, asn, ca = s
    w = mh.macro_weights(1.0 if sex == 'M' else 0.0, mh.age_years_to_value(float(age)), float(muscle), float(weight), {'african': float(af), 'asian': float(asn), 'caucasian': float(ca)})
    v = mh.evaluate(w)
    v[:, 1] -= v[used, 1].min()
    if VIEW == 'face':
        # every head at the same height: eyes on one line
        eye = mh.joint(v, 'eye.L____head')[1]
        v[:, 1] += 15.75 - eye
    o = mesh_for(v, f'b{i}', x)
    o.data.materials.append(mat)
    h = (v[used, 1].max()) * mh.UNIT
    tops.append((x, h))
    x += 0.62 if VIEW != 'face' else 0.42

scn.render.engine = 'BLENDER_WORKBENCH'
scn.display.shading.light = 'STUDIO'
scn.display.shading.color_type = 'TEXTURE' if TEX else 'MATERIAL'
scn.display.shading.show_cavity = False
cam = bpy.data.cameras.new('C')
cam.type = 'ORTHO'
co = bpy.data.objects.new('C', cam)
scn.collection.objects.link(co)
scn.camera = co
if VIEW in ('face', 'face3'):
    # one shot per head, composited into a row afterwards
    from PIL import Image
    scn.render.resolution_x = 360
    scn.render.resolution_y = 420
    cam.ortho_scale = 0.34
    shots = []
    objs = [o for o in scn.objects if o.name.startswith('b')]
    for i, o in enumerate(objs):
        for p in objs:
            p.hide_render = p is not o
        xo = tops[i][0]
        if VIEW == 'face':
            co.location = (xo, -4, 1.575)
            co.rotation_euler = (math.pi / 2, 0, 0)
        else:
            a = math.radians(35)
            co.location = (xo + 4 * math.sin(a), -4 * math.cos(a), 1.575)
            co.rotation_euler = (math.pi / 2, 0, a)
        scn.render.filepath = OUT + f'.{i}.png'
        bpy.ops.render.render(write_still=True)
        shots.append(OUT + f'.{i}.png')
    ims = [Image.open(f) for f in shots]
    row = Image.new('RGB', (360 * len(ims), 420), (200, 200, 200))
    for i, im in enumerate(ims):
        row.paste(im, (360 * i, 0))
        os.remove(shots[i])
    row.save(OUT)
    print('saved', OUT)
    raise SystemExit
scn.render.resolution_x = 1800
scn.render.resolution_y = 900
mid = x / 2 - 0.31
if VIEW == 'side':
    cam.ortho_scale = x + 0.2
    co.location = (mid, -4, 0.95)
    co.rotation_euler = (math.pi / 2, 0, math.radians(-35))
else:
    cam.ortho_scale = x + 0.2
    co.location = (mid, -4, 0.95)
    co.rotation_euler = (math.pi / 2, 0, 0)
scn.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('saved', OUT)
