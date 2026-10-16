# -*- coding: utf-8 -*-
"""决定性测试：导入 weapons.glb，把 6 把枪沿 X 排开，打印各自的世界包围盒
与相机投影位置，确认它们真的分开了。"""
import bpy
import os
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODELS = os.path.join(ROOT, "assets", "models")

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, "weapons.glb"))

roots = [o for o in bpy.data.objects
         if o.parent is None and o.name.startswith("wpn_")]
roots.sort(key=lambda o: o.name)
order = ["wpn_assault", "wpn_smg", "wpn_shotgun", "wpn_sniper",
         "wpn_pistol", "wpn_lmg"]
byname = {o.name: o for o in roots}

for i, k in enumerate(order):
    byname[k].location = ((i - 2.5) * 1.30, -0.20, 0.0)

cam_data = bpy.data.cameras.new("C")
cam_data.lens = 28
cam = bpy.data.objects.new("C", cam_data)
cam.location = (0, 0, 8)
cam.rotation_euler = (0, 0, 0)
bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam
bpy.context.view_layer.update()


def wbbox(o):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    stack = [o]
    while stack:
        x = stack.pop()
        stack += list(x.children)
        if x.type != 'MESH':
            continue
        for c in x.bound_box:
            w = x.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


for k in order:
    o = byname[k]
    mn, mx = wbbox(o)
    # 投影：取包围盒中心和前端
    ctr = (mn + mx) * 0.5
    p = world_to_camera_view(bpy.context.scene, cam, ctr)
    print("%-13s world x[%6.2f %6.2f] y[%6.2f %6.2f] z[%6.2f %6.2f]  screen(%.2f, %.2f)"
          % (k, mn[0], mx[0], mn[1], mx[1], mn[2], mx[2], p.x, p.y))

print("TEST_DONE")
