import { useState } from 'react'
import { useFleet } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { levelFromXp, MAX_LEVEL, xpForLevel } from '../game/progression'
import { clearDebugSave } from '../game/saveKeys'
import { averageRating, RATINGS_KEPT } from '../missions/orderStory'
import { MARKET, VEHICLES } from '../vehicle/vehicleCatalog'

/*
 * Debug unlocks, in the phone's Settings with `?debug=1`: set the level, the rating and the rupees,
 * and own every vehicle. All of it lands in the debug save (game/saveKeys.ts), never the real one.
 */

/** Ratings that average out at a value: fives and fours (or lower), as many as the save keeps. */
function ratingsFor(average: number): number[] {
  const low = Math.max(1, Math.min(4, Math.floor(average)))
  const high = Math.min(5, low + 1)
  const highs = Math.round((average - low) * RATINGS_KEPT)
  return Array.from({ length: RATINGS_KEPT }, (_, index) => (index < highs ? high : low))
}

export function DebugPanel() {
  const xp = useGameStore((state) => state.xp)
  const credits = useGameStore((state) => state.credits)
  const ratings = useGameStore((state) => state.ratings)
  const owned = useFleet((state) => state.owned)
  const [note, setNote] = useState('')
  const level = levelFromXp(xp)
  const rating = averageRating(ratings)
  const setLevel = (value: number) => useGameStore.setState({ xp: xpForLevel(Math.max(1, Math.min(MAX_LEVEL, Math.round(value) || 1))) })
  const setRating = (value: number) => useGameStore.setState({ ratings: ratingsFor(Math.max(1, Math.min(5, value || 5))) })
  const setCredits = (value: number) => useGameStore.setState({ credits: Math.max(0, Math.round(value) || 0) })
  const unlockAll = () => {
    // Own everything on the market, and be senior enough to take any of them out.
    const top = MARKET.reduce((most, id) => Math.max(most, VEHICLES[id].minLevel), 1)
    if (level < top) setLevel(top)
    setRating(5)
    useFleet.setState({ owned: [...MARKET] })
    setNote('Every vehicle is in your Garage: take one out in GaadiGo.')
  }
  return (
    <section className="app-card debug-panel" onKeyDown={(event) => event.stopPropagation()}>
      <p className="app-card-title">Debug · separate save</p>
      <label className="debug-field">
        Level
        <input type="number" min={1} max={MAX_LEVEL} value={level} onChange={(event) => setLevel(Number(event.target.value))} />
      </label>
      <label className="debug-field">
        Rating
        <input type="number" min={1} max={5} step={0.1} value={rating === null ? 5 : Number(rating.toFixed(1))} onChange={(event) => setRating(Number(event.target.value))} />
      </label>
      <label className="debug-field">
        Rupees
        <input type="number" min={0} step={100} value={credits} onChange={(event) => setCredits(Number(event.target.value))} />
      </label>
      <button type="button" className="app-wide-button" onClick={(event) => { unlockAll(); event.currentTarget.blur() }}>
        Unlock all vehicles ({owned.length}/{MARKET.length} owned)
      </button>
      <button
        type="button"
        className="app-wide-button"
        onClick={() => {
          clearDebugSave()
          location.reload()
        }}
      >
        Reset the debug save
      </button>
      <p className="app-line app-muted">{note || 'Nothing here touches your real save.'}</p>
    </section>
  )
}
