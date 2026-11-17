import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { KNEE, HIP as WALK_HIP } from '../traffic/gait'

/*
 * The rider, on the same character base as the people in the street: the man
 * model from `models/traffic.glb`, bent by a shader the same way the walkers
 * are (`addWalking` in Traffic.tsx). Every corner of the model knows which limb
 * it's on (`_limb`: how much it follows the limb, the height of the joint it
 * turns about, and whether it's clothing), so cloth where a sleeve meets the
 * shoulder half-follows the arm and nothing tears.
 *
 * Each arm turns at the shoulder (forward, and out to the side) and bends at
 * the elbow; each leg turns at the hip and bends at the knee. Rider.tsx works
 * out those angles every frame from where the hands and feet must be.
 *
 * The model is dressed once, here: the jacket over the shirt, with full sleeves,
 * gloves, the rider's trousers and shoes. The head and the hair down the back of
 * the neck are hidden under the helmet and the jacket's collar.
 */

/** The elbow is this far below the shoulder (as ELBOW_DROP in Traffic.tsx). */
const ELBOW_DROP = 0.28
/** Arm corners below this, from the shoulder, are the hand: gloved. */
const HAND_DROP = 0.53
/** A hand grips this far above the lowest point of the modelled hand. */
const GRIP_ABOVE_FINGERTIPS = 0.07
/** The ankle above the ground, where the leg's bone ends. */
const ANKLE = 0.08
/** Leg corners below this are the shoe. */
const SHOE_TOP = 0.11
/**
 * The jacket's own shell, in metres: how far it stands off the body, and the sleeves' radius at
 * the shoulder, the elbow and the cuff. The model's shirt and sleeves are ragged round the
 * shoulder (their edges are meant to sit under skin), and bent far enough to reach the bars they
 * tear, so the rider wears a smooth jacket of simple shapes over them instead.
 */
const JACKET = { standOff: 0.014, shoulder: 0.068, elbow: 0.05, cuff: 0.043, rings: 16 }
/** The trousers' shell: the thigh's radius at the hip and at the knee, in metres. */
const TROUSERS = { hip: 0.085, knee: 0.062 }

/** Bare skin and hair from this far below the shoulder up is hidden: the neck, head and hair. */
const HIDE_BELOW_SHOULDER = 0.2

export type RiderLook = { jacket: string; glove: string; trousers: string; shoe: string }

/** How a limb is posed, in radians: x turned forward, y turned out to the side, z bent at the elbow or knee. */
export type LimbAngles = THREE.Vector3

export type RiderModel = {
  /** The dressed model, standing as modelled, feet at y 0. Draw it with `createRiderMaterial`. */
  geometry: THREE.BufferGeometry
  /** Measured from the model, in its own space, in metres. */
  size: {
    shoulderY: number
    shoulderX: number
    hipY: number
    hipX: number
    upperArm: number
    forearm: number
    thigh: number
    shin: number
    /** How the arm and the leg hang as modelled: forward, and out to the side, in radians. */
    armRest: { forward: number; out: number }
    legRest: { forward: number; out: number }
    /** The middle of the head, for the helmet. */
    head: THREE.Vector3
    /** The torso at the print's height: half its width, how far back its back is, and the height. */
    printHalfWidth: number
    printBack: number
    printY: number
  }
}

/** The middle of every corner of `geometry` that passes `test`. */
function average(geometry: THREE.BufferGeometry, test: (i: number) => boolean): THREE.Vector3 {
  const position = geometry.getAttribute('position')
  const sum = new THREE.Vector3()
  let count = 0
  for (let i = 0; i < position.count; i++) {
    if (!test(i)) continue
    sum.x += position.getX(i)
    sum.y += position.getY(i)
    sum.z += position.getZ(i)
    count++
  }
  return count > 0 ? sum.divideScalar(count) : sum
}

