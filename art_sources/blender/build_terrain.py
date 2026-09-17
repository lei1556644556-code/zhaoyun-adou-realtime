"""Run through Blender MCP. Creates an isolated scene; leaves existing scenes intact.
Top-down mineral-pigment terrain, baked once to 256px WebP for Phaser.
"""
import bpy
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.data.scenes.new('Adou_Terrain_202609')
bpy.context.window.scene = scene
scene.render.resolution_x = scene.render.resolution_y = 256
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.quality = 88
scene.render.film_transparent = False

def material(name, rgb):
    mat = bpy.data.materials.new('Adou_' + name)
    mat.use_nodes = True
    node = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = (*rgb, 1)
    node.inputs['Roughness'].default_value = .92
    mat.diffuse_color = (*rgb, 1)
    return mat

earth = material('ochre', (.40, .29, .14))
rut = material('wheel_rut', (.29, .20, .10))
sand = [material('sand'+str(i), (.42+i*.013, .32+i*.012, .18+i*.009)) for i in range(5)]
jade = material('jade_earth', (.095, .19, .135))
leaves = [material('grass'+str(i), (.105+i*.018, .22+i*.022, .135+i*.015)) for i in range(5)]
stone = material('ivory_stone', (.70, .72, .58))
edge = material('stone_edge', (.36, .44, .34))
rock = material('rock', (.25, .31, .24))

def box(name, location, scale, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj=bpy.context.object
    obj.name='Adou_'+name
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        # Property identifiers are obtained from RNA to stay version-safe.
        mod=obj.modifiers.new('soft stone edge', next(i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items if i.identifier == 'BEVEL'))
        mod.width=bevel
        mod.segments=2
    return obj

random.seed(109)
for x, mat, name in [(0, earth, 'road'), (3, jade, 'grass'), (6, edge, 'deployment')]:
    box(name+'_base', (x,0,-.08), (2.04,2.04,.16), mat)

# Quiet road surface. Sparse embedded stones, not a dense noisy photograph.
for n in range(65):
    x,y=random.uniform(-.95,.95),random.uniform(-.95,.95)
    obj=box('pebble', (x,y,.005), (random.uniform(.02,.07),random.uniform(.015,.045),.008),random.choice(sand))
    obj.rotation_euler.z=random.random()*math.tau
for x in [-.4,.4]:
    box('cart_track', (x,0,.003), (.018,2,.004), rut)

# Low-poly grass tufts confined to tile, so shovel/selection boundary stays exact.
for n in range(70):
    x,y=3+random.uniform(-.92,.92),random.uniform(-.92,.92)
    h=random.uniform(.035,.11)
    mesh=bpy.data.meshes.new('Adou_grass_blades')
    mesh.from_pydata([(x-.025,y,0),(x+.025,y,0),(x+.03,y+.09,h),
                      (x,y-.02,0),(x,y+.03,0),(x-.065,y+.06,h*.7)],[],[(0,1,2),(3,4,5)])
    obj=bpy.data.objects.new('Adou_tuft',mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(random.choice(leaves))
for x,y in [(2.25,.7),(3.73,-.75),(2.4,-.62)]:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.09,location=(x,y,.025))
    bpy.context.object.name='Adou_small_rock'
    bpy.context.object.scale.z=.5
    bpy.context.object.data.materials.append(rock)

# Pale deployment slab with a recessed border, unmistakably different from grass.
box('deployment_slab', (6,0,.035), (1.87,1.87,.13), stone, .035)
for x,y,sx,sy in [(5.15,0,.012,1.68),(6.85,0,.012,1.68),(6,.85,1.68,.012),(6,-.85,1.68,.012)]:
    box('slab_inlay',(x,y,.103),(sx,sy,.004),edge)

camera_data=bpy.data.cameras.new('Adou_TileCamera')
camera_data.type='ORTHO'
camera_data.ortho_scale=2
camera=bpy.data.objects.new('Adou_TileCamera',camera_data)
scene.collection.objects.link(camera)
camera.location=(0,0,8)
scene.camera=camera
light_data=bpy.data.lights.new('Adou_Softbox','AREA')
light_data.energy=450
light_data.size=5
light=bpy.data.objects.new('Adou_Softbox',light_data)
scene.collection.objects.link(light)
light.location=(-2,-1,5)
scene.world=bpy.data.worlds.new('Adou_World')
scene.world.color=(.25,.25,.25)

def render_tile(name, x):
    camera.location.x=x
    light.location.x=x-2
    draft_path = ROOT / 'art_sources/blender/drafts'
    draft_path.mkdir(exist_ok=True)
    scene.render.filepath=str(draft_path/('blender-'+name+'.webp'))
    bpy.ops.render.render(write_still=True)
    print('Rendered',scene.render.filepath)

print('Adou terrain scene ready; call render_tile for road=0, grass=3, deployment=6.')
