# -*- coding: utf-8 -*-
"""
FPS Duel - Blender 参数化建模脚本
用法:  blender --background --factory-startup --python tools/build_assets.py

产出:
  assets/models/weapons.glb   6 把枪（含第一人称双手），每把枪一个根节点 wpn_<id>
  assets/models/arena.glb     仓库场景道具
  assets/models/enemy.glb     低多边形敌人（腿部可动，用于走路动画）
  assets/map.json             碰撞盒 / 出生点 / 灯光（与 GLB 同坐标系，供 Three.js 用）
  assets/weapons.json         每把枪的枪口 / 抛壳口 / 准心锚点（枪本地坐标）

坐标系
  glTF   : X 右, Y 上, Z 后（-Z 为前方）
  Blender: X 右, Y 前, Z 上
  转换   : blender(x, -z, y) <-> gltf(x, y, z)
"""

import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
MODELS = os.path.join(ASSETS, "models")
os.makedirs(MODELS, exist_ok=True)

# ---------------------------------------------------------------- 颜色

def s2l(v):
    c = v / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(r, g, b):
    return (s2l(r), s2l(g), s2l(b))


C_METAL_D = rgb(64, 68, 76)
C_METAL_M = rgb(90, 95, 104)
C_POLY = rgb(45, 48, 54)
C_WOOD = rgb(112, 74, 42)
C_ACCENT = rgb(196, 92, 36)
C_STEEL = rgb(120, 124, 132)

C_CONCRETE = rgb(96, 96, 92)
C_CONCRETE_D = rgb(66, 66, 64)
C_CRATE = rgb(128, 92, 52)
C_CRATE_D = rgb(92, 64, 36)
C_CONT_RED = rgb(140, 54, 44)
C_CONT_BLUE = rgb(42, 76, 122)
C_CONT_GREEN = rgb(56, 96, 68)
C_CONT_RUST = rgb(122, 84, 56)
C_BARREL_B = rgb(38, 84, 132)
C_BARREL_R = rgb(150, 60, 44)
C_FLOOR = rgb(50, 50, 49)
C_WALL = rgb(96, 96, 92)
C_WALL_D = rgb(96, 96, 92)
C_LAMP = rgb(255, 236, 196)
C_TRUSS = rgb(92, 92, 96)

C_ENEMY_BODY = rgb(52, 56, 62)
C_ENEMY_LIMB = rgb(42, 45, 50)
C_ENEMY_ACCENT = rgb(206, 96, 30)
C_ENEMY_VISOR = rgb(226, 138, 48)

_MATS = {}


def M(name, col, metallic=0.0, rough=0.6, emit=None, emit_str=0.0):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (emit[0], emit[1], emit[2], 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_str
    _MATS[name] = m
    return m


# ---------------------------------------------------------------- 几何

def do_bevel(bm, width, segments=1):
    if width <= 0:
        return
    edges = list(bm.edges)
    try:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET',
                        segments=segments, profile=0.5, affect='EDGES',
                        clamp_overlap=True)
    except TypeError:
        try:
            bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET',
                            segments=segments, profile=0.5, vertex_only=False,
                            clamp_overlap=True)
        except Exception:
            pass
    except Exception:
        pass


def bm_box(sx, sy, sz, bev=0.008):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    do_bevel(bm, bev)
    bm.normal_update()
    return bm


def bm_cyl(r, depth, seg=14, bev=0.0, axis='Z', caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg,
                          radius1=r, radius2=r, depth=depth)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
    elif axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    do_bevel(bm, bev)
    bm.normal_update()
    return bm