/** How a bone hangs as modelled, as the angles the shader turns by: forward, then out to the side. */
function restAngles(from: THREE.Vector3, to: THREE.Vector3): { forward: number; out: number } {
  const d = to.clone().sub(from).normalize()
  return { forward: Math.asin(THREE.MathUtils.clamp(d.z, -1, 1)), out: Math.atan2(Math.abs(d.x), -d.y) }
}

/** Dresses the man model as the rider, and measures it. */
export function createRiderModel(man: THREE.BufferGeometry, look: RiderLook): RiderModel {
  const geometry = man.clone()
  const position = geometry.getAttribute('position')
  const limb = geometry.getAttribute('_limb')

  let shoulderY = 0
  let hipY = 0
  for (let i = 0; i < limb.count; i++) {
    if (Math.abs(limb.getX(i)) < 0.5) continue
    const joint = limb.getY(i)
    if (joint > 1.1) shoulderY = Math.max(shoulderY, joint)
    else hipY = Math.max(hipY, joint)
  }
  if (shoulderY === 0) shoulderY = 1.34
  if (hipY === 0) hipY = WALK_HIP
  const elbowY = shoulderY - ELBOW_DROP
  const kneeY = hipY * (KNEE / WALK_HIP)

  const isArm = (i: number) => Math.abs(limb.getX(i)) >= 0.5 && limb.getY(i) > 1.1
  const isLeg = (i: number) => Math.abs(limb.getX(i)) >= 0.5 && limb.getY(i) <= 1.1
  const isClothing = (i: number) => limb.getZ(i) > 0.5
  const near = (y: number, band = 0.03) => (i: number) => Math.abs(position.getY(i) - y) < band
  const onLeft = (i: number) => position.getX(i) >= 0

  // ---- Dressing: colours, and which corners are hidden ----
  const colors = geometry.getAttribute('color')
  const jacket = new THREE.Color(look.jacket)
  const glove = new THREE.Color(look.glove)
  const trousers = new THREE.Color(look.trousers)
  const shoe = new THREE.Color(look.shoe)
  const hidden = new Float32Array(position.count)
  const dressed = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    let color: THREE.Color | null = null
    // Under the jacket's shell (below): the arms above the gloves, and the shirt above the belt.
    if (isArm(i) && y >= shoulderY - HAND_DROP + 0.02) hidden[i] = 1
    if (!isArm(i) && !isLeg(i) && isClothing(i) && y > hipY + 0.04) hidden[i] = 1
    // Under the trousers' shell: the thighs, and the corners round the hips that half-follow a leg,
    // which tore when a seated rider's thighs swing forward.
    if (isLeg(i) && y > kneeY + 0.03) hidden[i] = 1
    const legShare = Math.abs(limb.getX(i))
    if (legShare > 0 && legShare < 0.5 && limb.getY(i) <= 1.1) hidden[i] = 1
    if (isArm(i)) color = y < shoulderY - HAND_DROP ? glove : jacket
    else if (isLeg(i)) color = y < SHOE_TOP ? shoe : trousers
    else if (isClothing(i)) color = y > hipY ? jacket : trousers
    else if (y > shoulderY - HIDE_BELOW_SHOULDER) hidden[i] = 1
    if (y > shoulderY + 0.02 && !isArm(i)) hidden[i] = 1
    if (color) dressed.set([color.r, color.g, color.b], i * 3)
    else dressed.set([colors.getX(i), colors.getY(i), colors.getZ(i)], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(dressed, 3))
  geometry.setAttribute('aHidden', new THREE.BufferAttribute(hidden, 1))

  // ---- Measuring ----
  const shoulder = average(geometry, (i) => isArm(i) && onLeft(i) && near(shoulderY - 0.04, 0.04)(i))
  const elbow = average(geometry, (i) => isArm(i) && onLeft(i) && near(elbowY)(i))
  let lowest = Infinity
  for (let i = 0; i < position.count; i++) if (isArm(i) && onLeft(i)) lowest = Math.min(lowest, position.getY(i))
  const grip = average(geometry, (i) => isArm(i) && onLeft(i) && near(lowest + GRIP_ABOVE_FINGERTIPS, 0.03)(i))
  const hip = average(geometry, (i) => isLeg(i) && onLeft(i) && near(hipY - 0.05, 0.05)(i))
  const knee = average(geometry, (i) => isLeg(i) && onLeft(i) && near(kneeY)(i))
  const ankle = average(geometry, (i) => isLeg(i) && onLeft(i) && near(ANKLE + 0.04, 0.04)(i))
  ankle.z = knee.z
  // The shader turns limbs about joints at the joint heights, in the model's middle plane (z 0).
  const shoulderJoint = new THREE.Vector3(shoulder.x, shoulderY, 0)
  const hipJoint = new THREE.Vector3(hip.x, hipY, 0)

  const printY = shoulderY - 0.22
  let printHalfWidth = 0
  let printBack = 0
  for (let i = 0; i < position.count; i++) {
    if (isArm(i) || isLeg(i) || !near(printY, 0.06)(i)) continue
    printHalfWidth = Math.max(printHalfWidth, Math.abs(position.getX(i)))
    printBack = Math.min(printBack, position.getZ(i))
  }
  const head = average(geometry, (i) => !isArm(i) && !isLeg(i) && position.getY(i) > shoulderY + 0.14)

  // ---- The jacket's shell ----
  /** The torso's extent in a band round height y: half its width, and its front and back. */
  const torsoAt = (y: number) => {
    let half = 0
    let front = -Infinity
    let back = Infinity
    for (let i = 0; i < position.count; i++) {
      if (isArm(i) || isLeg(i) || !near(y, 0.03)(i)) continue
      half = Math.max(half, Math.abs(position.getX(i)))
      front = Math.max(front, position.getZ(i))
      back = Math.min(back, position.getZ(i))
    }
    return half > 0 ? { half, front, back } : null
  }
  const wrist = elbow.clone().lerp(grip, Math.min(1, (elbowY - (shoulderY - HAND_DROP + 0.02)) / Math.max(0.01, elbowY - grip.y)))
  const shell = createJacketShell({ shoulderY, hipY, shoulderJoint, elbow, wrist, hipJoint: new THREE.Vector3(hip.x, hipY, 0), knee, torsoAt, color: jacket, trousers, attributes: geometry })
  const merged = mergeGeometries([geometry, ...shell.parts])
  geometry.dispose()
  shell.parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('The rider\'s jacket could not be merged with the model')

  return {
    geometry: merged,
    size: {
      shoulderY,
      shoulderX: shoulder.x,
      hipY,
      hipX: hip.x,
      upperArm: elbow.distanceTo(shoulderJoint),
      forearm: grip.distanceTo(elbow),
      thigh: knee.distanceTo(hipJoint),
      shin: ankle.distanceTo(knee),
      armRest: restAngles(shoulderJoint, elbow),
      legRest: restAngles(hipJoint, knee),
      head,
      // The print wraps the jacket's shell, not the shirt under it.
      printHalfWidth: shell.at(printY)?.half ?? printHalfWidth,
      printBack: shell.at(printY)?.back ?? printBack,
      printY,
    },
  }
}

