"""Blender MCP material proof for the final web-generated terrain; no gameplay data."""
import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.new('Adou_Production_Palette')
bpy.context.window.scene = scene
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
for index, key in enumerate(['grass', 'road', 'deployment', 'paper']):
    bpy.ops.mesh.primitive_plane_add(size=2, location=((index % 2) * 2.12, -(index // 2) * 2.12, 0))
    obj = bpy.context.object
    obj.name = 'Production_' + key
    mat = bpy.data.materials.new('Production_' + key)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(ROOT / 'apps/client/public/assets/v2' / ('tile-' + key + '.webp')), check_existing=True)
    texture.image.pack()
    emission = nodes.new('ShaderNodeEmission')
    mat.node_tree.links.new(texture.outputs['Color'], emission.inputs['Color'])
    mat.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
    obj.data.materials.append(mat)
camera_data = bpy.data.cameras.new('Production_Ortho')
camera_data.type = next(i.identifier for i in camera_data.bl_rna.properties['type'].enum_items if i.identifier == 'ORTHO')
camera_data.ortho_scale = 4.5
camera = bpy.data.objects.new('Production_Ortho', camera_data)
scene.collection.objects.link(camera)
camera.location = (1.06, -1.06, 8)
scene.camera = camera
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        space = area.spaces.active
        space.shading.type = next(i.identifier for i in space.shading.bl_rna.properties['type'].enum_items if i.identifier == 'MATERIAL')
        space.region_3d.view_perspective = next(i.identifier for i in space.region_3d.bl_rna.properties['view_perspective'].enum_items if i.identifier == 'CAMERA')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art_sources/blender/adou-production-palette.blend'))
print('Saved final packed terrain materials; draft scene retained separately.')