def new_obj(name, bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def new_joint(name, bm, mat, offset, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    """把网格相对物体原点偏移后再建物体 —— 让物体原点落在关节上，便于动画旋转"""
    bmesh.ops.translate(bm, verts=bm.verts, vec=offset)
    return new_obj(name, bm, mat, loc, rot, parent)


def add_box(name, mat, center, size, parent=None, bev=0.008, rot=(0, 0, 0)):
    return new_obj(name, bm_box(size[0], size[1], size[2], bev), mat,
                   center, rot, parent)


def add_cyl(name, mat, center, r, depth, axis='Z', parent=None, seg=14,
            bev=0.0, rot=(0, 0, 0), caps=True):
    return new_obj(name, bm_cyl(r, depth, seg, bev, axis, caps), mat,
                   center, rot, parent)


def new_empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.12
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def limb(name, mat, A, B, w, parent, bev=0.014):
    """从 A 到 B 画一根方柱（长轴对齐 A->B）"""
    A = Vector(A)
    B = Vector(B)
    d = B - A
    L = max(1e-4, d.length)
    mid = (A + B) * 0.5
    rot = d.to_track_quat('Z', 'Y').to_euler()
    return new_obj(name, bm_box(w, w, L, bev), mat, tuple(mid), tuple(rot),
                   parent)


def ik2(S, H, L1, L2, pole):
    """两段 IK，返回肘关节位置"""
    S = Vector(S)
    H = Vector(H)
    pole = Vector(pole)
    d = H - S
    dist = d.length
    if dist < 1e-5:
        return S + Vector((0, 0, -L1))
    dist = max(abs(L1 - L2) + 1e-3, min(L1 + L2 - 1e-3, dist))
    a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, L1 * L1 - a * a))
    n = d.normalized()
    p = pole - n * pole.dot(n)
    if p.length < 1e-6:
        p = Vector((0, 0, -1))
    p.normalize()
    return S + n * a + p * h


# ---------------------------------------------------------------- 场景

def wipe():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                  bpy.data.cameras):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass
    _MATS.clear()


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    base = dict(filepath=path, export_format='GLB', use_selection=True,
                export_apply=True)
    full = dict(base)
    full.update(dict(export_yup=True, export_cameras=False, export_lights=False,
                     export_extras=False, export_skins=False,
                     export_morph=False, export_animations=False))
    try:
        bpy.ops.export_scene.gltf(**full)
    except TypeError:
        bpy.ops.export_scene.gltf(**base)
    print("EXPORTED", os.path.basename(path), os.path.getsize(path), "bytes")


# ================================================================ 枪械

# 枪本地坐标: +Y 前（枪口）, +Z 上, +X 右；原点 = 机匣尾端膛线高度

GUNS = [
    dict(id="assault", label="AR-15 突击步枪",
         rec_len=0.40, rec_h=0.090, rec_w=0.060,
         barrel_len=0.30, barrel_r=0.014, hand_len=0.22, hand_r=0.032,
         mag_len=0.20, mag_tilt=8, mag_w=0.040, mag_y=0.19,
         stock_len=0.26, grip_len=0.135, sight="reddot", extra="none",
         body=C_METAL_D, furn=C_POLY, mag_c=C_POLY),
    dict(id="smg", label="MP 冲锋枪",
         rec_len=0.28, rec_h=0.080, rec_w=0.055,
         barrel_len=0.16, barrel_r=0.012, hand_len=0.14, hand_r=0.030,
         mag_len=0.22, mag_tilt=4, mag_w=0.036, mag_y=0.13,
         stock_len=0.18, grip_len=0.120, sight="reddot", extra="none",
         body=C_METAL_M, furn=C_POLY, mag_c=C_POLY),
    dict(id="shotgun", label="M 泵动霰弹枪",
         rec_len=0.34, rec_h=0.085, rec_w=0.058,
         barrel_len=0.44, barrel_r=0.019, hand_len=0.10, hand_r=0.030,
         mag_len=0.0, mag_tilt=0, mag_w=0.0, mag_y=0.0,
         stock_len=0.30, grip_len=0.110, sight="iron", extra="pump",
         body=C_METAL_D, furn=C_WOOD, mag_c=C_WOOD),
    dict(id="sniper", label="SR 栓动狙击枪",
         rec_len=0.42, rec_h=0.085, rec_w=0.056,
         barrel_len=0.56, barrel_r=0.013, hand_len=0.20, hand_r=0.028,
         mag_len=0.12, mag_tilt=6, mag_w=0.034, mag_y=0.17,
         stock_len=0.34, grip_len=0.130, sight="sniper", extra="bipod",
         body=C_METAL_M, furn=C_POLY, mag_c=C_POLY),
    dict(id="pistol", label="G 半自动手枪",
         rec_len=0.17, rec_h=0.055, rec_w=0.042,
         barrel_len=0.09, barrel_r=0.010, hand_len=0.0, hand_r=0.0,
         mag_len=0.0, mag_tilt=0, mag_w=0.0, mag_y=0.0,
         stock_len=0.0, grip_len=0.115, sight="iron", extra="none",
         body=C_METAL_D, furn=C_POLY, mag_c=C_POLY),
    dict(id="lmg", label="LMG 轻机枪",
         rec_len=0.46, rec_h=0.110, rec_w=0.075,
         barrel_len=0.40, barrel_r=0.018, hand_len=0.26, hand_r=0.036,
         mag_len=0.16, mag_tilt=0, mag_w=0.075, mag_y=0.22,
         stock_len=0.24, grip_len=0.140, sight="reddot", extra="heatshield",
         body=C_METAL_D, furn=C_POLY, mag_c=C_POLY),
]

