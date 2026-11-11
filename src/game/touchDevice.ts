/**
 * Whether the main pointer is a finger. Phones and tablets say "coarse", while a
 * mouse or trackpad says "fine". A touchscreen laptop with a trackpad says "fine",
 * so it keeps the keyboard layout.
 *
 * Adding `?touch` to the address forces the phone layout, to try it on a computer.
 */
export const isTouchDevice =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches ||
    new URLSearchParams(window.location.search).has('touch'))
