import { useEffect, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { useSettings } from '../game/settings'
import { createRoom, dismissRoomError, endRound, inviteLink, invitedTo, joinRoom, leaveRoom, retryRoom, ROOM, standings, startDeliveryRound, startRace, useRoomStore } from '../net/room'
import { MenuPanel } from './Menu'

/*
 * Rooms on screen (net/room.ts). On the title screen: a panel to make a room and copy its invite
 * link, or to join the one a link points at, with the name the others will see. While riding: a
 * small card with who's here, the round's clock and scores, and, for the host, the buttons that
 * start a delivery round or a race.
 */

/** The title screen's panel. `onRide` starts the game once in a room. */
export function FriendsPanel({ onBack, onRide }: { onBack: () => void; onRide: () => void }) {
  const status = useRoomStore((state) => state.status)
  const error = useRoomStore((state) => state.error)
  const code = useRoomStore((state) => state.code)
  const host = useRoomStore((state) => state.host)
  const saved = useSettings((state) => state.playerName)
  const [name, setName] = useState(saved)
  const [copied, setCopied] = useState(false)
  const invited = invitedTo()
  const busy = status === 'connecting'
  const keepName = () => useSettings.getState().set({ playerName: name.trim().slice(0, 14) })

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(inviteLink(code))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <MenuPanel title="Play with friends" onBack={onBack}>
      <div className="room-panel">
        <p>
          Up to {ROOM.most} riders in the same HSR. Roam together, or the host starts a round: a timed delivery contest, or a race to a spot on the map. Everyone keeps their own
          save.
        </p>
        <label className="room-name">
          <span>Your name in the room</span>
          <input type="text" value={name} maxLength={14} placeholder="Rider" disabled={status === 'on'} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
        </label>

        {status !== 'on' && invited && (
          <button type="button" className="menu-button menu-primary" disabled={busy} onClick={() => { keepName(); void joinRoom(invited, name) }}>
            <span className="menu-button-label">{busy ? 'Joining…' : `Join room ${invited}`}</span>
            <span className="menu-button-detail">You were sent this room's link</span>
          </button>
        )}
        {status !== 'on' && (
          <button type="button" className={invited ? 'menu-plain' : 'menu-button menu-primary'} disabled={busy} onClick={() => { keepName(); void createRoom(name) }}>
            {invited ? 'Or make a new room' : <><span className="menu-button-label">{busy ? 'Opening a room…' : 'Make a room'}</span><span className="menu-button-detail">You get a link to send to friends</span></>}
          </button>
        )}
        {error && (
          <div className="room-error" role="alert">
            <p>{error}</p>
            <button type="button" className="menu-plain" disabled={busy} onClick={() => retryRoom()}>
              Try again
            </button>
          </div>
        )}

        {status === 'on' && code && (
          <>
            <p className="room-code">
              Room <strong>{code}</strong> {host ? '· you are the host' : '· joined'}
            </p>
            {host && (
              <div className="room-link">
                <input type="text" readOnly value={inviteLink(code)} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => event.stopPropagation()} />
                <button type="button" className="menu-plain" onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
            <button type="button" className="menu-button menu-primary title-start" onClick={onRide}>
              <span className="menu-button-label">Start riding</span>
              <span className="menu-button-detail">{host ? 'Friends can join any time while you ride' : 'Into the room'}</span>
            </button>
            <button type="button" className="menu-plain" onClick={() => leaveRoom()}>
              Leave the room
            </button>
          </>
        )}
        <p className="menu-note">
          Rooms connect your browsers directly to each other, so riders in a room can learn each other's network address. Only share the link with people you know. Some office
          and college networks block this kind of connection.
        </p>
      </div>
    </MenuPanel>
  )
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** While riding in a room: who's here, the round, and the host's buttons. */
export function RoomCard() {
  const status = useRoomStore((state) => state.status)
  const code = useRoomStore((state) => state.code)
  const host = useRoomStore((state) => state.host)
  const round = useRoomStore((state) => state.round)
  const error = useRoomStore((state) => state.error)
  const hasPin = useGameStore((state) => state.waypoint !== null)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  // The table and the clock are read fresh twice a second.
  useEffect(() => {
    if (status !== 'on') return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [status])
  // The connection was lost or never made, while riding: say so, with a way to try again.
  if (status === 'failed' || status === 'connecting') {
    return (
      <section className="room-card" aria-label="Your room" role="alert">
        <p className="room-card-round">{status === 'connecting' ? 'Connecting to the room…' : 'Room: couldn’t connect'}</p>
        {error && <p>{error}</p>}
        {status === 'failed' && (
          <p className="room-card-buttons">
            <button type="button" onClick={(event) => { retryRoom(); event.currentTarget.blur() }}>Try again</button>
            <button type="button" onClick={(event) => { dismissRoomError(); event.currentTarget.blur() }}>Dismiss</button>
          </p>
        )}
      </section>
    )
  }
  if (status !== 'on' || !code) return null

  const table = standings()
  const racing = round?.kind === 'race'
  const waiting = racing && now < round.startsAt
  let headline = `${table.length} of ${ROOM.most} riders · free roam`
  if (round?.kind === 'delivery') headline = round.done ? 'Delivery round over' : `Delivery round · ${clock(round.endsAt - now)} left`
  if (racing) headline = waiting ? `Race starts in ${Math.ceil((round.startsAt - now) / 1000)}…` : round.finished.length > 0 ? `Race · ${round.finished[0].name} won` : 'Race! Follow the pin'
  const blur = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    action()
    event.currentTarget.blur()
  }

  return (
    <section className="room-card" aria-label="Your room" data-go={waiting ? 'wait' : undefined}>
      <p className="room-card-top">
        <strong>Room {code}</strong>
        <button type="button" onClick={blur(() => void navigator.clipboard.writeText(inviteLink(code)).then(() => setCopied(true)).catch(() => undefined))}>{copied ? 'Copied' : 'Copy link'}</button>
      </p>
      <p className="room-card-round">{headline}</p>
      <ol className="room-card-riders">
        {table.map((rider, place) => (
          <li key={rider.id} data-me={rider.me}>
            <i style={{ background: rider.colour }} />
            <span>{rider.name}{rider.me ? ' (you)' : ''}</span>
            {round?.kind === 'delivery' && <b>₹{rider.score}</b>}
            {racing && rider.score > 0 && <b>{rider.score === 1 ? '1st' : rider.score === 2 ? '2nd' : rider.score === 3 ? '3rd' : `${rider.score}th`}</b>}
            {!round && place === 0 && table.length === 1 && <b>alone</b>}
          </li>
        ))}
      </ol>
      {host && (
        <p className="room-card-buttons">
          {!round || round.done || (racing && round.finished.length > 0) ? (
            <>
              <button type="button" onClick={blur(() => startDeliveryRound())}>{ROOM.deliveryMinutes}-min delivery round</button>
              <button type="button" disabled={!hasPin} title={hasPin ? 'Race to your pin on the map' : 'Pin a spot on the full map first'} onClick={blur(() => void startRace())}>
                {hasPin ? 'Race to my pin' : 'Race: pin a spot on the map'}
              </button>
              {round && <button type="button" onClick={blur(() => endRound())}>Back to free roam</button>}
            </>
          ) : (
            <button type="button" onClick={blur(() => endRound())}>End the round</button>
          )}
        </p>
      )}
      <p className="room-card-buttons">
        <button type="button" onClick={blur(() => leaveRoom())}>Leave room</button>
      </p>
    </section>
  )
}