ANCHORS = {}


def build_gun(g, root):
    body = M("g_body_" + g["id"], g["body"], 0.80, 0.38)
    furn = M("g_furn_" + g["id"], g["furn"], 0.12, 0.62)
    magm = M("g_mag_" + g["id"], g["mag_c"], 0.28, 0.55)
    steel = M("g_steel", C_STEEL, 0.90, 0.26)
    accent = M("g_accent", C_ACCENT, 0.40, 0.45)

    RL, RH, RW = g["rec_len"], g["rec_h"], g["rec_w"]
    bz = 0.010

    add_box("receiver", body, (0, RL / 2, 0), (RW, RL, RH), root, 0.006)
    add_box("rail", steel, (0, RL * 0.5, RH / 2 + 0.008),
            (RW * 0.5, RL * 0.92, 0.014), root, 0.003)
    add_box("ejectport", steel, (RW / 2 + 0.002, RL * 0.62, 0.006),
            (0.007, 0.085, 0.030), root, 0.002)

    bl, br = g["barrel_len"], g["barrel_r"]
    if bl > 0:
        add_cyl("barrel", steel, (0, RL + bl / 2, bz), br, bl, 'Y', root,
                14, 0.002)
        add_cyl("muzzle_dev", steel, (0, RL + bl - 0.032, bz), br * 1.75,
                0.068, 'Y', root, 12, 0.003)

    hl, hr = g["hand_len"], g["hand_r"]
    if hl > 0:
        add_box("handguard", furn, (0, RL + hl / 2 + 0.01, bz),
                (hr * 2, hl, hr * 2), root, 0.006)
        add_box("hg_rail", steel, (0, RL + hl / 2 + 0.01, bz - hr - 0.008),
                (hr * 0.9, hl * 0.8, 0.012), root, 0.003)

    sl = g["stock_len"]
    if sl > 0:
        add_box("stock", furn, (0, -sl / 2 - 0.01, -0.012),
                (RW * 0.86, sl, RH * 1.25), root, 0.006)
        add_box("buttpad", furn, (0, -sl - 0.028, -0.012),
                (RW * 0.95, 0.038, RH * 1.5), root, 0.005)
        add_box("cheek", furn, (0, -sl * 0.45, RH * 0.72),
                (RW * 0.7, sl * 0.6, 0.030), root, 0.005)
        add_box("sling", steel, (0, -sl - 0.045, -0.030),
                (0.014, 0.016, 0.030), root, 0.002)

    gl, ga = g["grip_len"], math.radians(-17)
    grip = add_box("grip", furn, (0, 0.072, -RH / 2 - gl * 0.44),
                   (RW * 0.78, 0.058, gl), root, 0.006)
    grip.rotation_euler = (ga, 0, 0)
    add_box("trigger_guard", body, (0, 0.035, -RH / 2 - 0.020),
            (0.026, 0.078, 0.010), root, 0.003)
    add_box("trigger", steel, (0, 0.040, -RH / 2 - 0.016),
            (0.010, 0.012, 0.028), root, 0.002)

    ml, mt, mw = g["mag_len"], g["mag_tilt"], g["mag_w"]
    if ml > 0 and mw > 0:
        mag = add_box("magazine", magm, (0, g["mag_y"], -RH / 2 - ml * 0.42),
                      (mw, 0.085, ml), root, 0.006)
        mag.rotation_euler = (math.radians(-mt), 0, 0)
        add_box("magbase", magm, (0, g["mag_y"] + ml * 0.11,
                                  -RH / 2 - ml * 0.88),
                (mw * 1.1, 0.095, 0.022), root, 0.004)

    st = g["sight"]
    if st == "reddot":
        add_box("rd_base", body, (0, RL * 0.52, RH / 2 + 0.030),
                (0.034, 0.070, 0.032), root, 0.005)
        add_cyl("rd_tube", steel, (0, RL * 0.52, RH / 2 + 0.058), 0.026,
                0.062, 'Y', root, 16, 0.003, caps=False)
        # 红点：就是中心一个小点，别做成整块镜片，否则挡住视线
        add_box("rd_dot", accent, (0, RL * 0.52 + 0.028, RH / 2 + 0.058),
                (0.011, 0.005, 0.011), root, 0.001)
    elif st == "sniper":
        add_cyl("scope_tube", body, (0, RL * 0.50, RH / 2 + 0.072), 0.034,
                0.30, 'Y', root, 16, 0.004, caps=False)
        add_cyl("scope_bell", body, (0, RL * 0.50 + 0.165, RH / 2 + 0.072),
                0.046, 0.055, 'Y', root, 16, 0.004, caps=False)
        add_cyl("scope_eye", body, (0, RL * 0.50 - 0.165, RH / 2 + 0.072),
                0.040, 0.050, 'Y', root, 16, 0.004, caps=False)
        add_cyl("scope_lens", accent, (0, RL * 0.50 + 0.186, RH / 2 + 0.072),
                0.036, 0.008, 'Y', root, 16, 0.0)
        for dx in (-0.085, 0.085):
            add_box("mount", steel, (0, RL * 0.50 + dx, RH / 2 + 0.038),
                    (0.030, 0.030, 0.048), root, 0.003)
    else:
        fwd = RL + (hl if hl > 0 else bl)
        up = (hr if hl > 0 else br)
        add_box("fsight", steel, (0, fwd - 0.02, bz + up + 0.014),
                (0.008, 0.012, 0.024), root, 0.002)
        add_box("rsight", steel, (0, RL * 0.86, RH / 2 + 0.016),
                (0.030, 0.014, 0.022), root, 0.002)

    ex = g["extra"]
    if ex == "pump":
        add_box("pump", furn, (0, RL + 0.20, bz - 0.052),
                (0.052, 0.150, 0.052), root, 0.008)
        add_cyl("magtube", steel, (0, RL + bl * 0.55, bz - 0.038), 0.014,
                bl * 0.86, 'Y', root, 10, 0.002)
    elif ex == "heatshield":
        add_cyl("heatshield", furn, (0, RL + 0.24, bz), 0.030, 0.26, 'Y',
                root, 16, 0.004, caps=False)
        for dy in (-0.08, 0.0, 0.08):
            add_box("hslot", steel, (0, RL + 0.24 + dy, bz),
                    (0.070, 0.030, 0.070), root, 0.0)
        add_box("boxmag", magm, (0, RL * 0.55, -RH / 2 - 0.115),
                (0.075, 0.150, 0.190), root, 0.008)
    elif ex == "bipod":
        for dx in (-0.028, 0.028):
            leg = add_box("bipod", steel, (dx * 1.7, RL + 0.30, bz - 0.10),
                          (0.012, 0.012, 0.150), root, 0.0)
            leg.rotation_euler = (math.radians(18), 0,
                                  math.radians(12 if dx > 0 else -12))

    # ---- 第一人称双手 ----
    glove = M("skin_glove", C_ENEMY_BODY, 0.05, 0.72)
    sleeve = M("skin_sleeve", C_ENEMY_LIMB, 0.05, 0.75)

    grip_y = 0.072
    grip_z = -RH / 2 - gl * 0.52
    hand_r = (0.004, grip_y + 0.004, grip_z)
    add_box("hand_R", glove, hand_r, (0.066, 0.094, 0.074), root, 0.012)
    add_box("thumb_R", glove, (0.006, grip_y + 0.052, grip_z + 0.020),
            (0.036, 0.040, 0.038), root, 0.010)
    # 小臂：从肘部画到手掌，保证接得上
    limb("forearm_R", sleeve, (0.115, grip_y - 0.285, grip_z - 0.215),
         hand_r, 0.075, root)

    if hl > 0:
        ly, lz = RL + hl * 0.42, bz - hr - 0.010
    elif ex == "pump":
        ly, lz = RL + 0.20, bz - 0.052 - 0.030
    else:
        ly, lz = 0.02, -RH / 2 - 0.030
    hand_l = (-0.006, ly, lz)
    add_box("hand_L", glove, hand_l, (0.068, 0.096, 0.072), root, 0.012)
    add_box("thumb_L", glove, (-0.008, ly + 0.048, lz + 0.018),
            (0.036, 0.040, 0.036), root, 0.010)
    limb("forearm_L", sleeve, (-0.130, ly - 0.255, lz - 0.235), hand_l, 0.075,
         root)

    muzzle_b = (0.0, RL + bl, bz)
    eject_b = (RW / 2 + 0.02, RL * 0.62, 0.012)
    sight_b = (0.0, RL * 0.52, RH / 2 + 0.060)
    # Blender 本地 -> glTF 本地 (x, y, z) = (bx, bz, -by)
    ANCHORS[g["id"]] = dict(
        label=g["label"],
        muzzle=[muzzle_b[0], muzzle_b[2], -muzzle_b[1]],
        eject=[eject_b[0], eject_b[2], -eject_b[1]],
        sight=[sight_b[0], sight_b[2], -sight_b[1]],
        length=RL + bl,
    )
    new_empty("muzzle_" + g["id"], muzzle_b, parent=root)