type Band = { half: number; front: number; back: number }

/**
 * The jacket's shell, in the model's space, as shapes with the model's attributes so they merge
 * with it and are posed by the same shader: a torso of rings fitted to the body, a ball at each
 * shoulder (centred on the joint, so it turns in place), a sleeve to the elbow, a ball at the
 * elbow, and a sleeve to the cuff. Sleeve corners follow the arm fully, so nothing tears.
 */
function createJacketShell({
  shoulderY,
  hipY,
  shoulderJoint,
  elbow,
  wrist,
  hipJoint,
  knee,
  torsoAt,
  color,
  trousers,
  attributes,
}: {
  shoulderY: number
  hipY: number
  shoulderJoint: THREE.Vector3
  elbow: THREE.Vector3
  wrist: THREE.Vector3
  hipJoint: THREE.Vector3
  knee: THREE.Vector3
  torsoAt: (y: number) => Band | null
  color: THREE.Color
  trousers: THREE.Color
  attributes: THREE.BufferGeometry
}): { parts: THREE.BufferGeometry[]; at: (y: number) => Band | null } {
  const parts: THREE.BufferGeometry[] = []
  /** Gives a shape exactly the model's attributes: colour, limb weights, nothing hidden, the rest zero. */
  const fit = (shape: THREE.BufferGeometry, limb: [number, number], shade = color) => {
    const count = shape.getAttribute('position').count
    for (const name of Object.keys(shape.attributes)) if (!attributes.getAttribute(name)) shape.deleteAttribute(name)
    for (const [name, attribute] of Object.entries(attributes.attributes)) {
      if (name === 'position' || name === 'normal') continue
      const values = new Float32Array(count * attribute.itemSize)
      for (let i = 0; i < count; i++) {
        if (name === 'color') values.set([shade.r, shade.g, shade.b], i * 3)
        if (name === '_limb') values.set([limb[0], limb[1], 1], i * 3)
      }
      shape.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize))
    }
    if (!shape.index) throw new Error('jacket shapes must be indexed')
    parts.push(shape)
  }

  // The torso: rings from the belt to the shoulders, each fitted to the body there, then
  // drawn in to the neck, where the collar sits.
  const bands: { y: number; band: Band }[] = []
  const steps = 7
  const top = shoulderY - 0.05
  let last: Band | null = null
  for (let k = 0; k <= steps; k++) {
    const y = hipY + 0.02 + ((top - hipY - 0.02) * k) / steps
    const found: Band | null = torsoAt(y) ?? last
    if (!found) continue
    last = found
    bands.push({ y, band: { half: found.half + JACKET.standOff, front: found.front + JACKET.standOff, back: found.back - JACKET.standOff } })
  }
  if (bands.length >= 2) {
    const upper = bands[bands.length - 1].band
    bands.push({ y: shoulderY, band: { half: upper.half * 0.82, front: upper.front * 0.85, back: upper.back * 0.85 } })
    bands.push({ y: shoulderY + 0.035, band: { half: 0.085, front: upper.front * 0.5, back: upper.back * 0.6 } })
    const torso = new THREE.CylinderGeometry(1, 1, 1, JACKET.rings, bands.length - 1, false)
    const position = torso.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      // The cylinder's rings run from its top (y 0.5) down: ring r is band (count - 1 - r).
      const ring = Math.round((0.5 - position.getY(i)) * (bands.length - 1))
      const { y, band } = bands[bands.length - 1 - ring]
      const x = position.getX(i)
      const z = position.getZ(i)
      const middle = (band.front + band.back) / 2
      const depth = (band.front - band.back) / 2
      position.setXYZ(i, x * band.half, y, middle + z * depth)
    }
    torso.computeVertexNormals()
    fit(torso, [0, 0])
  }

  // The arms, each side: left as measured, right mirrored.
  for (const side of [1, -1]) {
    const mirror = (point: THREE.Vector3) => new THREE.Vector3(point.x * side, point.y, point.z)
    const shoulder = mirror(shoulderJoint)
    const elbowAt = mirror(elbow)
    const cuffAt = mirror(wrist)
    const ball = (centre: THREE.Vector3, radius: number) => new THREE.SphereGeometry(radius, 12, 8).translate(centre.x, centre.y, centre.z)
    const sleeve = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
      const length = from.distanceTo(to)
      const tube = new THREE.CylinderGeometry(r0, r1, length, 12, 1, true)
      tube.translate(0, -length / 2, 0)
      tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize()))
      return tube.translate(from.x, from.y, from.z)
    }
    // The shoulder ball is centred on the joint, a little in, so it turns in place and rounds the yoke.
    fit(ball(shoulder.clone().setY(shoulder.y - 0.025), JACKET.shoulder), [1, shoulderY])
    // The sleeve stops just above the elbow (the shader bends what's below it) and the forearm's just below.
    const aboveElbow = elbowAt.clone().setY(elbowAt.y + 0.002)
    const belowElbow = elbowAt.clone().setY(elbowAt.y - 0.002)
    fit(sleeve(shoulder.clone().setY(shoulder.y - 0.025), aboveElbow, JACKET.shoulder * 0.9, JACKET.elbow), [1, shoulderY])
    fit(ball(elbowAt, JACKET.elbow), [1, shoulderY])
    fit(sleeve(belowElbow, cuffAt, JACKET.elbow, JACKET.cuff), [1, shoulderY])
  }

  // The trousers: the seat, a ball at each hip joint (it turns in place), a thigh to just above
  // the knee (the shader bends what's below), and a ball at the knee over the model's own shin.
  const seat = torsoAt(hipJoint.y) ?? { half: hipJoint.x + 0.1, front: 0.1, back: -0.12 }
  fit(
    new THREE.SphereGeometry(1, 14, 10)
      .scale(seat.half + JACKET.standOff, 0.13, (seat.front - seat.back) / 2 + JACKET.standOff)
      .translate(0, hipJoint.y - 0.04, (seat.front + seat.back) / 2),
    [0, 0],
    trousers,
  )
  for (const side of [1, -1]) {
    const hipAt = hipJoint.clone().setX(hipJoint.x * side)
    const kneeAt = knee.clone().setX(knee.x * side)
    const aboveKnee = kneeAt.clone().setY(kneeAt.y + 0.002)
    const ball = (centre: THREE.Vector3, radius: number) => new THREE.SphereGeometry(radius, 12, 8).translate(centre.x, centre.y, centre.z)
    const thigh = hipAt.distanceTo(aboveKnee)
    const tube = new THREE.CylinderGeometry(TROUSERS.hip, TROUSERS.knee, thigh, 12, 1, true).translate(0, -thigh / 2, 0)
    tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), aboveKnee.clone().sub(hipAt).normalize()))
    tube.translate(hipAt.x, hipAt.y, hipAt.z)
    fit(ball(hipAt, TROUSERS.hip), [1, hipJoint.y], trousers)
    fit(tube, [1, hipJoint.y], trousers)
    fit(ball(kneeAt, TROUSERS.knee), [1, hipJoint.y], trousers)
  }

  const at = (y: number): Band | null => {
    for (let k = 0; k < bands.length - 1; k++) {
      if (y >= bands[k].y && y <= bands[k + 1].y) {
        const t = (y - bands[k].y) / (bands[k + 1].y - bands[k].y)
        const a = bands[k].band
        const b = bands[k + 1].band
        return { half: a.half + (b.half - a.half) * t, front: a.front + (b.front - a.front) * t, back: a.back + (b.back - a.back) * t }
      }
    }
    return null
  }
  return { parts, at }
}

