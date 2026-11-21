/*
 * How far a controller's stick and triggers are pushed, for the vehicle's controller to read
 * (ScooterController.ts): steering from -1 (right) to 1 (left), throttle and brake from 0 to 1.
 * Null means nothing analog is being used just then, and the keys decide, all or nothing, as they
 * always have. Set by game/gamepad.ts; plain numbers, as `livePlayer` is.
 */
export const analog = { steer: null as number | null, throttle: null as number | null, brake: null as number | null }
