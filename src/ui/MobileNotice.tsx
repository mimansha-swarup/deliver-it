import { GAME_NAME, GAME_NAME_KANNADA } from '../game/brand'
import { Logo } from './Logo'
import { useState } from 'react'

/**
 * What a phone or tablet sees instead of the game. Swalpa Fast needs a keyboard,
 * so this says where to play it and makes the link easy to pass on. It's
 * deliberately light: none of the game's code or files are downloaded on a phone.
 */
export function MobileNotice() {
  const [copied, setCopied] = useState(false)
  const address = window.location.origin + window.location.pathname
  const canShare = typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="title-screen mobile-notice">
      <div className="title-backdrop" aria-hidden="true">
        <img src="/title/shop-street-morning.jpg" alt="" data-shown="true" />
      </div>

      <section className="title-main">
        <h1 className="title-logo">
          <Logo />
        </h1>
        <p className="title-kannada" lang="kn">
          {GAME_NAME_KANNADA}
        </p>
        <p className="title-lede">{GAME_NAME} is played on a computer, with a keyboard.</p>
        <p className="mobile-notice-text">
          Open this page on a laptop or desktop to ride. Send yourself the link so it's there when you are.
        </p>

        <div className="title-actions">
          {canShare ? (
            <button
              type="button"
              className="title-start"
              data-ready="true"
              onClick={() => void navigator.share({ title: GAME_NAME, url: address }).catch(() => undefined)}
            >
              <span className="title-start-label">Share the link</span>
            </button>
          ) : null}
          <button type="button" className={canShare ? 'title-help-button' : 'title-start'} data-ready="true" onClick={() => void copy()}>
            <span className="title-start-label">{copied ? 'Link copied' : 'Copy the link'}</span>
          </button>
        </div>
        <p className="title-facts">{address}</p>
      </section>

      <p className="title-note">Independent prototype. Not an official product.</p>
    </main>
  )
}
