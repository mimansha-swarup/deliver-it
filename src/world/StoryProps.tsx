import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { PropInstances } from './RoadsideProps'
import { box, colored, merge } from './simpleShapes'
import type { StoryKind, StoryProps as Story } from './storyPlacement'

/*
 * Draws the story props (storyPlacement.ts): each kind one instanced shape built from a few boxes,
 * coloured in its vertices, some tinted per copy (a dog's coat, a chair's plastic). Small things
 * are drawn only close to the rider, on every quality: they cost little, and at riding speed
 * they only read close up anyway.
 */

const tube = (radius: number, length: number, position: [number, number, number], rotation: [number, number, number], color: string) => {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6).toNonIndexed()
  geometry.rotateX(rotation[0])
  geometry.rotateZ(rotation[2])
  geometry.translate(...position)
  return colored(geometry, color)
}

const ring = (radius: number, thickness: number, position: [number, number, number], color: string, upright = true) => {
  const geometry = new THREE.TorusGeometry(radius, thickness, 4, 14).toNonIndexed()
  if (!upright) geometry.rotateX(Math.PI / 2)
  geometry.translate(...position)
  return colored(geometry, color)
}

/** A stray dog, standing, nose along +z. White, so its coat comes from the copy's tint. */
function createDog() {
  const coat = '#ffffff'
  return merge([
    box([0.26, 0.24, 0.62], [0, 0.42, 0], coat),
    box([0.2, 0.2, 0.24], [0, 0.6, 0.38], coat),
    box([0.12, 0.1, 0.14], [0, 0.56, 0.54], '#8f857a'),
    box([0.05, 0.1, 0.05], [0.07, 0.74, 0.34], coat),
    box([0.05, 0.1, 0.05], [-0.07, 0.74, 0.34], coat),
    ...[[-0.09, 0.22], [0.09, 0.22], [-0.09, -0.22], [0.09, -0.22]].map(([x, z]) => box([0.07, 0.32, 0.07], [x, 0.16, z], coat)),
    box([0.05, 0.05, 0.28], [0, 0.56, -0.38], coat),
  ])
}

/** A cow, white or grey, with a hump and dark horns, nose along +z. */
function createCow() {
  const hide = '#ffffff'
  return merge([
    box([0.55, 0.62, 1.55], [0, 1.0, 0], hide),
    box([0.42, 0.3, 0.3], [0, 1.42, 0.45], hide),
    box([0.3, 0.34, 0.5], [0, 1.15, 0.98], hide),
    box([0.24, 0.16, 0.16], [0, 1.02, 1.24], '#3b3430'),
    box([0.05, 0.22, 0.05], [0.1, 1.42, 0.92], '#2a2522'),
    box([0.05, 0.22, 0.05], [-0.1, 1.42, 0.92], '#2a2522'),
    box([0.04, 0.4, 0.04], [0, 0.85, -0.82], hide),
    ...[[-0.18, 0.6], [0.18, 0.6], [-0.18, -0.6], [0.18, -0.6]].map(([x, z]) => box([0.12, 0.7, 0.12], [x, 0.35, z], hide)),
  ])
}

/** Two plastic chairs stacked, white, tinted by copy. */
function createChairs() {
  const plastic = '#ffffff'
  const chair = (y: number) => [
    box([0.46, 0.05, 0.44], [0, y + 0.44, 0], plastic),
    box([0.46, 0.42, 0.05], [0, y + 0.68, -0.21], plastic),
    ...[[-0.2, 0.19], [0.2, 0.19], [-0.2, -0.19], [0.2, -0.19]].map(([x, z]) => box([0.04, 0.44, 0.04], [x, y + 0.22, z], plastic)),
  ]
  return merge([...chair(0), ...chair(0.1)])
}

/** Three terracotta pots with plants, in a cluster. */
function createPots() {
  return merge(
    [[0, 0, 0.32], [0.38, 0.1, 0.26], [-0.34, -0.06, 0.22]].flatMap(([x, z, size]) => [
      tube(size * 0.55, size, [x, size / 2, z], [0, 0, 0], '#a4552f'),
      box([size * 1.1, size * 0.9, size * 1.1], [x, size * 1.4, z], '#3f7d3a'),
    ]),
  )
}

/** A garbage pile: a low dark mound with bags on it. */
function createGarbage() {
  const mound = new THREE.IcosahedronGeometry(0.75, 0).toNonIndexed()
  mound.scale(1, 0.38, 0.85)
  mound.translate(0, 0.1, 0)
  return merge([
    colored(mound, '#4a3f33'),
    box([0.34, 0.3, 0.3], [0.25, 0.36, 0.1], '#e8e4da'),
    box([0.3, 0.26, 0.28], [-0.3, 0.3, -0.12], '#2f5fa8'),
    box([0.32, 0.28, 0.3], [0, 0.42, -0.3], '#1c1c1e'),
    box([0.2, 0.16, 0.2], [-0.05, 0.5, 0.3], '#c23b2b'),
  ])
}