def build_weapons():
    for g in GUNS:
        root = new_empty("wpn_" + g["id"])
        root.empty_display_size = 0.3
        build_gun(g, root)
    export_glb(list(bpy.context.collection.all_objects),
               os.path.join(MODELS, "weapons.glb"))
    with open(os.path.join(ASSETS, "weapons.json"), "w", encoding="utf-8") as f:
        json.dump(ANCHORS, f, ensure_ascii=False, indent=1)


# ================================================================ 地图

FLOOR_T = 0.4
HX, HZ = 18.0, 13.0
WALL_T = 0.6
WALL_H = 7.0

MAP_BOXES = []
MAP_CYLS = []
LAMPS = []


def gbox(kind, center, size, yaw=0, mat_key=None, mirror=True, collide=True):
    MAP_BOXES.append(dict(kind=kind, c=list(center), s=list(size),
                          yaw=yaw % 360, mat=mat_key, collide=collide))
    if mirror:
        MAP_BOXES.append(dict(kind=kind, c=[-center[0], center[1], -center[2]],
                              s=list(size), yaw=(yaw + 180) % 360,
                              mat=mat_key, collide=collide, mirror_of=True))


def gcyl(kind, center, r, h, mat_key=None, mirror=True):
    MAP_CYLS.append(dict(kind=kind, c=list(center), r=r, h=h, mat=mat_key))
    if mirror:
        MAP_CYLS.append(dict(kind=kind, c=[-center[0], center[1], -center[2]],
                             r=r, h=h, mat=mat_key, mirror_of=True))


