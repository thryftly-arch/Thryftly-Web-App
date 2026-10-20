# Blender script: turn downloaded garment models into small, consistent web models.
#   blender -b --python tools/prepare_models.py -- <out_dir> <name>=<file.glb>[:triangles] ...
# Each model is merged into one mesh, scaled to 2.0 units tall, centred on the origin (front
# facing +Z in three.js), decimated to the triangle budget, stripped of materials/textures (the
# site colours the fabric itself) and exported as Draco-compressed GLB. Credits found in the
# source file are written next to it as <name>.json.
import bpy, sys, json, os, struct, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
out, jobs = argv[0], argv[1:]
os.makedirs(out, exist_ok=True)

def credits(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    ex = json.loads(b[20:20 + n]).get('asset', {}).get('extras', {})
    return {k: ex.get(k, '') for k in ('title', 'author', 'license', 'source')}

for job in jobs:
    name, rest = job.split('=', 1)
    path, _, budget = rest.rpartition(':') if rest.count(':') > 1 else (rest, '', '')
    budget = int(budget or 120000)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # Bake every transform in, then merge into one object.
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            continue
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)

    me = obj.data
    me.materials.clear()
    # Blender is Z-up; the garments face -Y here (= +Z in glTF/three.js).
    vs = [v.co for v in me.vertices]
    lo = mathutils.Vector([min(v[i] for v in vs) for i in range(3)])
    hi = mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
    s = 2.0 / (hi.z - lo.z)
    c = (lo + hi) / 2
    for v in me.vertices:
        v.co = (v.co - c) * s

    # Weld the duplicate vertices CLO/Marvelous exports leave along seams FIRST: decimating an
    # unwelded mesh tears it apart. Then make every face point outward.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0004)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > budget:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = budget / tris
        mod.use_collapse_triangulate = True
        mod.use_symmetry = True
        mod.symmetry_axis = 'X'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()
    for layer in list(me.uv_layers):
        me.uv_layers.remove(layer)

    final = sum(len(p.vertices) - 2 for p in me.polygons)
    dims = [round(x, 3) for x in obj.dimensions]
    target = os.path.join(out, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=target, export_format='GLB', use_selection=False, export_materials='NONE',
                              export_texcoords=False, export_normals=True, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                              export_draco_normal_quantization=10, export_yup=True)
    meta = {**credits(path), 'triangles': final, 'size': dims}
    json.dump(meta, open(os.path.join(out, name + '.json'), 'w'), indent=1)
    print('DONE', name, final, 'tris', dims, round(os.path.getsize(target) / 1e6, 2), 'MB')