/** Each limb's pose, set every frame by Rider.tsx. */
export type RiderPose = { leftArm: LimbAngles; rightArm: LimbAngles; leftLeg: LimbAngles; rightLeg: LimbAngles }

/**
 * The rider's material: the model's colours, its limbs turned and bent on the
 * graphics card from `pose`, and its head and neck hidden.
 */
export function createRiderMaterial(model: RiderModel, pose: RiderPose): THREE.MeshStandardMaterial {
  const { size } = model
  const glsl = (value: number) => value.toFixed(5)
  const uniforms = {
    uArmL: { value: pose.leftArm },
    uArmR: { value: pose.rightArm },
    uLegL: { value: pose.leftLeg },
    uLegR: { value: pose.rightLeg },
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec3 _limb;
        attribute float aHidden;
        uniform vec3 uArmL;
        uniform vec3 uArmR;
        uniform vec3 uLegL;
        uniform vec3 uLegR;
        varying float vHidden;
        vec3 riderPosition;
        // Turns (z, y) by angle about a joint at height jointY: forward for positive angles, as the walk does.
        vec2 riderTurn(vec2 point, float jointY, float angle) {
          float down = point.y - jointY;
          float c = cos(angle);
          float s = sin(angle);
          return vec2(point.x * c - down * s, jointY + point.x * s + down * c);
        }
        // The same turns for a direction, such as a normal: no joint to turn about.
        vec2 riderTurnDirection(vec2 direction, float angle) {
          float c = cos(angle);
          float s = sin(angle);
          return vec2(direction.x * c - direction.y * s, direction.x * s + direction.y * c);
        }
        void main() {
          vHidden = aHidden;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        riderPosition = position;
        float follow = abs(_limb.x);
        if (follow > 0.0) {
          bool isArm = _limb.y > 1.1;
          float side = position.x >= 0.0 ? 1.0 : -1.0;
          vec3 angles = isArm ? (side > 0.0 ? uArmL : uArmR) : (side > 0.0 ? uLegL : uLegR);
          // Round the shoulder the weights fade smoothly with position (createRiderModel), so a
          // share of the turn spreads the cloth evenly instead of tearing it.
          angles *= follow;
          float jointY = _limb.y;
          float middleY = isArm ? jointY - ${glsl(ELBOW_DROP)} : jointY * ${glsl(KNEE / WALK_HIP)};
          float jointX = side * (isArm ? ${glsl(size.shoulderX)} : ${glsl(size.hipX)});
          // The elbow bends the forearm forward; the knee bends the shin back.
          if (position.y < middleY) {
            float bend = isArm ? angles.z : -angles.z;
            riderPosition.zy = riderTurn(riderPosition.zy, middleY, bend);
            objectNormal.zy = riderTurnDirection(objectNormal.zy, bend);
          }
          riderPosition.zy = riderTurn(riderPosition.zy, jointY, angles.x);
          objectNormal.zy = riderTurnDirection(objectNormal.zy, angles.x);
          // Then out to the side, about the joint.
          float outward = angles.y * side;
          vec2 across = riderTurnDirection(vec2(riderPosition.x - jointX, riderPosition.y - jointY), outward);
          riderPosition.xy = vec2(jointX, jointY) + across;
          objectNormal.xy = riderTurnDirection(objectNormal.xy, outward);
        }`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = riderPosition;`)
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `varying float vHidden;
      void main() {
        if (vHidden > 0.5) discard;`,
    )
  }
  material.customProgramCacheKey = () => 'rider-model'
  return material
}