def define_map():
    MAP_BOXES.clear()
    MAP_CYLS.clear()
    LAMPS.clear()

    MAP_BOXES.append(dict(kind="floor", c=[0, -FLOOR_T / 2, 0],
                          s=[HX * 2, FLOOR_T, HZ * 2], yaw=0, mat="floor",
                          collide=False))
    for sx in (-1, 1):
        MAP_BOXES.append(dict(kind="wall",
                              c=[sx * (HX + WALL_T / 2), WALL_H / 2, 0],
                              s=[WALL_T, WALL_H, HZ * 2 + WALL_T * 2], yaw=0,
                              mat="wall", collide=True))
        MAP_BOXES.append(dict(kind="wall",
                              c=[0, WALL_H / 2, sx * (HZ + WALL_T / 2)],
                              s=[HX * 2 + WALL_T * 2, WALL_H, WALL_T], yaw=0,
                              mat="wall", collide=True))
    for sgn in (-1, 1):
        MAP_BOXES.append(dict(kind="ceiling", c=[0, WALL_H + 0.3,
                                                 sgn * (HZ - 2.5)],
                              s=[HX * 2, 0.6, 5.0], yaw=0, mat="ceildark",
                              collide=False))
        MAP_BOXES.append(dict(kind="ceiling", c=[sgn * (HX - 2.5),
                                                 WALL_H + 0.3, 0],
                              s=[5.0, 0.6, HZ * 2], yaw=0, mat="ceildark",
                              collide=False))
    for i in range(-3, 4):
        MAP_BOXES.append(dict(kind="truss", c=[i * 5.0, WALL_H + 0.15, 0],
                              s=[0.35, 0.35, HZ * 2], yaw=0, mat="truss",
                              collide=False))

    # ---- 中央掩体（自对称，挡住出生点之间的直视线）----
    MAP_BOXES.append(dict(kind="container", c=[0, 1.3, 0],
                          s=[2.6, 2.6, 6.0], yaw=0, mat="cont_green",
                          collide=True))
    # ---- 四角集装箱 ----
    gbox("container", (-9.0, 1.3, -7.0), (6.0, 2.6, 2.6), 0, "cont_red")
    gbox("container", (-9.0, 1.3, 7.0), (6.0, 2.6, 2.6), 0, "cont_blue")
    # ---- 中路矮墙（与集装箱拼成侧翼屏障）----
    gbox("lowwall", (-6.0, 0.55, -3.4), (3.6, 1.1, 0.5), 90, "concrete_d")
    gbox("lowwall", (-6.0, 0.55, 3.4), (3.6, 1.1, 0.5), 90, "concrete_d")
    MAP_BOXES.append(dict(kind="lowwall", c=[0, 0.55, -10.2],
                          s=[5.0, 1.1, 0.5], yaw=0, mat="concrete_d",
                          collide=True))
    MAP_BOXES.append(dict(kind="lowwall", c=[0, 0.55, 10.2],
                          s=[5.0, 1.1, 0.5], yaw=0, mat="concrete_d",
                          collide=True))
    # ---- 水泥柱 ----
    for px in (-14.0, 14.0):
        for pz in (-6.5, 6.5):
            MAP_BOXES.append(dict(kind="pillar", c=[px, WALL_H / 2, pz],
                                  s=[1.2, WALL_H, 1.2], yaw=0,
                                  mat="concrete", collide=True))

    # ---- 木箱堆 ----
    gbox("crate", (-16.0, 0.70, -4.2), (1.4, 1.4, 1.4), 0, "crate")
    gbox("crate", (-16.0, 2.10, -4.2), (1.4, 1.4, 1.4), 0, "crate_d")
    gbox("crate", (-3.5, 0.70, -11.4), (1.4, 1.4, 1.4), 0, "crate")
    gbox("crate", (-2.1, 0.70, -11.4), (1.4, 1.4, 1.4), 0, "crate_d")
    gbox("crate", (-12.0, 0.70, 11.0), (1.4, 1.4, 1.4), 0, "crate")
    gbox("crate", (-12.0, 2.10, 11.0), (1.4, 1.4, 1.4), 0, "crate_d")

    # ---- 油桶 ----
    gcyl("barrel", (-10.5, 0.55, 1.2), 0.45, 1.1, "barrel_b")
    gcyl("barrel", (-4.8, 0.55, 5.6), 0.45, 1.1, "barrel_r")
    gcyl("barrel", (-4.8, 0.55, -5.6), 0.45, 1.1, "barrel_b")
    gcyl("barrel", (-16.0, 0.55, -10.4), 0.45, 1.1, "barrel_r")

    # ---- 顶部吊灯 ----
    for lx in (-10.0, 0.0, 10.0):
        for lz in (-7.0, 7.0):
            LAMPS.append([lx, 6.35, lz])
    for lx in (-16.0, 16.0):
        LAMPS.append([lx, 6.35, 0.0])


