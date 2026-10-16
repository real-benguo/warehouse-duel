# -*- coding: utf-8 -*-
"""诊断：导入 weapons.glb 后，量出各层级的世界包围盒与父子关系"""
import bpy
import os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODELS = os.path.join(ROOT, "assets", "models")

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, "weapons.glb"))

print("TOTAL_OBJECTS", len(bpy.data.objects))
tops = [o for o in bpy.data.objects if o.parent is None]
print("TOP_LEVEL", [(o.name, o.type) for o in tops])


def wbbox(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


def subtree(o):
    out = [o]
    for c in o.children:
        out += subtree(c)
    return out


for t in tops:
    st = subtree(t)
    mn, mx = wbbox(st)
    print("ROOT %-16s children=%2d bbox x[%.2f %.2f] y[%.2f %.2f] z[%.2f %.2f]"
          % (t.name, len(st) - 1, mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]))

# 看一个具体网格的父链
for o in bpy.data.objects:
    if o.name.startswith("receiver"):
        chain = []
        p = o
        while p is not None:
            chain.append(p.name)
            p = p.parent
        print("CHAIN receiver:", " <- ".join(chain))
        print("  world loc", ["%.3f" % v for v in o.matrix_world.translation])
        break
print("DIAG_DONE")
