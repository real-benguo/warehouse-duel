# -*- coding: utf-8 -*-
"""用 Blender 渲染预览图，肉眼检查模型外形
用法: blender --background --factory-startup --python tools/preview.py
"""
import bpy
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODELS = os.path.join(ROOT, "assets", "models")
OUT = os.path.join(HERE, "preview")
os.makedirs(OUT, exist_ok=True)


def wipe():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def setup_render(w=960, h=720):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.08, 0.09, 0.11, 1)
        bg.inputs[1].default_value = 1.6
    if sc.render.engine == "BLENDER_WORKBENCH":
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'MATERIAL'
        sh.show_shadows = True
        sh.show_cavity = True


def add_light(loc, energy=800, size=4.0):
    d = bpy.data.lights.new("L", type='AREA')
    d.energy = energy
    d.size = size
    o = bpy.data.objects.new("L", d)
    o.location = loc
    bpy.context.collection.objects.link(o)
    return o


def add_cam(loc, rot, lens=35.0):
    c = bpy.data.cameras.new("C")
    c.lens = lens
    o = bpy.data.objects.new("C", c)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.collection.objects.link(o)
    bpy.context.scene.camera = o
    return o


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDERED", os.path.basename(path))


def import_glb(name):
    p = os.path.join(MODELS, name)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    return [o for o in bpy.data.objects if o not in before]


def unparent_keep_world(objs):
    """把导入器加在父物体上的坐标转换清掉，让这些物体直接活在世界空间里"""
    for o in objs:
        if o.parent is not None:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- 枪械
def preview_guns():
    wipe()
    setup_render(1280, 720)
    import_glb("weapons.glb")
    add_light((2, -3, 3), 1500, 6)

    roots = {}
    for o in bpy.data.objects:
        if o.name.startswith("wpn_"):
            roots[o.name] = o
    base = {}
    for k, r in roots.items():
        base[k] = (tuple(r.location), tuple(r.rotation_euler))
    for k, r in list(roots.items())[:1]:
        print("CHECK", k, "loc", ["%.2f" % v for v in r.location],
              "rot", ["%.1f" % math.degrees(a) for a in r.rotation_euler])

    def place(key, loc, drot=(0, 0, 0)):
        r = roots[key]
        r.location = loc
        bl, br = base[key]
        r.rotation_euler = (br[0] + math.radians(drot[0]),
                            br[1] + math.radians(drot[1]),
                            br[2] + math.radians(drot[2]))

    order = ["wpn_assault", "wpn_smg", "wpn_shotgun", "wpn_sniper",
             "wpn_pistol", "wpn_lmg"]
    order = [k for k in order if k in roots]

    # 俯视：枪口朝 +Y（不变），沿 X 并排（俯视图里横向）
    n = len(order)
    for i, key in enumerate(order):
        place(key, ((i - (n - 1) / 2.0) * 1.30, -0.20, 0.0), (0, 0, 0))
    add_cam((0.0, 0.0, 8.0), (0, 0, 0), 28)
    bpy.context.view_layer.update()
    print("TOP_LOCS", [(k, ["%.2f" % v for v in roots[k].location])
                       for k in order])
    render(os.path.join(OUT, "01_guns_top.png"))

    # 斜 3/4
    add_cam((4.0, -3.4, 2.6), (math.radians(66), 0, math.radians(50)), 45)
    render(os.path.join(OUT, "01b_guns_iso.png"))

    # 单把枪第一人称视角：枪留在原点，把相机放到"眼睛"的位置
    # 枪在世界空间指向 +Y，机匣尾端在原点，枪托向 -Y 伸到 -0.31
    # 眼睛放在尾端后上方 —— 枪托被近裁剪面切掉（真实 FPS 视角就是这样）
    for key in order:
        for k2 in roots:
            roots[k2].location = (1000.0, 0.0, 0.0)
        place(key, (0.0, 0.0, 0.0), (0, 0, 0))
        bpy.context.view_layer.update()
        add_cam((-0.15, -0.26, 0.10), (math.radians(90), 0, 0), 22)
        render(os.path.join(OUT, "02_gun_fp_%s.png" % key.replace("wpn_", "")))


# ---------------------------------------------------------------- 场景
def preview_arena():
    wipe()
    setup_render(1280, 800)
    import_glb("arena.glb")
    add_light((0, 0, 14), 3000, 20)
    add_cam((0, 0, 34), (0, 0, 0), 32)
    render(os.path.join(OUT, "03_arena_top.png"))
    add_cam((0, -30, 24), (math.radians(52), 0, 0), 34)
    render(os.path.join(OUT, "04_arena_iso.png"))
    # 出生点 A (-15.5, 0, 0) 朝 +X  -> Blender (x, -z, y) = (-15.5, 0, 1.7)
    add_cam((-15.5, 0.0, 1.7), (math.radians(90), 0, math.radians(-90)), 55)
    render(os.path.join(OUT, "05_arena_playerA.png"))
    add_cam((0.0, -4.0, 1.7), (math.radians(90), 0, math.radians(180)), 55)
    render(os.path.join(OUT, "06_arena_mid.png"))
    add_cam((15.5, 0.0, 1.7), (math.radians(90), 0, math.radians(90)), 55)
    render(os.path.join(OUT, "06b_arena_playerB.png"))


# ---------------------------------------------------------------- 敌人
def preview_enemy():
    wipe()
    setup_render(900, 800)
    import_glb("enemy.glb")
    add_light((2, 3, 3), 1400, 5)
    # 敌人世界空间朝 +Y，正面在 +Y 侧 -> 相机放在 +Y 看回来
    add_cam((0, 4.0, 1.1), (math.radians(88), 0, math.radians(180)), 50)
    render(os.path.join(OUT, "07_enemy_front.png"))
    add_cam((2.6, 2.6, 1.4), (math.radians(80), 0, math.radians(135)), 50)
    render(os.path.join(OUT, "08_enemy_3q.png"))
    add_cam((4.0, 0.0, 1.1), (math.radians(88), 0, math.radians(90)), 50)
    render(os.path.join(OUT, "09_enemy_side.png"))


def main():
    preview_guns()
    preview_arena()
    preview_enemy()
    print("PREVIEW_DONE")


if __name__ == "__main__":
    main()
