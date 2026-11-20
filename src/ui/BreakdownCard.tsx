import { useEffect, useState } from 'react'
import { FLEET_RULES, locked, useFleet } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { useKeyName } from '../game/keyBindings'
import { setPrompt } from '../game/prompts'
import { UPKEEP, useUpkeep } from '../game/upkeep'
import { MARKET, VEHICLES } from '../vehicle/vehicleCatalog'

/*
 * Broken down (game/upkeep.ts): what's wrong, and the two ways on. The roadside mechanic mends it
 * where it stands (the interact key, or the button). Or the phone's offer: GaadiGo brings the
 * cheapest vehicle the rider may rent, for an hour, and the broken one is towed to the Garage. A
 * rental that breaks down is GaadiGo's to fix, at no charge.
 */
export function BreakdownCard() {
  const vehicleId = useGameStore((state) => state.vehicleId)
  const broken = useUpkeep((state) => state.broken)
  // Short of the mechanic's price, it still gets mended: the rest goes on Ravi's tab (gameStore's `dues`).
  const credits = useGameStore((state) => state.credits)
  const rental = useFleet((state) => state.rental)
  const delivery = useFleet((state) => state.delivery)
  const interactKey = useKeyName('interact')
  const [note, setNote] = useState('')
  // Not in Explore: nothing is broken down there (game/upkeep.ts).
  const explore = useGameStore((state) => state.explore)
  const here = broken !== null && broken.id === vehicleId && !explore
  const rented = rental?.id === vehicleId

  // The mechanic is also on the interact key, as a prompt, while the card is up.
  useEffect(() => {
    if (!here || broken?.mending || rented) {
      setPrompt('breakdown', null)
      return
    }
    setPrompt('breakdown', { action: 'interact', text: `Roadside mechanic · ₹${UPKEEP.mechanic.price}`, priority: 4, run: () => setNote(useUpkeep.getState().callMechanic() ?? '') })
    return () => setPrompt('breakdown', null)
  }, [here, broken?.mending, rented])

  if (!here || !broken) return null
  const spec = VEHICLES[vehicleId]
  // The cheapest thing GaadiGo will rent this rider: the offer on the phone.
  const offer = MARKET.map((id) => VEHICLES[id])
    .filter((option) => option.id !== vehicleId && locked(option) === null)
    .sort((a, b) => a.rentHour - b.rentHour)[0]
  return (
    <section className="breakdown-card" role="alertdialog" aria-label="Breakdown">
      <p className="breakdown-title">Breakdown</p>
      <p className="breakdown-what">
        Your {spec.name} has {broken.fault}.
      </p>
      {broken.mending ? (
        <p className="breakdown-note">The mechanic is at it…</p>
      ) : rented ? (
        <p className="breakdown-buttons">
          <button type="button" onClick={(event) => { useUpkeep.getState().mend(0, 'GaadiGo’s roadside van has mended it, no charge'); event.currentTarget.blur() }}>
            Call GaadiGo roadside · free on a rental
          </button>
        </p>
      ) : (
        <p className="breakdown-buttons">
          <button type="button" onClick={(event) => { setNote(useUpkeep.getState().callMechanic() ?? ''); event.currentTarget.blur() }}>
            <kbd>{interactKey}</kbd> Roadside mechanic · ₹{UPKEEP.mechanic.price}
            {credits < UPKEEP.mechanic.price && ' · Ravi covers the rest'}
          </button>
          {offer && !delivery && !rental && (
            <button
              type="button"
              className="breakdown-rent"
              onClick={(event) => {
                setNote(useFleet.getState().rent(offer.id, 'hour', false, 'deliver') ?? `GaadiGo is bringing a ${offer.name}. This one will be towed to your Garage (₹${UPKEEP.tow}).`)
                event.currentTarget.blur()
              }}
            >
              GaadiGo nearby: rent a {offer.name} · ₹{offer.rentHour + FLEET_RULES.deliveryFee}
            </button>
          )}
        </p>
      )}
      {(note || delivery) && <p className="breakdown-note">{note || 'A GaadiGo vehicle is on its way: wait beside this one.'}</p>}
    </section>
  )
}
