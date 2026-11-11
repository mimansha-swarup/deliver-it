import type { DriveInput } from './ScooterController'

/**
 * What the on-screen buttons are holding. `TouchControls` writes here and
 * `useDriveInput` reads it alongside the keyboard, so the scooter can't tell
 * which one is being used.
 */
export const touchInput: DriveInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
}
