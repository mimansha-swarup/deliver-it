import { useEffect } from 'react'
import { turnAutoSaverOff, usePower } from '../game/framePacing'
import { useT } from './menuText'

/** How long the toast stays, in milliseconds. */
const SHOWN_MS = 12000

/**
 * "Battery saver on": a small note when the game has gone to 30 frames a second by itself (on
 * battery power, or as the device heats: game/framePacing.ts), with a button to turn that off for
 * good. It goes by itself after a few seconds; the switch stays in Settings.
 */
export function PowerToast() {
  const t = useT()
  const shown = usePower((state) => state.toast)
  const auto = usePower((state) => state.auto)
  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => usePower.setState({ toast: false }), SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [shown])
  if (!shown || !auto) return null
  return (
    <div className="power-toast" role="status">
      <span className="power-toast-dot" aria-hidden="true" />
      <span>
        <b>{t('saverOn')}</b> {t(auto === 'heat' ? 'saverHeat' : 'saverBattery')}
      </span>
      <button type="button" onClick={turnAutoSaverOff}>
        {t('saverOff')}
      </button>
    </div>
  )
}