def g2b_pos(c):
    return (c[0], -c[2], c[1])


def g2b_size(s):
    return (s[0], s[2], s[1])


def aabb_of(center, size, yaw):
    sx, sz = size[0], size[2]
    if yaw % 180 == 90:
        sx, sz = sz, sx
    return [center[0] - sx / 2, center[1] - size[1] / 2, center[2] - sz / 2,
            center[0] + sx / 2, center[1] + size[1] / 2, center[2] + sz / 2]


def build_arena():
    mats = {
        "floor": M("floor", C_FLOOR, 0.02, 0.92),
        "wall": M("wall", C_WALL, 0.05, 0.86),
        "ceildark": M("ceildark", C_WALL_D, 0.05, 0.9),
        "truss": M("truss", C_TRUSS, 0.75, 0.42),
        "concrete": M("concrete", C_CONCRETE, 0.02, 0.9),
        "concrete_d": M("concrete_d", C_CONCRETE_D, 0.02, 0.92),
        "crate": M("crate", C_CRATE, 0.02, 0.8),
        "crate_d": M("crate_d", C_CRATE_D, 0.02, 0.84),
        "cont_red": M("cont_red", C_CONT_RED, 0.35, 0.62),
        "cont_blue": M("cont_blue", C_CONT_BLUE, 0.35, 0.62),
        "cont_green": M("cont_green", C_CONT_GREEN, 0.35, 0.62),
        "cont_rust": M("cont_rust", C_CONT_RUST, 0.45, 0.72),
        "barrel_b": M("barrel_b", C_BARREL_B, 0.55, 0.5),
        "barrel_r": M("barrel_r", C_BARREL_R, 0.55, 0.5),
        "lamp": M("lamp", C_LAMP, 0.0, 0.3, emit=C_LAMP, emit_str=8.0),
        "frame": M("frame", C_TRUSS, 0.7, 0.4),
    }
    for b in MAP_BOXES:
        bc = g2b_pos(b["c"])
        bs = g2b_size(b["s"])
        bev = 0.02 if b["kind"] in ("container", "crate") else 0.03
        add_box("m_" + b["kind"], mats[b["mat"]], bc, bs, None, bev,
                (0, 0, math.radians(b["yaw"])))
    for c in MAP_CYLS:
        bc = g2b_pos(c["c"])
        add_cyl("m_" + c["kind"], mats[c["mat"]], bc, c["r"], c["h"], 'Z',
                None, 18, 0.012)
        add_cyl("m_barrel_rim", mats["frame"],
                (bc[0], bc[1], bc[2] + c["h"] / 2 - 0.04), c["r"] * 1.03,
                0.05, 'Z', None, 18)
    for L in LAMPS:
        bc = g2b_pos(L)
        add_box("m_lampframe", mats["frame"], (bc[0], bc[1] + 0.16, bc[2]),
                (0.9, 0.16, 0.36), None, 0.012)
        add_box("m_lamp", mats["lamp"], bc, (0.78, 0.10, 0.26), None, 0.01)
        add_box("m_lampchain", mats["frame"], (bc[0], bc[1] + 0.34, bc[2]),
                (0.05, 0.36, 0.05), None, 0.005)
    export_glb(list(bpy.context.collection.all_objects),
               os.path.join(MODELS, "arena.glb"))


