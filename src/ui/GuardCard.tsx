import { useGuard } from '../game/doorsteps'

/**
 * At the gated society's gate: the order's OTP as the rider reads it out to the guard, then the
 * line they write in the visitors' register (missions/Errand.tsx runs it).
 */
export function GuardCard() {
  const card = useGuard((state) => state.card)
  if (!card) return null
  return (
    <section className="guard-card" role="status" aria-live="polite" data-step={card.step}>
      <p className="guard-card-title">Security · {card.society}</p>
      {card.step === 'otp' ? (
        <>
          <p className="guard-card-line">“OTP please, for flat {card.flat}.”</p>
          <p className="guard-card-otp" aria-label={`OTP ${card.otp}`}>
            {card.otp.split('').map((digit, index) => (
              <span key={index} style={{ animationDelay: `${index * 0.32}s` }}>{digit}</span>
            ))}
          </p>
        </>
      ) : (
        <>
          <p className="guard-card-line">Visitors’ register</p>
          <table className="guard-card-register">
            <thead>
              <tr><th>Name</th><th>Flat</th><th>In</th><th>Sign</th></tr>
            </thead>
            <tbody>
              <tr><td>Deliver It rider</td><td>{card.flat}</td><td>{card.time}</td><td className="guard-card-sign">D. It</td></tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
