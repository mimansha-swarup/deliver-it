import { useState, type MouseEvent } from 'react'
import {
  HELMETS,
  MAX_UPGRADE_LEVEL,
  PAINTS,
  UPGRADE_KINDS,
  UPGRADES,
  type Colour,
} from '../game/garage'
import { useGameStore } from '../game/gameStore'

type Tab = 'upgrades' | 'paint' | 'helmet'

const TABS: { id: Tab; label: string }[] = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'paint', label: 'Paint' },
  { id: 'helmet', label: 'Helmet' },
]

/** Gives the keyboard back to the game after a click, so Space doesn't press the button again. */
function blurAfter(action: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    action()
    event.currentTarget.blur()
  }
}

function Upgrades() {
  const credits = useGameStore((state) => state.credits)
  const upgrades = useGameStore((state) => state.upgrades)
  const buyUpgrade = useGameStore((state) => state.buyUpgrade)

  return (
    <ul className="garage-list">
      {UPGRADE_KINDS.map((kind) => {
        const { name, effect, prices } = UPGRADES[kind]
        const level = upgrades[kind]
        const price = prices[level]
        const maxed = level >= MAX_UPGRADE_LEVEL

        return (
          <li key={kind} className="garage-upgrade">
            <div>
              <p className="garage-name">
                {name}
                <span className="garage-pips" aria-label={`Level ${level} of ${MAX_UPGRADE_LEVEL}`}>
                  {Array.from({ length: MAX_UPGRADE_LEVEL }, (_, index) => (
                    <span key={index} data-on={index < level} />
                  ))}
                </span>
              </p>
              <p className="garage-effect">{effect}</p>
            </div>
            <button
              type="button"
              disabled={maxed || credits < price}
              onClick={blurAfter(() => buyUpgrade(kind))}
            >
              {maxed ? 'Maxed' : `${price}`}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Colours({
  list,
  owned,
  chosen,
  choose,
}: {
  list: Colour[]
  owned: string[]
  chosen: string
  choose: (id: string) => void
}) {
  const credits = useGameStore((state) => state.credits)

  return (
    <ul className="garage-colours">
      {list.map(({ id, name, color, price, careerOnly }) => {
        const isOwned = owned.includes(id)
        const inUse = chosen === id
        const locked = !isOwned && careerOnly
        return (
          <li key={id}>
            <button
              type="button"
              aria-pressed={inUse}
              disabled={locked || (!isOwned && credits < price)}
              onClick={blurAfter(() => choose(id))}
            >
              <span className="garage-swatch" style={{ background: color }} />
              <span className="garage-colour-name">{name}</span>
              <span className="garage-colour-state">
                {inUse ? 'In use' : isOwned ? 'Use' : locked ? 'Career reward' : price}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The Garage, on the raised phone at the dark store. Upgrades change how the
 * scooter rides, and paint and helmet colours change only how it looks.
 */
export function Garage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('upgrades')
  const credits = useGameStore((state) => state.credits)
  const paintId = useGameStore((state) => state.paintId)
  const helmetId = useGameStore((state) => state.helmetId)
  const ownedPaints = useGameStore((state) => state.ownedPaints)
  const ownedHelmets = useGameStore((state) => state.ownedHelmets)
  const choosePaint = useGameStore((state) => state.choosePaint)
  const chooseHelmet = useGameStore((state) => state.chooseHelmet)

  return (
    <section className="phone-sheet phone-garage" aria-label="Garage">
      <header className="garage-header">
        <p className="phone-objective">Garage</p>
        <p className="garage-credits">{credits} credits</p>
        <button type="button" className="garage-done" onClick={blurAfter(onClose)}>
          Done
        </button>
      </header>

      <div className="garage-tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={blurAfter(() => setTab(id))}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'upgrades' && <Upgrades />}
      {tab === 'paint' && (
        <Colours list={PAINTS} owned={ownedPaints} chosen={paintId} choose={choosePaint} />
      )}
      {tab === 'helmet' && (
        <Colours list={HELMETS} owned={ownedHelmets} chosen={helmetId} choose={chooseHelmet} />
      )}
    </section>
  )
}