# ================================================================ 敌人

def build_enemy():
    body = M("en_body", C_ENEMY_BODY, 0.10, 0.68)
    limb_m = M("en_limb", C_ENEMY_LIMB, 0.08, 0.72)
    accent = M("en_accent", C_ENEMY_ACCENT, 0.25, 0.55)
    visor = M("en_visor", C_ENEMY_VISOR, 0.10, 0.25, emit=C_ENEMY_VISOR, emit_str=2.0)
    steel = M("en_steel", C_METAL_D, 0.80, 0.40)

    root = new_empty("enemy_root")
    root.empty_display_size = 0.5

    new_obj("pelvis", bm_box(0.34, 0.24, 0.22, 0.02), body, (0, 0, 0.95),
            (0, 0, 0), root)

    for side, sx in (("L", 0.105), ("R", -0.105)):
        # 物体原点 = 髋关节；网格相对原点向下偏移
        thigh = new_joint("leg_u_" + side, bm_box(0.155, 0.165, 0.44, 0.02),
                          limb_m, (0, 0, -0.22), (sx, 0, 0.95), (0, 0, 0), root)
        new_joint("knee_" + side, bm_box(0.145, 0.145, 0.10, 0.02), accent,
                  (0, 0.012, -0.44), (0, 0, -0.44), (0, 0, 0), thigh)
        shin = new_joint("leg_l_" + side, bm_box(0.135, 0.145, 0.42, 0.02),
                         limb_m, (0, 0, -0.21), (0, 0, -0.44), (0, 0, 0), thigh)
        new_joint("foot_" + side, bm_box(0.150, 0.26, 0.09, 0.02),
                  limb_m, (0, 0.045, -0.045), (0, 0, -0.42), (0, 0, 0), shin)

    upper = new_empty("upper", (0, 0, 1.06), (0, 0, 0), root)

    new_obj("torso", bm_box(0.40, 0.26, 0.36, 0.025), body, (0, 0, 0.17),
            (0, 0, 0), upper)
    new_obj("chestplate", bm_box(0.34, 0.09, 0.26, 0.02), accent,
            (0, 0.145, 0.19), (0, 0, 0), upper)
    new_obj("shoulders", bm_box(0.50, 0.24, 0.13, 0.025), body, (0, 0, 0.335),
            (0, 0, 0), upper)
    new_obj("neck", bm_box(0.10, 0.10, 0.09, 0.015), limb_m, (0, 0, 0.425),
            (0, 0, 0), upper)
    new_obj("head", bm_box(0.21, 0.235, 0.22, 0.025), body, (0, 0, 0.575),
            (0, 0, 0), upper)
    new_obj("helmet", bm_box(0.235, 0.26, 0.13, 0.03), limb_m, (0, 0.005, 0.645),
            (0, 0, 0), upper)
    new_obj("visor", bm_box(0.17, 0.045, 0.075, 0.015), visor, (0, 0.125, 0.575),
            (0, 0, 0), upper)
    new_obj("backpack", bm_box(0.30, 0.13, 0.30, 0.02), limb_m, (0, -0.155, 0.19),
            (0, 0, 0), upper)

    # ---- 敌人手里的步枪 ----
    GX, GY, GZ = 0.02, 0.10, 0.30
    gr = new_empty("enemy_rifle", (GX, GY, GZ), (0, 0, 0), upper)
    new_obj("er_body", bm_box(0.075, 0.50, 0.13, 0.012), steel, (0, 0.10, 0),
            (0, 0, 0), gr)
    new_obj("er_rail", bm_box(0.040, 0.44, 0.022, 0.006), steel, (0, 0.10, 0.076),
            (0, 0, 0), gr)
    new_obj("er_barrel", bm_cyl(0.014, 0.30, 12, 0.002, 'Y'), steel,
            (0, 0.46, 0.012), (0, 0, 0), gr)
    new_obj("er_muzzle", bm_cyl(0.024, 0.07, 12, 0.003, 'Y'), steel,
            (0, 0.60, 0.012), (0, 0, 0), gr)
    new_obj("er_hand", bm_box(0.066, 0.22, 0.088, 0.012), steel, (0, 0.30, -0.006),
            (0, 0, 0), gr)
    new_obj("er_mag", bm_box(0.052, 0.095, 0.22, 0.012), steel, (0, 0.08, -0.175),
            (0, 0, 0), gr)
    new_obj("er_stock", bm_box(0.062, 0.24, 0.10, 0.012), steel, (0, -0.26, -0.008),
            (0, 0, 0), gr)
    new_obj("er_grip", bm_box(0.050, 0.055, 0.13, 0.012), steel, (0, -0.04, -0.115),
            (math.radians(-16), 0, 0), gr)
    new_obj("er_sight", bm_box(0.042, 0.062, 0.042, 0.008), accent,
            (0, 0.14, 0.100), (0, 0, 0), gr)

    # ---- 手臂：两段 IK，手正好落在握把 / 护木上 ----
    def arm(side, sx, hand_local, pole):
        S = (sx, -0.02, 0.315)
        E = ik2(S, hand_local, 0.29, 0.27, pole)
        limb("arm_u_" + side, limb_m, S, E, 0.135, upper)
        limb("arm_l_" + side, limb_m, E, hand_local, 0.120, upper)
        new_obj("hand_" + side, bm_box(0.110, 0.120, 0.110, 0.02), body,
                tuple(hand_local), (0, 0, 0), upper)

    grip_h = (GX, GY - 0.04, GZ - 0.115)
    fore_h = (GX, GY + 0.30, GZ - 0.006)
    arm("R", -0.255, grip_h, (-1.0, 0.0, -0.55))
    arm("L", 0.255, fore_h, (1.0, 0.0, -0.55))

    export_glb(list(bpy.context.collection.all_objects),
               os.path.join(MODELS, "enemy.glb"))