const target = new THREE.Vector3()
const reach = new THREE.Vector3()

/**
 * Poses one limb so its end reaches `end` (in the rider's space): turned forward
 * and out at its joint, and bent in the middle, as the shader bends it. The
 * bend comes from how far the end is (law of cosines); the turns then aim the
 * bent limb at it. Angles are set relative to how the limb hangs as modelled.
 * Puts where the middle joint ends up, in the rider's space, for the probes.
 */
export function poseLimb(
  angles: THREE.Vector3,
  joint: THREE.Vector3,
  end: THREE.Vector3,
  first: number,
  second: number,
  rest: { forward: number; out: number },
  side: number,
  bendsBack: boolean,
  middle: THREE.Vector3,
  /** From the rider's space into the model's, and back. */
  toModel: THREE.Matrix4,
  toRider: THREE.Matrix4,
) {
  target.copy(end).applyMatrix4(toModel)
  reach.subVectors(target, joint)
  const distance = Math.min(Math.max(reach.length(), Math.abs(first - second) + 0.001), first + second - 0.001)
  reach.setLength(distance)
  const bend = Math.acos(THREE.MathUtils.clamp((distance * distance - first * first - second * second) / (2 * first * second), -1, 1))
  // How far forward of the first bone the end lies, once bent.
  const lead = Math.atan2(second * Math.sin(bend) * (bendsBack ? -1 : 1), first + second * Math.cos(bend))
  const forward = Math.asin(THREE.MathUtils.clamp(reach.z / distance, -1, 1)) - lead
  const out = Math.atan2(reach.x * side, -reach.y)
  angles.set(forward - rest.forward, out - rest.out, bend)
  // The middle joint, where the first bone ends.
  middle.set(
    joint.x + first * Math.cos(forward) * Math.sin(out * side),
    joint.y - first * Math.cos(forward) * Math.cos(out),
    joint.z + first * Math.sin(forward),
  ).applyMatrix4(toRider)
}

