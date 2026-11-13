import { CHAPTER_ONE, DAILY_BONUS, DAILY_GOALS, DISPATCHER, isChapterDone } from '../game/career'
import { useGameStore } from '../game/gameStore'

/** How many of Ravi's messages the Career tab shows. */
const MESSAGES_SHOWN = 4

/** The career chapter: each goal ticked off, the current one with its count, and Ravi's latest messages. */
export function CareerSheet() {
  const career = useGameStore((state) => state.career)
  const messages = useGameStore((state) => state.messages)
  const done = isChapterDone(career)

  return (
    <section className="phone-sheet phone-career">
      <p className="phone-objective">Chapter 1 · {CHAPTER_ONE.title}</p>
      <ol className="career-goals">
        {CHAPTER_ONE.goals.map((goal, index) => {
          const state = index < career.goal ? 'done' : index === career.goal ? 'current' : 'next'
          return (
            <li key={goal.text} data-state={state}>
              <span className="career-tick" aria-hidden="true">
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span>{goal.text}</span>
              {state === 'current' && goal.target > 1 && (
                <span className="career-count">
                  {career.progress}/{goal.target}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {done && <p className="career-done">Chapter complete. Chapter 2 is coming soon.</p>}

      <p className="career-from">{DISPATCHER}</p>
      <ul className="career-messages">
        {messages.slice(0, MESSAGES_SHOWN).map(({ id, text }) => (
          <li key={id}>{text}</li>
        ))}
        {messages.length === 0 && <li>No messages yet.</li>}
      </ul>
    </section>
  )
}

function formatProgress(kind: keyof typeof DAILY_GOALS, progress: number, target: number): string {
  if (kind === 'distance') return `${(progress / 1000).toFixed(1)}/${target / 1000} km`
  return `${Math.floor(progress)}/${target}`
}

/** Today's shift: three goals with progress bars, the bonus, and the streak. */
export function TodaySheet() {
  const daily = useGameStore((state) => state.daily)
  const streak = useGameStore((state) => state.streak)

  if (!daily) {
    return (
      <section className="phone-sheet">
        <p className="phone-objective">Today's shift starts when you set off.</p>
      </section>
    )
  }

  // The bonus if today's shift is finished: higher for each day in a row, up to a cap.
  const continues = daily.done ? streak.days : streak.days + 1
  const bonus = DAILY_BONUS.credits + Math.min((continues - 1) * DAILY_BONUS.perStreakDay, DAILY_BONUS.maxStreakBonus)

  return (
    <section className="phone-sheet phone-today">
      <p className="phone-sheet-top">
        <span className="phone-objective">Today's shift</span>
        <span className="today-streak">{streak.days > 0 ? `${streak.days}-day streak` : 'No streak yet'}</span>
      </p>
      <ul className="today-goals">
        {daily.goals.map(({ kind, progress }) => {
          const { target, text } = DAILY_GOALS[kind]
          const share = Math.min(1, progress / target)
          return (
            <li key={kind} data-done={share >= 1}>
              <span className="today-text">
                {text(target)}
                <span>{formatProgress(kind, progress, target)}</span>
              </span>
              <span className="phone-level-bar">
                <span style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
            </li>
          )
        })}
      </ul>
      <p className="today-bonus">
        {daily.done
          ? `Done! Bonus paid. New goals tomorrow.`
          : `Finish all three: +${bonus} credits, +${DAILY_BONUS.xp} XP`}
      </p>
    </section>
  )
}
