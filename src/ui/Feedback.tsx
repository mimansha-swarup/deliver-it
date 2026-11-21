import { useState } from 'react'
import { VERSION } from '../game/brand'
import { useGameStore } from '../game/gameStore'
import { MenuPanel } from './Menu'

/*
 * Feedback, from the pause menu and the title screen: what you liked, what broke, and an email only
 * if a reply is wanted. It goes to the site's own form inbox (Netlify Forms, through the hidden form
 * in index.html): no account, no third party beyond the host. Sent with it: the game's version and
 * the picture quality, which say what was being played. Nothing else.
 */

const encode = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

export function FeedbackPanel({ onBack }: { onBack: () => void }) {
  const [liked, setLiked] = useState('')
  const [broke, setBroke] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'writing' | 'sending' | 'sent' | 'failed'>('writing')
  const empty = liked.trim() === '' && broke.trim() === ''
  // Typing here mustn't ride the scooter or move the menu.
  const keep = (event: React.KeyboardEvent) => event.stopPropagation()

  const send = async () => {
    setState('sending')
    try {
      const reply = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encode({ 'form-name': 'feedback', liked: liked.slice(0, 2000), broke: broke.slice(0, 2000), email: email.slice(0, 200), version: VERSION, quality: useGameStore.getState().quality }),
      })
      setState(reply.ok ? 'sent' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <MenuPanel title="Feedback" onBack={onBack}>
      {state === 'sent' ? (
        <div className="room-panel">
          <p>Thank you! It has been sent.</p>
        </div>
      ) : (
        <div className="room-panel feedback">
          <label className="room-name">
            <span>What did you like?</span>
            <textarea rows={3} value={liked} maxLength={2000} onChange={(event) => setLiked(event.target.value)} onKeyDown={keep} />
          </label>
          <label className="room-name">
            <span>What broke, or annoyed you?</span>
            <textarea rows={3} value={broke} maxLength={2000} onChange={(event) => setBroke(event.target.value)} onKeyDown={keep} />
          </label>
          <label className="room-name">
            <span>Email, only if you want a reply (optional)</span>
            <input type="email" value={email} maxLength={200} onChange={(event) => setEmail(event.target.value)} onKeyDown={keep} />
          </label>
          <button type="button" className="menu-button menu-primary" disabled={empty || state === 'sending'} onClick={() => void send()}>
            <span className="menu-button-label">{state === 'sending' ? 'Sending…' : 'Send feedback'}</span>
          </button>
          {state === 'failed' && <p className="room-error">It couldn’t be sent. Check your connection and try again.</p>}
          <p className="menu-note">Sent with it: the game’s version and your picture quality. Nothing else about you or your device.</p>
        </div>
      )}
    </MenuPanel>
  )
}
