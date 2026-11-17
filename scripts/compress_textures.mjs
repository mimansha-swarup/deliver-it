#!/usr/bin/env node
/**
 * Encodes the world's tiling textures as KTX2 (Basis ETC1S, with mipmaps) into public/textures.
 * They stay compressed on the GPU, so each takes about an eighth of the memory of a JPEG
 * texture, uploads faster, and downloads at about half the size.
 *
 *     KTX=/path/to/ktx node scripts/compress_textures.mjs
 *
 * `KTX` is the `ktx` tool from KTX-Software (github.com/KhronosGroup/KTX-Software, v4.4+).
 * The originals live in art/textures (not served). Photos that the game draws onto a canvas
 * (the wall colours, the shop boards) can't be GPU-compressed and stay JPEG in public/textures.
 *
 * Each picture is flipped top to bottom first: a JPEG texture is flipped as it's uploaded and a
 * KTX2 one can't be, so this keeps every texture the same way up as before.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KTX = process.env.KTX ?? 'ktx'

/** Colour pictures are sRGB; normal and alpha maps are data, kept exactly as they are. */
const TEXTURES = {
  color: ['road-color', 'pavement-color', 'ground-color', 'park-color', 'grass-color', 'leaf-color', 'bark-color'],
  data: ['road-normal', 'pavement-normal', 'wall-normal', 'concrete-normal', 'brick-normal', 'grass-alpha', 'leaf-alpha'],
}

const work = mkdtempSync(join(tmpdir(), 'deliver-it-ktx-'))
for (const [kind, names] of Object.entries(TEXTURES)) {
  for (const name of names) {
    const source = join(ROOT, 'art', 'textures', `${name}.jpg`)
    const flipped = join(work, `${name}.png`)
    const output = join(ROOT, 'public', 'textures', `${name}.ktx2`)
    execFileSync('sips', ['-s', 'format', 'png', '--flip', 'vertical', source, '--out', flipped], { stdio: 'ignore' })
    const format = kind === 'color' ? ['--format', 'R8G8B8_SRGB'] : ['--format', 'R8G8B8_UNORM', '--assign-tf', 'linear']
    // Normal maps get the top quality: blocky normals show as ripples in the light.
    const quality = name.endsWith('-normal') ? '255' : '200'
    execFileSync(KTX, ['create', ...format, '--encode', 'basis-lz', '--qlevel', quality, '--clevel', '4', '--generate-mipmap', flipped, output])
    console.log(`${name}: ${(statSync(source).size / 1024).toFixed(0)} KB jpg -> ${(statSync(output).size / 1024).toFixed(0)} KB ktx2`)
  }
}
