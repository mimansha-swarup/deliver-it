import { liveLook } from '../camera/mouseLook'
import { usePause } from '../ui/uiState'
import { useGameStore } from './gameStore'
import { useKeys, type Action } from './keyBindings'
import { useSettings } from './settings'

/*
 * A game controller (the standard layout: Xbox, PlayStation, and most others in a browser).
 *
 * The game is played by keys everywhere: riding, walking, the phone, the menus. So the controller
 * presses those keys: each button and stick direction stands for one action's key (whatever it is
 * bound to), pressed while held and let go after. Nothing else in the game needs to know about it.
 * The right stick turns the view, as the mouse does.
 *
 *   Riding and walking         Menus and the phone
 *   left stick / d-pad  steer, walk     move
 *   RT, LT              go, brake       -
 *   A                   use             choose (Enter)
 *   B                   handbrake       back (Esc)
 *   X, Y                get on or off, accept an order
 *   LB, RB              decline, nitro or jog
 *   d-pad up, down      phone, go online
 *   View, Menu          map, pause
 *   L3, R3              horn, radio
 */

/** How far a stick has to be pushed to count, for steering and for the menus; how far a trigger; and how fast the right stick turns the view, in radians a second. */
const STICK = { steer: 0.3, menu: 0.55, trigger: 0.15, look: 2.4, lookDead: 0.18 }

const BUTTON = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 }

const held = new Set<string>()
let last = 0
let running = false

function press(code: string, down: boolean) {
  // Sent where the keyboard's would be: the menus listen on the document, the game on the window.
  const target = document.activeElement instanceof HTMLElement && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement) ? document.activeElement : document.body
  target.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, bubbles: true, cancelable: true }))
}

function poll(time: number) {
  const pad = [...navigator.getGamepads()].find((one) => one && one.connected && one.mapping === 'standard') ?? [...navigator.getGamepads()].find((one) => one && one.connected)
  if (!pad) {
    for (const code of held) press(code, false)
    held.clear()
    running = false
    return
  }
  requestAnimationFrame(poll)
  const delta = Math.min(0.1, (time - last) / 1000)
  last = time
  const button = (index: number) => pad.buttons[index]?.pressed ?? false
  const amount = (index: number) => pad.buttons[index]?.value ?? 0
  const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes
  const key = (action: Action) => useKeys.getState().bindings[action][0]
  const game = useGameStore.getState()
  const inMenu = !game.started || usePause.getState().open || document.querySelector('.story, .phone-raised') !== null
  const want = new Set<string>()
  const add = (on: boolean, code: string | undefined) => {
    if (on && code) want.add(code)
  }

  if (inMenu) {
    add(button(BUTTON.up) || ly < -STICK.menu, 'ArrowUp')
    add(button(BUTTON.down) || ly > STICK.menu, 'ArrowDown')
    add(button(BUTTON.left) || lx < -STICK.menu, 'ArrowLeft')
    add(button(BUTTON.right) || lx > STICK.menu, 'ArrowRight')
    add(button(BUTTON.a), 'Enter')
    add(button(BUTTON.b) || button(BUTTON.menu), 'Escape')
  } else {
    add(button(BUTTON.left) || lx < -STICK.steer, key('left'))
    add(button(BUTTON.right) || lx > STICK.steer, key('right'))
    add(amount(BUTTON.rt) > STICK.trigger || ly < -STICK.menu, key('forward'))
    add(amount(BUTTON.lt) > STICK.trigger || ly > STICK.menu, key('backward'))
    add(button(BUTTON.a), key('interact'))
    add(button(BUTTON.b), key('handbrake'))
    add(button(BUTTON.x), key('mount'))
    add(button(BUTTON.y), key('accept'))
    add(button(BUTTON.lb), key('decline'))
    add(button(BUTTON.rb), key('nitro'))
    add(button(BUTTON.l3), key('horn'))
    add(button(BUTTON.r3), key('radio'))
    add(button(BUTTON.up), key('phone'))
    add(button(BUTTON.down), key('online'))
    add(button(BUTTON.view), key('map'))
    add(button(BUTTON.menu), 'Escape')
    // The right stick turns the view, as dragging the mouse does.
    if (!game.photoMode && Math.hypot(rx, ry) > STICK.lookDead) {
      const { lookSpeed, invertY } = useSettings.getState()
      liveLook.yaw -= rx * STICK.look * lookSpeed * delta
      liveLook.yaw = Math.atan2(Math.sin(liveLook.yaw), Math.cos(liveLook.yaw))
      liveLook.pitch = Math.max(-0.5, Math.min(0.9, liveLook.pitch + ry * STICK.look * 0.6 * lookSpeed * delta * (invertY ? -1 : 1)))
      liveLook.movedAt = performance.now()
    }
  }

  for (const code of held) {
    if (!want.has(code)) {
      held.delete(code)
      press(code, false)
    }
  }
  for (const code of want) {
    if (!held.has(code)) {
      held.add(code)
      press(code, true)
    }
  }
}

if (typeof window !== 'undefined' && 'getGamepads' in navigator) {
  const start = () => {
    if (running) return
    running = true
    last = performance.now()
    requestAnimationFrame(poll)
  }
  window.addEventListener('gamepadconnected', start)
  // One that was already in when the page opened says so on its first button press, which is that same event.
}
