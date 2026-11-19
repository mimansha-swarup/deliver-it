import type { Pedestrian } from './trafficLogic'

/** A person standing somewhere, for the few who aren't part of the street's crowd: staff, a customer, a guard. */
export function createPerson(x: number, z: number, heading: number, tint: number, skin: number): Pedestrian {
  return {
    lane: -1,
    along: 0,
    speed: 0,
    x,
    z,
    heading,
    lift: 0,
    tint,
    dodgeX: 0,
    dodgeZ: 0,
    stride: 0,
    walking: 0,
    skin,
    body: null,
    rotation: null,
    downTime: 0,
    down: 0,
    fallen: null,
    fallenLift: 0,
    rising: 0,
  }
}
