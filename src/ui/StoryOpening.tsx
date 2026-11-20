import { useEffect, useState } from 'react'
import { unlockAudio } from '../audio/audioEngine'
import { playPing } from '../audio/uiSounds'
import { useT } from './menuText'

/*
 * How a new game opens: a few short cards on the title screen, before the city is built, saying
 * who the rider is and why they ride. Then the loading screen, and the tutorial's first order
 * (ui/Tutorial.tsx). Enter, Space or a click moves on; Skip or Esc goes straight to riding. It's
 * shown once, to a rider with no progress.
 */

const CARDS = [
  { time: '6:40 am · HSR Layout', text: 'Your phone buzzes before the alarm does. Amma, on the family group: “Good morning. Eat something before you go.”' },
  { time: 'The job', text: 'You ride for Deliver It. A yellow jacket, a yellow box, and a scooter with a little too much character.' },
  { time: 'The reason', text: 'Your sister Kavya has got into engineering college. The fees have not heard that you are paid per delivery.' },
  { time: 'Right now', text: 'Ravi from dispatch is already calling. Somewhere in the layout, someone wants their order swalpa fast.' },
]

export function StoryOpening({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [card, setCard] = useState(0)
  const last = card === CARDS.length - 1
  // The key press that opened the story is still on its way round the page as this appears: it isn't a press for the story.
  const [born] = useState(() => performance.now())

  const next = () => {
    unlockAudio()
    playPing('menuSelect')
    if (last) onDone()
    else setCard(card + 1)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || event.timeStamp <= born) return
      if (event.code === 'Escape') onDone()
      else if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight') {
        event.preventDefault()
        if (card === CARDS.length - 1) onDone()
        else setCard(card + 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [card, onDone, born])

  return (
    <section className="story" aria-label="How your day starts" aria-live="polite">
      <p className="story-time">{CARDS[card].time}</p>
      {/* The key replays the card's arrival for each one. */}
      <p className="story-text" key={card}>
        {CARDS[card].text}
      </p>
      <p className="story-dots" aria-hidden="true">
        {CARDS.map((_, index) => (
          <i key={index} data-on={index <= card} />
        ))}
      </p>
      <div className="story-buttons">
        {/* `title-start`: the scripts that start a ride press this until the loading screen shows. */}
        <button type="button" className="menu-button menu-primary title-start" onClick={(event) => { next(); event.currentTarget.blur() }}>
          <span className="menu-button-label">{last ? t('startRiding') : t('next')}</span>
          <kbd>Enter</kbd>
        </button>
        {!last && (
          <button type="button" className="menu-plain" onClick={onDone}>
            {t('skip')} <kbd>Esc</kbd>
          </button>
        )}
      </div>
    </section>
  )
}
