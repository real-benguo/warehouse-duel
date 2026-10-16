# -*- coding: utf-8 -*-
"""验证导出的 GLB：解析 JSON chunk，检查节点名 / 网格 / 顶点数 / 包围盒"""
import json
import math
import struct
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODELS = os.path.join(ROOT, "assets", "models")


def parse_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB: " + path
    off = 12
    gltf = None
    bin_chunk = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
    return gltf, bin_chunk


def report(path):
    gltf, binc = parse_glb(path)
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    accessors = gltf.get("accessors", [])
    mats = gltf.get("materials", [])

    total_tris = 0
    total_verts = 0
    for m in meshes:
        for p in m.get("primitives", []):
            idx = p.get("indices")
            if idx is not None:
                total_tris += accessors[idx]["count"] // 3
            pos = p.get("attributes", {}).get("POSITION")
            if pos is not None:
                total_verts += accessors[pos]["count"]

    # 计算整体包围盒
    gmin = [1e9] * 3
    gmax = [-1e9] * 3
    for m in meshes:
        for p in m.get("primitives", []):
            pos = p.get("attributes", {}).get("POSITION")
            if pos is None:
                continue
            acc = accessors[pos]
            if "min" in acc and "max" in acc:
                for i in range(3):
                    gmin[i] = min(gmin[i], acc["min"][i])
                    gmax[i] = max(gmax[i], acc["max"][i])

    names = [n.get("name", "?") for n in nodes]
    print("=" * 62)
    print(os.path.basename(path))
    print("  size       :", os.path.getsize(path), "bytes")
    print("  nodes      :", len(nodes), " meshes:", len(meshes),
          " materials:", len(mats))
    print("  triangles  :", total_tris, " vertices:", total_verts)
    print("  bbox local : min=[%.2f %.2f %.2f] max=[%.2f %.2f %.2f]"
          % (gmin[0], gmin[1], gmin[2], gmax[0], gmax[1], gmax[2]))
    roots = [n for n in nodes if all(
        i not in [c for m in nodes for c in m.get("children", [])]
        for i in [nodes.index(n)])]
    print("  root nodes :", [n.get("name") for n in roots])
    return names


def ray_aabb(o, d, mn, mx, max_t=200.0):
    """返回射线与 AABB 的首个正向交点的 t，无交返回 None"""
    tmin, tmax = 0.0, max_t
    for i in range(3):
        if abs(d[i]) < 1e-9:
            if o[i] < mn[i] or o[i] > mx[i]:
                return None
        else:
            inv = 1.0 / d[i]
            t1 = (mn[i] - o[i]) * inv
            t2 = (mx[i] - o[i]) * inv
            if t1 > t2:
                t1, t2 = t2, t1
            if t1 > tmin:
                tmin = t1
            if t2 < tmax:
                tmax = t2
            if tmin > tmax:
                return None
    return tmin if tmin > 1e-6 else None


def point_in_aabb(p, mn, mx, pad=0.0):
    for i in range(3):
        if p[i] < mn[i] - pad or p[i] > mx[i] + pad:
            return False
    return True


