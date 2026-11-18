import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/*
 * Every key the game listens for, by action, changeable in the phone's Settings (Controls) and
 * listed in the help overlay (F1 or ?). Each action has one or more keys, by `KeyboardEvent.code`
 * so they follow the key's place, not the letter on it. Enter and Esc aren't remappable: they're
 * the phone's unlock and the back key everywhere. Saved apart from the game's progress.
 */

export type Action =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'handbrake'
  | 'nitro'
  | 'online'
  | 'accept'
  | 'decline'
  | 'map'
  | 'phone'
  | 'horn'
  | 'radio'
  | 'sleep'
  | 'skipTime'
  | 'weather'
  | 'help'

export const ACTIONS: { id: Action; label: string; group: 'Riding' | 'Work' | 'Phone and map' | 'Other' }[] = [
  { id: 'forward', label: 'Ride forward', group: 'Riding' },
  { id: 'backward', label: 'Brake and reverse', group: 'Riding' },
  { id: 'left', label: 'Steer left', group: 'Riding' },
  { id: 'right', label: 'Steer right', group: 'Riding' },
  { id: 'handbrake', label: 'Drift (hold while turning)', group: 'Riding' },
  { id: 'nitro', label: 'Nitro', group: 'Riding' },
  { id: 'horn', label: 'Horn', group: 'Riding' },
  { id: 'online', label: 'Go online or offline', group: 'Work' },
  { id: 'accept', label: 'Accept an order', group: 'Work' },
  { id: 'decline', label: 'Decline an order', group: 'Work' },
  { id: 'sleep', label: 'Sleep (at home)', group: 'Work' },
  { id: 'phone', label: 'Phone', group: 'Phone and map' },
  { id: 'map', label: 'Full map', group: 'Phone and map' },
  { id: 'radio', label: 'Next radio station', group: 'Phone and map' },
  { id: 'skipTime', label: 'Skip three hours', group: 'Other' },
  { id: 'weather', label: 'Change the weather', group: 'Other' },
  { id: 'help', label: 'Help and keys', group: 'Other' },
]

export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight'],
  online: ['KeyO'],
  accept: ['KeyY'],
  decline: ['KeyX'],
  map: ['Tab'],
  phone: ['KeyP'],
  horn: ['KeyH'],
  radio: ['KeyR'],
  sleep: ['KeyZ'],
  skipTime: ['KeyN'],
  weather: ['KeyM'],
  help: ['F1', 'Slash'],
}

/** Keys that can't be given to an action. */
export const RESERVED_KEYS = new Set(['Escape', 'Enter'])

type KeyStore = {
  bindings: Record<Action, string[]>
  /** Makes `code` the action's main key (keeping its others), taking it from any other action. */
  bind: (action: Action, code: string) => void
  reset: () => void
}

export const useKeys = create<KeyStore>()(
  persist(
    (set) => ({
      bindings: DEFAULT_KEYS,
      bind: (action, code) =>
        set((state) => {
          if (RESERVED_KEYS.has(code)) return state
          const bindings = { ...state.bindings }
          for (const other of Object.keys(bindings) as Action[]) {
            if (other !== action) bindings[other] = bindings[other].filter((key) => key !== code)
          }
          const rest = bindings[action].slice(1).filter((key) => key !== code)
          bindings[action] = [code, ...rest]
          return { bindings }
        }),
      reset: () => set({ bindings: DEFAULT_KEYS }),
    }),
    {
      name: 'deliver-it-keys',
      // A save from before an action existed gets that action's default keys.
      merge: (saved, current) => ({ ...current, bindings: { ...DEFAULT_KEYS, ...((saved as Partial<KeyStore>)?.bindings ?? {}) } }),
    },
  ),
)

/** Whether a key press is bound to an action. */
export function isKey(action: Action, code: string): boolean {
  return useKeys.getState().bindings[action].includes(code)
}

const NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Right Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Tab: 'Tab',
  Slash: '?',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Backslash: '\\',
  CapsLock: 'Caps Lock',
}

/** How a key is shown: `KeyW` as W, `Digit3` as 3, `ArrowUp` as ↑. */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

/** An action's main key, as shown. */
export function keyFor(action: Action): string {
  return keyName(useKeys.getState().bindings[action][0] ?? '')
}

/** An action's main key, as shown, following changes. */
export function useKeyName(action: Action): string {
  return useKeys((state) => keyName(state.bindings[action][0] ?? ''))
}
