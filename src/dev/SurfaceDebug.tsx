import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { ScooterState } from '../vehicle/ScooterController'
import { SURFACE_NAMES, worldSurface, type SurfaceMap } from '../world/surfaceMap'
import { PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH } from '../world/worldUtils'
import { isDebug } from './spawn'

/*
 * Debug only (`?debug=1`): F8 colours the ground by the surface map (surfaceMap.ts), so placement
 * can be checked by eye. It's drawn just over the road and through everything, so a footprint
 * can be checked against the roads and footpaths. (Drawn higher up, to sit over the raised
 * footpaths, it would slide away from the ground it marks at a rider's eye height.) Press once
 * to see it from the rider's view, twice for the view from 120 m straight above the rider, a
 * third time to hide it. A panel lists the colours and what the placement fixes moved or
 * removed: buildings set back, boundaries, parked vehicles refused, and everything else the map
 * turned away.
 */

const KEY = 'F8'

/** One colour per surface, in `Surface` order. */
const COLORS = ['#d8c8a0', '#3a3f55', '#2bb3a0', '#c9ccd2', '#ff9a3c', '#c0305a', '#3fae4a', '#8a5a2c', '#2f7fd6']

type Mode = 'off' | 'rider' | 'above'
const NEXT: Record<Mode, Mode> = { off: 'rider', rider: 'above', above: 'off' }
/** The view from above: this high over the rider, in metres. */
const ABOVE = 120

function createMaterial(surface: SurfaceMap): THREE.ShaderMaterial {
  const texture = new THREE.DataTexture(surface.cells, surface.width, surface.depth, THREE.RedFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      map: { value: texture },
      colors: { value: COLORS.map((color) => new THREE.Color(color)) },
      origin: { value: new THREE.Vector2(PLAY_AREA.minX, PLAY_AREA.minZ) },
      size: { value: new THREE.Vector2(surface.width, surface.depth) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vGround;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vGround = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 colors[${COLORS.length}];
      uniform vec2 origin;
      uniform vec2 size;
      varying vec2 vGround;
      void main() {
        vec2 cell = (vGround - origin) / size;
        int kind = int(texture2D(map, cell).r * 255.0 + 0.5);
        vec3 color = colors[0];
        for (int i = 1; i < ${COLORS.length}; i++) if (i == kind) color = colors[i];
        // A faint metre grid, so a cell can be told from the next.
        vec2 inCell = fract(vGround);
        float line = step(0.94, max(inCell.x, inCell.y));
        gl_FragColor = vec4(mix(color, color * 0.6, line), 0.55);
      }`,
  })
}

function Panel({ mode }: { mode: Mode }) {
  const counts = worldSurface.map?.counts() ?? {}
  const report = { ...worldSurface.report, 'refused by the surface map': worldSurface.rejected as Record<string, number> }
  return (
    <div style={{ position: 'fixed', left: 12, top: 56, zIndex: 50, maxWidth: 360, maxHeight: 'calc(100vh - 160px)', overflow: 'hidden', padding: '8px 10px', borderRadius: 8, background: 'rgba(20,22,28,0.86)', color: '#eee', font: '11px/1.3 ui-monospace, monospace', pointerEvents: 'none' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Surface map ({mode === 'above' ? 'from above' : 'rider view'}) · {KEY}</div>
      {SURFACE_NAMES.map((name, kind) => (
        <div key={name}>
          <span style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, background: COLORS[kind] }} />
          {name} <span style={{ opacity: 0.6 }}>{Math.round((counts[name] ?? 0) / 1000)}k m²</span>
        </div>
      ))}
      {Object.entries(report).map(([section, values]) => (
        <div key={section} style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 700 }}>{section}</div>
          {Object.entries(values).map(([label, value]) => (
            <div key={label}>
              {label}: {value.toLocaleString()}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The overlay and its panel. Rendered inside the canvas; the panel is put on the page directly. */
export function SurfaceDebug({ surface }: { surface: SurfaceMap }) {
  const [mode, setMode] = useState<Mode>('off')
  useEffect(() => {
    if (!isDebug()) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === KEY && !event.repeat) setMode((current) => NEXT[current])
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])
  const visible = mode !== 'off'
  const material = useMemo(() => (visible ? createMaterial(surface) : null), [visible, surface])
  useEffect(
    () => () => {
      material?.uniforms.map.value.dispose()
      material?.dispose()
    },
    [material],
  )

  // The panel: plain DOM in its own root, as this sits inside the 3D canvas. A new element each
  // time, so the old root can finish unmounting without emptying the new one.
  useEffect(() => {
    if (mode === 'off') return
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    root.render(<Panel mode={mode} />)
    return () => {
      setTimeout(() => {
        root.unmount()
        host.remove()
      })
    }
  }, [mode])

  if (!material) return null
  return (
    <>
      <mesh material={material} rotation-x={-Math.PI / 2} position={[PLAY_AREA.minX + PLAY_AREA_WIDTH / 2, 0.03, PLAY_AREA.minZ + PLAY_AREA_DEPTH / 2]} renderOrder={1000} frustumCulled={false}>
        <planeGeometry args={[PLAY_AREA_WIDTH, PLAY_AREA_DEPTH]} />
      </mesh>
      {mode === 'above' && <ViewFromAbove />}
    </>
  )
}

/**
 * Holds the camera straight above the rider, north up. Mounted after the follow camera, so its
 * frame callback runs after the follow camera's and wins.
 */
function ViewFromAbove() {
  useFrame(({ camera }) => {
    const scooter = (window as unknown as { __deliverItScooter?: ScooterState }).__deliverItScooter
    if (!scooter) return
    camera.position.set(scooter.x, ABOVE, scooter.z)
    camera.up.set(0, 0, -1)
    camera.lookAt(scooter.x, 0, scooter.z)
    camera.up.set(0, 1, 0)
  })
  return null
}