def check_map(mp):
    """出生点自检：不卡墙、前方有开阔空间、两点之间视线被挡（防开局对狙）"""
    colliders = [c["aabb"] for c in mp["colliders"]]
    kinds = [c["kind"] for c in mp["colliders"]]
    eye = 1.60
    ok = True

    for i, s in enumerate(mp["spawns"]):
        p = s["pos"]
        body = [p[0], p[1] + 0.1, p[2]]
        # 1) 半径 0.45 内不能有碰撞体
        for c, k in zip(colliders, kinds):
            if point_in_aabb([p[0], p[1] + 0.9, p[2]], c[:3], c[3:], pad=0.45):
                print("  !! spawn %d 卡在 %s 里" % (i, k))
                ok = False
        # 2) 正前方首个遮挡距离
        yaw = math.radians(s["yaw"])
        d = [-math.sin(yaw), 0.0, -math.cos(yaw)]
        o = [p[0], eye, p[2]]
        best = None
        bestk = None
        for c, k in zip(colliders, kinds):
            t = ray_aabb(o, d, c[:3], c[3:])
            if t is not None and (best is None or t < best):
                best, bestk = t, k
        print("  spawn %d @ (%.1f, %.1f) yaw=%.0f -> 前方首个遮挡: %s %.2f m"
              % (i, p[0], p[2], s["yaw"], bestk,
                 best if best is not None else -1))
        if best is not None and best < 6.0:
            print("     !! 出生点前方 %.2f m 就被挡住，视野太憋" % best)
            ok = False

    # 3) 两个出生点之间的视线必须被挡住（否则开局直接对狙）
    if len(mp["spawns"]) >= 2:
        a = mp["spawns"][0]["pos"]
        b = mp["spawns"][1]["pos"]
        d = [b[0] - a[0], 0.0, b[2] - a[2]]
        L = math.sqrt(d[0] ** 2 + d[2] ** 2)
        d = [d[0] / L, 0.0, d[2] / L]
        o = [a[0], eye, a[2]]
        best = None
        bestk = None
        for c, k in zip(colliders, kinds):
            t = ray_aabb(o, d, c[:3], c[3:], max_t=L - 0.5)
            if t is not None and (best is None or t < best):
                best, bestk = t, k
        print("  spawnA->spawnB 直视线: 首个遮挡 %s @ %.2f m (总长 %.1f m)"
              % (bestk, best if best is not None else -1, L))
        if best is None:
            print("     !! 两点之间完全通视，开局就能对狙，需要加中央掩体")
            ok = False
    return ok


def main():
    allnames = {}
    for fn in ("weapons.glb", "arena.glb", "enemy.glb"):
        p = os.path.join(MODELS, fn)
        if not os.path.exists(p):
            print("MISSING", p)
            continue
        allnames[fn] = report(p)

    # 关键节点断言
    wn = allnames.get("weapons.glb", [])
    for gid in ("assault", "smg", "shotgun", "sniper", "pistol", "lmg"):
        assert ("wpn_" + gid) in wn, "missing gun root wpn_" + gid
        assert ("muzzle_" + gid) in wn, "missing muzzle_" + gid
    en = allnames.get("enemy.glb", [])
    for need in ("enemy_root", "upper", "leg_u_L", "leg_u_R", "leg_l_L",
                 "foot_L", "head", "torso", "enemy_rifle"):
        assert need in en, "missing enemy node " + need

    wp = os.path.join(ROOT, "assets", "weapons.json")
    anchors = json.load(open(wp, encoding="utf-8"))
    print("=" * 62)
    print("weapons.json anchors:")
    for k, v in anchors.items():
        print("  %-8s muzzle=(%.3f, %.3f, %.3f) len=%.2f  %s"
              % (k, v["muzzle"][0], v["muzzle"][1], v["muzzle"][2],
                 v["length"], v["label"]))
    mp = json.load(open(os.path.join(ROOT, "assets", "map.json"),
                        encoding="utf-8"))
    print("=" * 62)
    print("map.json: colliders=%d lamps=%d spawns=%d"
          % (len(mp["colliders"]), len(mp["lamps"]), len(mp["spawns"])))
    for s in mp["spawns"]:
        print("  spawn", ["%.1f" % x for x in s["pos"]],
              "yaw=%.1f" % s["yaw"])
    kinds = {}
    for c in mp["colliders"]:
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
    print("  kinds:", kinds)
    print("-" * 62)
    print("出生点自检:")
    map_ok = check_map(mp)
    print("-" * 62)
    if not map_ok:
        print("VERIFY_MAP_ISSUES")
    print("VERIFY_OK")


if __name__ == "__main__":
    main()
