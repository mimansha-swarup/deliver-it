import { usePolice } from '../game/police'

/** The traffic police's verdict, for a few seconds: a helmet check passed or failed, a signal jumped (traffic/JunctionWatch.tsx). */
export function PoliceCard() {
  const card = usePolice((state) => state.card)
  if (!card) return null
  return (
    <section className="guard-card police-card" role="status" aria-live="polite" data-fined={card.fine > 0}>
      <p className="guard-card-title">Traffic police · {card.where}</p>
      <p className="guard-card-line">
        <strong>{card.title}.</strong> {card.line}
      </p>
      <p className="police-card-fine">{card.fine > 0 ? `Challan · ₹${card.fine}` : 'No challan'}</p>
    </section>
  )
}