/** A cycle, lengthways along x, black with a dull red frame. */
function createCycle() {
  const tyre = '#1d1d1f'
  const frame = '#7a2620'
  return merge([
    ring(0.33, 0.025, [-0.52, 0.34, 0], tyre),
    ring(0.33, 0.025, [0.52, 0.34, 0], tyre),
    tube(0.02, 0.62, [0, 0.52, 0], [0, 0, Math.PI / 2], frame),
    tube(0.02, 0.6, [-0.2, 0.46, 0], [0, 0, 0.9], frame),
    tube(0.02, 0.5, [0.32, 0.5, 0], [0, 0, -0.5], frame),
    box([0.22, 0.05, 0.1], [-0.22, 0.86, 0], '#111111'),
    box([0.05, 0.05, 0.5], [0.45, 0.92, 0], '#2a2a2a'),
  ])
}

/** The morning's newspapers, rolled, by the gate. */
function createNewspapers() {
  return merge([tube(0.045, 0.32, [0, 0.05, 0], [Math.PI / 2, 0, 0], '#e3dfd2'), tube(0.04, 0.3, [0.1, 0.045, 0.03], [Math.PI / 2, 0, 0.4], '#d6d0bf')])
}

/** A transformer on a platform between two concrete poles, with its fins and bushings. */
function createTransformer() {
  const concrete = '#9d988f'
  return merge([
    box([0.2, 6, 0.2], [-0.7, 3, 0], concrete),
    box([0.2, 6, 0.2], [0.7, 3, 0], concrete),
    box([1.8, 0.1, 0.9], [0, 3.1, 0], '#5d5d5d'),
    box([0.9, 1.1, 0.7], [0, 3.7, 0], '#7e8a86'),
    box([1.05, 0.9, 0.06], [0, 3.65, 0.38], '#6c7774'),
    box([1.05, 0.9, 0.06], [0, 3.65, -0.38], '#6c7774'),
    ...[-0.3, 0, 0.3].map((x) => tube(0.05, 0.3, [x, 4.4, 0], [0, 0, 0], '#c9c2b0')),
    box([1.2, 0.5, 0.25], [0, 1.6, 0.18], '#c9b98f'),
  ])
}

/** A coil of spare cable hung on a lamp post. */
function createCable() {
  return merge([ring(0.32, 0.035, [0.16, 3.3, 0], '#151515'), ring(0.28, 0.03, [0.15, 3.25, 0.03], '#1b1b1b')])
}

const BUILDERS: Record<StoryKind, () => THREE.BufferGeometry> = {
  dog: createDog,
  cow: createCow,
  chairs: createChairs,
  pots: createPots,
  garbage: createGarbage,
  cycle: createCycle,
  newspapers: createNewspapers,
  transformer: createTransformer,
  cable: createCable,
}

/** How far each is drawn, in metres. */
const REACH: Record<StoryKind, number> = { dog: 110, cow: 160, chairs: 70, pots: 70, garbage: 110, cycle: 70, newspapers: 35, transformer: 220, cable: 120 }

/** Coats and plastics, tinted per copy. */
const TINTS: Partial<Record<StoryKind, THREE.Color[]>> = {
  dog: ['#b08550', '#c79a62', '#2b2622', '#d8cfc0', '#8a5a2b', '#9c7a52'].map((hex) => new THREE.Color(hex)),
  cow: ['#e6e1d6', '#cfc8bb', '#b9b3a8'].map((hex) => new THREE.Color(hex)),
  chairs: ['#c8302c', '#2d5fa8', '#e8e6df', '#3d8a45', '#e2a12a'].map((hex) => new THREE.Color(hex)),
}

export function StoryProps({ story }: { story: Story }) {
  const shapes = useMemo(() => Object.fromEntries(Object.entries(BUILDERS).map(([kind, build]) => [kind, build()])) as Record<StoryKind, THREE.BufferGeometry>, [])
  useEffect(() => () => Object.values(shapes).forEach((shape) => shape.dispose()), [shapes])
  return (
    <>
      {(Object.keys(BUILDERS) as StoryKind[]).map((kind) => (
        <PropInstances key={kind} props={story[kind]} geometry={shapes[kind]} colors={TINTS[kind]} sizeRange={kind === 'dog' ? 0.3 : 0.1} vertexColors to={REACH[kind]} />
      ))}
    </>
  )
}
