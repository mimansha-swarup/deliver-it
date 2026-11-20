import { FILE_PREFIX } from '../game/brand'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CHALLENGE_BONUS, challengeFor, useToday } from '../game/today'
import { buildScoreCard, scoreCardText } from './scoreCardImage'

/*
 * The daily challenge on the phone (the Deliver It app's Today tab): what it is, how far along,
 * and the score card: a picture of the day (ui/scoreCardImage.ts) to share. On a phone the share sheet
 * takes it straight to WhatsApp; on a laptop it's saved or copied, to drop into a chat.
 */

type Shown = { url: string; blob: Blob }

function ScoreCardView({ onClose }: { onClose: () => void }) {
  const [card, setCard] = useState<Shown | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    let url = ''
    void buildScoreCard().then((canvas) => {
      canvas.toBlob((blob) => {
        if (!blob || cancelled) return
        url = URL.createObjectURL(blob)
        setCard({ url, blob })
      }, 'image/png')
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [])
  // Esc closes it, before anything behind it hears the key.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKey, { capture: true })
    return () => window.removeEventListener('keydown', handleKey, { capture: true })
  }, [onClose])

  const file = () => (card ? new File([card.blob], `${FILE_PREFIX}-${useToday.getState().stats.date}.png`, { type: 'image/png' }) : null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && card !== null && navigator.canShare({ files: [file() as File] })
  const share = async () => {
    const picture = file()
    if (!picture) return
    try {
      await navigator.share({ files: [picture], text: scoreCardText() })
    } catch {
      // Closed without sharing: nothing to say.
    }
  }
  const copy = async () => {
    if (!card) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': card.blob })])
      setNote('Copied: paste it into a chat.')
    } catch {
      setNote('This browser won’t copy pictures: save it instead.')
    }
  }

  return createPortal(
    <section className="score-card-view" role="dialog" aria-label="Today's score card">
      <div className="score-card-box">
        {card ? <img src={card.url} alt="Today's score card: the daily challenge, your route, orders, earnings and rating" /> : <p className="score-card-wait">Drawing your card…</p>}
        <p className="score-card-buttons">
          {canShare && (
            <button type="button" onClick={() => void share()}>
              Share (WhatsApp…)
            </button>
          )}
          {card && (
            <a className="score-card-save" href={card.url} download={`${FILE_PREFIX}-${useToday.getState().stats.date}.png`}>
              Save the picture
            </a>
          )}
          <button type="button" onClick={() => void copy()} disabled={!card}>
            Copy
          </button>
          <a className="score-card-save" href={`https://wa.me/?text=${encodeURIComponent(scoreCardText())}`} target="_blank" rel="noreferrer">
            WhatsApp text
          </a>
          <button type="button" className="score-card-close" onClick={onClose}>
            Close · Esc
          </button>
        </p>
        {note && <p className="score-card-note">{note}</p>}
      </div>
    </section>,
    document.body,
  )
}

/** The day's headline challenge, its progress, and the score card. */
export function DailyChallenge() {
  const stats = useToday((state) => state.stats)
  const [open, setOpen] = useState(false)
  const challenge = challengeFor(stats.date)
  const progress = Math.min(challenge.target, challenge.progress(stats))
  const done = progress >= challenge.target
  return (
    <section className="phone-sheet daily-challenge" data-done={done}>
      <p className="phone-sheet-top">
        <span className="phone-objective">Daily challenge</span>
        <span className="today-streak">{done ? 'Done ✓' : `+₹${CHALLENGE_BONUS}`}</span>
      </p>
      <p className="daily-challenge-text">{challenge.text}</p>
      <span className="phone-level-bar">
        <span style={{ width: `${Math.round((progress / challenge.target) * 100)}%` }} />
      </span>
      <p className="today-bonus">
        {challenge.id === 'earn600' ? `₹${Math.floor(progress)} of ₹${challenge.target}` : challenge.id === 'far' ? `${progress.toFixed(1)} of ${challenge.target} km · ${stats.orders} orders` : `${Math.floor(progress)} of ${challenge.target}`} · today: {stats.orders} orders, ₹{stats.earnings}
      </p>
      <button type="button" className="app-wide-button" onClick={(event) => { setOpen(true); event.currentTarget.blur() }}>
        Today’s score card
      </button>
      {open && <ScoreCardView onClose={() => setOpen(false)} />}
    </section>
  )
}
