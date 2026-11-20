import { FullCredits } from './Credits'
import { useEffect, useState } from 'react'
import { ACTIONS, isKey, keyName, RESERVED_KEYS, useKeys, type Action } from '../game/keyBindings'

/** Every action and its keys, by group: for the help overlay and the phone's Controls settings. */
export function KeyList({ editable = false }: { editable?: boolean }) {
  const bindings = useKeys((state) => state.bindings)
  const bind = useKeys((state) => state.bind)
  const reset = useKeys((state) => state.reset)
  const [listening, setListening] = useState<Action | null>(null)

  // Changing a key: the next key pressed is caught before the game sees it.
  useEffect(() => {
    if (!listening) return
    const capture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code !== 'Escape' && !RESERVED_KEYS.has(event.code)) bind(listening, event.code)
      setListening(null)
    }
    window.addEventListener('keydown', capture, { capture: true })
    return () => window.removeEventListener('keydown', capture, { capture: true })
  }, [listening, bind])

  const groups = [...new Set(ACTIONS.map(({ group }) => group))]
  return (
    <div className="key-list">
      {groups.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <dl>
            {ACTIONS.filter((action) => action.group === group).map(({ id, label }) => (
              <div key={id} className="key-row">
                <dt>{label}</dt>
                <dd>
                  {editable ? (
                    <button type="button" className="key-change" data-listening={listening === id} onClick={(event) => { setListening(id); event.currentTarget.blur() }}>
                      {listening === id ? 'Press a key… (Esc cancels)' : bindings[id].map(keyName).join(' / ') || 'None'}
                    </button>
                  ) : (
                    bindings[id].map((code) => <kbd key={code}>{keyName(code)}</kbd>)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="key-fixed">
        <kbd>Enter</kbd> unlocks the phone · <kbd>Esc</kbd> goes back · <kbd>V</kbd> driver's seat view (cab vehicles)
      </p>
      <p className="key-fixed">
        <kbd>Right mouse</kbd> hold and move to look around · <kbd>Click</kbd> the view to lock the pointer (<kbd>Esc</kbd> frees it) · on foot, <kbd>W</kbd> walks the way the camera is looking, <kbd>S</kbd> towards it and <kbd>A</kbd> <kbd>D</kbd> across it; hold the nitro key to jog
      </p>
      {editable && (
        <button type="button" className="key-reset" onClick={(event) => { reset(); event.currentTarget.blur() }}>
          Reset to the default keys
        </button>
      )}
    </div>
  )
}

/** F1 or ? shows every control, over the game: the keys as they're bound, and the mouse. Esc or the same key closes it. */
export function HelpOverlay() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isKey('help', event.code) && !event.repeat) {
        event.preventDefault()
        setOpen((value) => !value)
      } else if (event.code === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])
  if (!open) return null
  return (
    <section className="help-overlay" role="dialog" aria-label="Controls">
      <header>
        <h2>Controls</h2>
        <button type="button" onClick={() => setOpen(false)}>
          Close · Esc
        </button>
      </header>
      <KeyList />
      <p className="help-note">Change any of them in the phone: Settings → Controls. The picture quality is there too.</p>
      <p className="help-note help-credits">
        <FullCredits />
      </p>
    </section>
  )
}