/**
 * Bends the model into a pose on the CPU, exactly as `createRiderMaterial`'s shader does every
 * frame: for riders who keep one pose, such as the people riding bikes in traffic.
 */
function poseOnCpu(model: RiderModel, pose: RiderPose): { positions: Float32Array; normals: Float32Array } {
  const { geometry, size } = model
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const limb = geometry.getAttribute('_limb')
  const positions = new Float32Array(position.count * 3)
  const normals = new Float32Array(position.count * 3)
  const turn = (z: number, y: number, jointY: number, angle: number): [number, number] => {
    const down = y - jointY
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [z * c - down * s, jointY + z * s + down * c]
  }
  const turnDirection = (a: number, b: number, angle: number): [number, number] => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [a * c - b * s, a * s + b * c]
  }
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i)
    let y = position.getY(i)
    let z = position.getZ(i)
    let nx = normal.getX(i)
    let ny = normal.getY(i)
    let nz = normal.getZ(i)
    const follow = Math.abs(limb.getX(i))
    if (follow > 0) {
      const jointY = limb.getY(i)
      const isArm = jointY > 1.1
      const side = x >= 0 ? 1 : -1
      const angles = (isArm ? (side > 0 ? pose.leftArm : pose.rightArm) : side > 0 ? pose.leftLeg : pose.rightLeg).clone().multiplyScalar(follow)
      const middleY = isArm ? jointY - ELBOW_DROP : jointY * (KNEE / WALK_HIP)
      const jointX = side * (isArm ? size.shoulderX : size.hipX)
      if (position.getY(i) < middleY) {
        const bend = isArm ? angles.z : -angles.z
        ;[z, y] = turn(z, y, middleY, bend)
        ;[nz, ny] = turnDirection(nz, ny, bend)
      }
      ;[z, y] = turn(z, y, jointY, angles.x)
      ;[nz, ny] = turnDirection(nz, ny, angles.x)
      const outward = angles.y * side
      const [ax, ay] = turnDirection(x - jointX, y - jointY, outward)
      x = jointX + ax
      y = jointY + ay
      ;[nx, ny] = turnDirection(nx, ny, outward)
    }
    positions.set([x, y, z], i * 3)
    normals.set([nx, ny, nz], i * 3)
  }
  return { positions, normals }
}

