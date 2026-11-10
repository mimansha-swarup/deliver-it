#!/usr/bin/env python3
"""
Packs the few pieces of Quaternius's Downtown City MegaKit that the game uses
into one small file, public/models/city-kit.glb, and writes the wall textures.

The kit is 244 MB, and the game needs about 1% of that. Run this once:

    python3 -I scripts/prepare_city_kit.py "<path to Downtown City MegaKit[Standard]>"

It keeps only position, normal and one set of texture coordinates, leaves out
each piece's inner wall (our buildings sit behind them), and turns the kit's
fake interiors and glass into one simple "Window" material.
"""
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

PIECES = [
    'Metal_FullWindow',
    'Metal_FirstFloor_Window',
    'Metal_FirstFloor_Wall',
    'Brick_Window_Square_Single',
    'Brick_Plain_3_noWear',
    'Cornice_Metal_Center',
    'Cornice_Trim_Center',
    'Cornice_Brick_Center',
    'Metal_Column_Center',
    'DoorFrame_Metal_Single',
    'DoorFrame_Wooden',
    'Prop_Planter_Single',
]
DROPPED = {'MI_InteriorWall'}
WINDOW_PARTS = {'MI_FakeInterior', 'MI_Glass'}
ATTRIBUTES = ['POSITION', 'NORMAL', 'TEXCOORD_0']
MODEL_TEXTURE_SIZE = 1024
WALL_TEXTURE_SIZE = 768
WALL_TEXTURES = {
    'T_Concrete_BaseColor': 'concrete-color',
    'T_Concrete_Normal': 'concrete-normal',
    'T_RedBrick_BaseColor': 'brick-color',
    'T_RedBrick_Normal': 'brick-normal',
}
SIZES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COUNTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def to_jpeg(source, target, size):
    subprocess.run(
        ['sips', '-Z', str(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', '75',
         str(source), '--out', str(target)],
        check=True, capture_output=True,
    )


class Glb:
    def __init__(self):
        self.binary = bytearray()
        self.views = []
        self.accessors = []
        self.images = []
        self.materials = {}
        self.textures = {}

    def add_view(self, data, target=None):
        while len(self.binary) % 4:
            self.binary.append(0)
        view = {'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(data)}
        if target:
            view['target'] = target
        self.binary.extend(data)
        self.views.append(view)
        return len(self.views) - 1

    def copy_accessor(self, gltf, buffer, index, target):
        accessor = gltf['accessors'][index]
        view = gltf['bufferViews'][accessor['bufferView']]
        width = SIZES[accessor['componentType']] * COUNTS[accessor['type']]
        stride = view.get('byteStride', width)
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        data = b''.join(
            buffer[start + i * stride: start + i * stride + width]
            for i in range(accessor['count'])
        )
        copied = {key: accessor[key] for key in ('componentType', 'count', 'type', 'min', 'max') if key in accessor}
        copied['bufferView'] = self.add_view(data, target)
        self.accessors.append(copied)
        return len(self.accessors) - 1

    def add_texture(self, name, textures_dir, scratch):
        if name in self.textures:
            return self.textures[name]
        target = scratch / f'{name}.jpg'
        to_jpeg(textures_dir / f'{name}.png', target, MODEL_TEXTURE_SIZE)
        view = self.add_view(target.read_bytes())
        self.images.append({'bufferView': view, 'mimeType': 'image/jpeg', 'name': name})
        self.textures[name] = len(self.images) - 1
        return self.textures[name]

    def add_material(self, gltf, material, textures_dir, scratch):
        name = material['name']
        if name in self.materials:
            return self.materials[name][0]

        def texture_of(slot):
            image = gltf['textures'][slot['index']]['source']
            uri = gltf['images'][image]['uri']
            return {'index': self.add_texture(Path(uri).stem, textures_dir, scratch)}

        pbr = material.get('pbrMetallicRoughness', {})
        made = {'name': name, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.8}}
        if 'baseColorFactor' in pbr:
            made['pbrMetallicRoughness']['baseColorFactor'] = pbr['baseColorFactor']
        if 'baseColorTexture' in pbr:
            made['pbrMetallicRoughness']['baseColorTexture'] = texture_of(pbr['baseColorTexture'])
        if 'normalTexture' in material:
            made['normalTexture'] = texture_of(material['normalTexture'])
        self.materials[name] = (len(self.materials), made)
        return self.materials[name][0]


def add_piece(glb, models_dir, textures_dir, scratch, name):
    gltf = json.loads((models_dir / f'{name}.gltf').read_text())
    buffer = (models_dir / gltf['buffers'][0]['uri']).read_bytes()

    for node in gltf['nodes']:
        if any(key in node for key in ('matrix', 'rotation', 'scale', 'translation')):
            raise SystemExit(f'{name} has a moved node, which this script would lose')

    material_names = [
        gltf['materials'][primitive['material']]['name']
        for primitive in gltf['meshes'][0]['primitives']
    ]
    has_interior = 'MI_FakeInterior' in material_names

    primitives = []
    for primitive, material_name in zip(gltf['meshes'][0]['primitives'], material_names):
        if material_name in DROPPED:
            continue
        # A pane in front of a fake interior adds nothing, as the interior becomes the glass.
        if material_name == 'MI_Glass' and has_interior:
            continue

        if material_name in WINDOW_PARTS:
            material = {'name': 'Window', 'pbrMetallicRoughness': {'baseColorFactor': [0.05, 0.08, 0.1, 1]}}
        else:
            material = gltf['materials'][primitive['material']]

        attributes = {
            attribute: glb.copy_accessor(gltf, buffer, primitive['attributes'][attribute], 34962)
            for attribute in ATTRIBUTES
        }
        primitives.append({
            'attributes': attributes,
            'indices': glb.copy_accessor(gltf, buffer, primitive['indices'], 34963),
            'material': glb.add_material(gltf, material, textures_dir, scratch),
        })

    return {'name': name, 'primitives': primitives}


def main():
    kit = Path(sys.argv[1])
    root = Path(__file__).resolve().parent.parent
    models_dir = kit / 'Exports' / 'glTF (Godot)'
    textures_dir = kit / 'Textures'
    glb = Glb()

    with tempfile.TemporaryDirectory() as folder:
        scratch = Path(folder)
        meshes = [add_piece(glb, models_dir, textures_dir, scratch, name) for name in PIECES]

    materials = [made for _, made in sorted(glb.materials.values(), key=lambda entry: entry[0])]
    document = {
        'asset': {'version': '2.0', 'generator': 'scripts/prepare_city_kit.py'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(meshes)))}],
        'nodes': [{'name': mesh['name'], 'mesh': index} for index, mesh in enumerate(meshes)],
        'meshes': meshes,
        'materials': materials,
        'accessors': glb.accessors,
        'bufferViews': glb.views,
        'images': glb.images,
        'textures': [{'source': index, 'sampler': 0} for index in range(len(glb.images))],
        'samplers': [{'wrapS': 10497, 'wrapT': 10497}],
        'buffers': [{'byteLength': 0}],
    }

    # Texture links point at positions in the textures list, which match the images list.
    while len(glb.binary) % 4:
        glb.binary.append(0)
    document['buffers'][0]['byteLength'] = len(glb.binary)

    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(glb.binary)

    output = root / 'public' / 'models' / 'city-kit.glb'
    with output.open('wb') as file:
        file.write(struct.pack('<4sII', b'glTF', 2, total))
        file.write(struct.pack('<I4s', len(text), b'JSON') + text)
        file.write(struct.pack('<I4s', len(glb.binary), b'BIN\0') + glb.binary)

    for source, target in WALL_TEXTURES.items():
        to_jpeg(textures_dir / f'{source}.png', root / 'public' / 'textures' / f'{target}.jpg', WALL_TEXTURE_SIZE)

    print(f'{output}: {total / 1_000_000:.1f} MB, {len(meshes)} pieces, {len(materials)} materials')
    for mesh in meshes:
        print(mesh['name'], [materials[p['material']]['name'] for p in mesh['primitives']])


main()
