import { useEffect } from 'react'
import { chooseTalk, closeTalk, useTalk, useTalkGoal } from '../talk/talk'

/**
 * Talking to someone on foot (talk/talk.ts): who they are, what they say (as said, and what it
 * means), and the rider's two or three answers, picked with 1, 2, 3 or a click. Esc walks away.
 * Under it, while one is on: the line for a lift being given or a time trial being raced.
 */
export function TalkCard() {
  const card = useTalk((state) => state.card)
  const goal = useTalkGoal((state) => state.text)

  useEffect(() => {
    if (!card) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
      if (digit) {
        event.stopPropagation()
        chooseTalk(Number(digit[1]) - 1)
      } else if (event.code === 'Escape') {
        // Walking away from the talk, not opening the pause menu.
        event.stopPropagation()
        closeTalk()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [card])

  return (
    <>
      {goal && !card && (
        <p className="talk-goal" role="status">
          {goal}
        </p>
      )}
      {card && (
        <section className="talk-card" role="dialog" aria-label={`Talking to ${card.character.name}`}>
          <p className="talk-card-name">{card.character.name}</p>
          <p className="talk-card-line">“{card.text}”</p>
          {card.english && <p className="talk-card-english">{card.english}</p>}
          {card.choices.length > 0 && (
            <ol className="talk-card-choices">
              {card.choices.map((choice, index) => (
                <li key={choice.text}>
                  <button type="button" onClick={() => chooseTalk(index)}>
                    <kbd>{index + 1}</kbd>
                    <span>{choice.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  )
}