/** Where a seated rider's body goes on a bike, in the bike's own space (x right, y up, z forward). */
export type Seat = { hip: THREE.Vector3; lean: number; hands: THREE.Vector3; feet: THREE.Vector3 }

/**
 * A rider sitting on a bike in one pose, as one shape in the bike's own space: the dressed model
 * bent so the hands reach the bars and the feet the pegs (mirrored for the right side), with a
 * helmet over the head. The jacket is marked `_paint`, so each rider's jacket takes the colour
 * the instance is given while skin, trousers and shoes keep their own (vehiclePaint.ts).
 */
export function createSeatedRiderGeometry(model: RiderModel, look: RiderLook, seat: Seat, helmetColor: string): THREE.BufferGeometry {
  const { size } = model
  const toRiderSpace = new THREE.Matrix4()
    .makeRotationX(seat.lean)
    .setPosition(seat.hip)
    .multiply(new THREE.Matrix4().makeTranslation(0, -size.hipY, 0))
  const toModelSpace = toRiderSpace.clone().invert()
  const pose: RiderPose = { leftArm: new THREE.Vector3(), rightArm: new THREE.Vector3(), leftLeg: new THREE.Vector3(), rightLeg: new THREE.Vector3() }
  const middle = new THREE.Vector3()
  for (const [index, side] of [[0, 1], [1, -1]] as const) {
    const hand = seat.hands.clone().setX(seat.hands.x * side)
    const foot = seat.feet.clone().setX(seat.feet.x * side)
    poseLimb(index === 0 ? pose.leftArm : pose.rightArm, new THREE.Vector3(size.shoulderX * side, size.shoulderY, 0), hand, size.upperArm, size.forearm, size.armRest, side, false, middle, toModelSpace, toRiderSpace)
    poseLimb(index === 0 ? pose.leftLeg : pose.rightLeg, new THREE.Vector3(size.hipX * side, size.hipY, 0), foot, size.thigh, size.shin, size.legRest, side, true, middle, toModelSpace, toRiderSpace)
  }
  const { positions, normals } = poseOnCpu(model, pose)

  // Only whole visible triangles: the head and hair under the helmet go.
  const geometry = model.geometry
  const hidden = geometry.getAttribute('aHidden')
  const colors = geometry.getAttribute('color')
  const index = geometry.index
  const corners = index ? Array.from(index.array) : Array.from({ length: hidden.count }, (_, i) => i)
  const jacket = new THREE.Color(look.jacket)
  const kept: number[] = []
  for (let t = 0; t < corners.length; t += 3) {
    const tri = [corners[t], corners[t + 1], corners[t + 2]]
    if (tri.reduce((sum, corner) => sum + hidden.getX(corner), 0) / 3 > 0.5) continue
    kept.push(...tri)
  }
  const out = {
    position: new Float32Array(kept.length * 3),
    normal: new Float32Array(kept.length * 3),
    color: new Float32Array(kept.length * 3),
    _paint: new Float32Array(kept.length),
  }
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const turnNormals = new THREE.Matrix3().getNormalMatrix(toRiderSpace)
  kept.forEach((corner, k) => {
    p.fromArray(positions, corner * 3).applyMatrix4(toRiderSpace).toArray(out.position, k * 3)
    n.fromArray(normals, corner * 3).applyMatrix3(turnNormals).normalize().toArray(out.normal, k * 3)
    const r = colors.getX(corner)
    const g = colors.getY(corner)
    const b = colors.getZ(corner)
    out.color.set([r, g, b], k * 3)
    out._paint[k] = Math.abs(r - jacket.r) + Math.abs(g - jacket.g) + Math.abs(b - jacket.b) < 0.01 ? 1 : 0
  })
  const body = new THREE.BufferGeometry()
  for (const [name, values] of Object.entries(out)) body.setAttribute(name, new THREE.BufferAttribute(values, name === '_paint' ? 1 : 3))

  // The helmet, over the head, in its own colour.
  const helmet = new THREE.SphereGeometry(0.15, 12, 9).toNonIndexed()
  helmet.scale(0.96, 1, 1.08)
  helmet.translate(size.head.x, size.head.y, size.head.z)
  helmet.applyMatrix4(toRiderSpace)
  helmet.deleteAttribute('uv')
  const helmetRgb = new THREE.Color(helmetColor)
  helmet.setAttribute('color', new THREE.BufferAttribute(new Float32Array(helmet.getAttribute('position').count * 3).map((_, i) => [helmetRgb.r, helmetRgb.g, helmetRgb.b][i % 3]), 3))
  helmet.setAttribute('_paint', new THREE.BufferAttribute(new Float32Array(helmet.getAttribute('position').count), 1))

  const merged = mergeGeometries([body, helmet])
  body.dispose()
  helmet.dispose()
  if (!merged) throw new Error('Could not build the seated rider')
  merged.computeBoundingSphere()
  return merged
}
