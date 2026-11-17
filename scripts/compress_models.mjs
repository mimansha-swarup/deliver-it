#!/usr/bin/env node
/**
 * Compresses the game's models in public/models with Meshopt (EXT_meshopt_compression),
 * in place. drei's useGLTF decodes it with no change to the game's code.
 *
 *     node scripts/compress_models.mjs            # every .glb in public/models
 *     node scripts/compress_models.mjs city-kit   # just one
 *
 * Lossless for the game's purposes: shapes keep their float positions, normals and colours,
 * and the custom attributes the game reads (`_limb` on people, `_paint` on vehicles) are kept
 * as they are. Quantising (the usual extra step) would move a scale into each node, and the
 * game takes shapes out of these files without their nodes, so it isn't done.
 *
 * Run it again after any script that rewrites a model (prepare_traffic_models.mjs,
 * prepare_city_kit.py). A file that's already compressed is skipped.
 *
 * Textures inside a model (city-kit.glb's) are turned into KTX2 too, as in
 * compress_textures.mjs, when `KTX` points at the `ktx` tool from KTX-Software:
 *
 *     KTX=/path/to/ktx node scripts/compress_models.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const MODELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const only = process.argv[2]
for (const file of readdirSync(MODELS).filter((name) => name.endsWith('.glb'))) {
  if (only && !file.startsWith(only)) continue
  const path = join(MODELS, file)
  const before = statSync(path).size
  const document = await io.read(path)
  const meshopt = document.getRoot().listExtensionsUsed().some((extension) => extension.extensionName === EXTMeshoptCompression.EXTENSION_NAME)
  const pictures = document.getRoot().listTextures().filter((texture) => texture.getMimeType() !== 'image/ktx2')
  if (meshopt && (pictures.length === 0 || !process.env.KTX)) {
    console.log(`${file}: already compressed, ${(before / 1024).toFixed(0)} KB`)
    continue
  }
  if (!meshopt) {
    await document.transform(dedup(), prune())
    // FILTER keeps every attribute's type: no quantising (see above).
    document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  }
  if (pictures.length > 0 && process.env.KTX) toKtx2(document, pictures)
  await io.write(path, document)
  const after = statSync(path).size
  console.log(`${file}: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`)
}

/**
 * Turns a model's own textures into KTX2: colour as sRGB, normal maps as data. glTF textures
 * aren't flipped when uploaded, so unlike compress_textures.mjs nothing is flipped here.
 */
function toKtx2(document, textures) {
  const work = mkdtempSync(join(tmpdir(), 'deliver-it-model-ktx-'))
  const normals = new Set(document.getRoot().listMaterials().map((material) => material.getNormalTexture()).filter(Boolean))
  textures.forEach((texture, index) => {
    const extension = texture.getMimeType() === 'image/png' ? 'png' : 'jpg'
    const input = join(work, `${index}.${extension}`)
    const output = join(work, `${index}.ktx2`)
    writeFileSync(input, texture.getImage())
    const isNormal = normals.has(texture)
    const format = isNormal ? ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear'] : ['--format', 'R8G8B8_SRGB']
    execFileSync(process.env.KTX, ['create', ...format, '--encode', 'basis-lz', '--qlevel', isNormal ? '255' : '200', '--clevel', '4', '--generate-mipmap', input, output], { stdio: 'ignore' })
    texture.setImage(readFileSync(output)).setMimeType('image/ktx2')
  })
  document.createExtension(KHRTextureBasisu).setRequired(true)
}
