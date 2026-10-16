import bpy, sys, addon_utils

print("PYVER", sys.version.split()[0])
print("BLENDER", bpy.app.version_string)
print("HAS_GLTF_OP", hasattr(bpy.ops.export_scene, "gltf"))

mods = [m.__name__ for m in addon_utils.modules()]
print("GLTF_MODULES", [m for m in mods if "gltf" in m.lower()])

# check bmesh op signature
import bmesh, inspect
bm = bmesh.new()
try:
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=1.0, radius2=1.0, depth=2.0)
    print("CONE_SIG", "radius1/radius2 OK")
except TypeError as e:
    print("CONE_SIG_FAIL", e)
bm.free()

print("PROBE_OK")