# ================================================================ map.json

def spawn_yaw(dx, dz):
    return math.degrees(math.atan2(-dx, -dz))


def write_map_json():
    colliders = []
    for b in MAP_BOXES:
        if not b.get("collide", True):
            continue
        colliders.append(dict(kind=b["kind"],
                              aabb=aabb_of(b["c"], b["s"], b["yaw"])))
    for c in MAP_CYLS:
        colliders.append(dict(kind=c["kind"],
                              aabb=[c["c"][0] - c["r"], 0.0, c["c"][2] - c["r"],
                                    c["c"][0] + c["r"], c["h"],
                                    c["c"][2] + c["r"]]))
    sA = (-15.5, 0.0, 0.0)
    sB = (15.5, 0.0, 0.0)
    data = dict(
        bounds=dict(min=[-HX, 0.0, -HZ], max=[HX, WALL_H, HZ]),
        spawns=[dict(pos=list(sA), yaw=spawn_yaw(1.0, 0.0)),
                dict(pos=list(sB), yaw=spawn_yaw(-1.0, 0.0))],
        lamps=[list(l) for l in LAMPS],
        colliders=colliders,
    )
    path = os.path.join(ASSETS, "map.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("WROTE map.json", len(colliders), "colliders")


def main():
    wipe()
    define_map()
    build_weapons()
    wipe()
    build_arena()
    wipe()
    build_enemy()
    write_map_json()
    print("ALL_DONE")


if __name__ == "__main__":
    main()
