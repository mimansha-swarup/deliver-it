import * as THREE from 'three'
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

  return {
    geometry,
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
      printHalfWidth,
      printBack,
      printY,
    },
  }
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
          // A walk swings an arm a little, and cloth that half-follows it looks right. Reaching for the
          // bars raises it most of the way to level, which would stretch that cloth into spikes: here
          // the shoulder's cloth either goes with the arm or stays with the body, over a narrow band.
          angles *= isArm ? smoothstep(0.3, 0.6, follow) : follow;
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
