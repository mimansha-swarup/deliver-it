import { create } from 'zustand'
import type { DataConnection, Peer } from 'peerjs'
import { useGameStore } from '../game/gameStore'
import { liveSky, livePlayer } from '../game/livePlayer'
import type { VehicleId } from '../vehicle/vehicleCatalog'

/*
 * Rooms: up to six riders in the same HSR, joined by an invite link. Browser to browser (WebRTC,
 * through the PeerJS library and its public broker, which only introduces the browsers to each
 * other): there is no game server. The rider who makes the room is its host; the others connect
 * to the host, who passes everyone's news on to everyone else. If the host leaves, the room ends.
 *
 * What's shared is small: where each rider is (ten times a second), the clock and the weather (the
 * host's), and a round when one is on. Each browser still runs its own traffic and people: riders
 * see each other, not each other's traffic, and pass through one another.
 *
 * Rounds, started by the host:
 * - delivery: everyone delivers for a set time; the most earned in it wins.
 * - race: to a spot the host has pinned on the map; the first there wins.
 *
 * Nothing here is saved, and a room never changes anyone's own save beyond what they earn riding.
 * Players' browsers learn each other's network addresses, as WebRTC needs.
 */

export const ROOM = { most: 6, sendEvery: 100, worldEvery: 2000, quietFor: 6000, codeLength: 5, deliveryMinutes: 10, raceReach: 14, countdown: 5 }
const PEER_PREFIX = 'swalpa-fast-room-'
/** Letters and digits that aren't mistaken for one another when read out. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLOURS = ['#f6b32b', '#3ddc97', '#5ea2ff', '#e0457b', '#ff8a3d', '#8f7ae6']

export type Rider = {
  id: string
  name: string
  colour: string
  /** Where they are (their vehicle, or themselves on foot), which way they face, and how high. */
  x: number
  z: number
  heading: number
  height: number
  onFoot: boolean
  /** On foot: where their vehicle stands. */
  vehicleX: number
  vehicleZ: number
  vehicleHeading: number
  vehicle: VehicleId
  speed: number
  /** Earned in the round so far, or their place in a finished race (0 until they arrive). */
  score: number
  /** When their news last came, by this browser's clock. */
  seenAt: number
}

export type Round =
  | { kind: 'delivery'; endsAt: number; done: boolean }
  | { kind: 'race'; x: number; z: number; node: number; startsAt: number; done: boolean; finished: { id: string; name: string }[] }

type Message =
  | { t: 'rider'; rider: Omit<Rider, 'seenAt'> }
  | { t: 'gone'; id: string }
  | { t: 'world'; hours: number }
  /** A round with times as "milliseconds from now", since clocks differ between computers. */
  | { t: 'round'; round: { kind: 'delivery'; left: number } | { kind: 'race'; x: number; z: number; node: number; startsIn: number } | null }
  | { t: 'finished'; id: string; name: string }
  | { t: 'full' }

type RoomState = {
  status: 'off' | 'connecting' | 'on' | 'failed'
  error: string | null
  code: string | null
  host: boolean
  me: { id: string; name: string; colour: string }
  riders: Record<string, Rider>
  round: Round | null
  /** What this rider has earned in the round that's on. */
  roundEarned: number
}

export const useRoomStore = create<RoomState>(() => ({ status: 'off', error: null, code: null, host: false, me: { id: '', name: '', colour: COLOURS[0] }, riders: {}, round: null, roundEarned: 0 }))

let peer: Peer | null = null
/** The host's connections to everyone; a guest's one connection to the host. */
const links = new Map<string, DataConnection>()
let timers: number[] = []
let stopWatching: (() => void) | null = null

/** The code in the address (`?room=ABCDE`), if this visit came by an invite link. */
export function invitedTo(): string | null {
  if (typeof location === 'undefined') return null
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
  return code.length === ROOM.codeLength ? code : null
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`
}

const cleanName = (name: string) => name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14) || 'Rider'

function send(message: Message, except?: string) {
  for (const [id, link] of links) if (id !== except && link.open) link.send(message)
}

// What's earned in a round is counted delivery by delivery, as each lands at the top of the history.
// (It was once the history's total now less its total at the start, but the history only keeps the
// last few deliveries: for a rider with a full one, each new delivery pushed an old one out and
// the total stood still, so their score stayed at nothing.)
useGameStore.subscribe((state, previous) => {
  const latest = state.history[0]
  if (!latest || latest.id === previous.history[0]?.id) return
  const { round, roundEarned, status } = useRoomStore.getState()
  if (status === 'on' && round?.kind === 'delivery' && !round.done) useRoomStore.setState({ roundEarned: roundEarned + latest.earned + latest.tip })
})

function myNews(): Omit<Rider, 'seenAt'> {
  const { me, round, roundEarned } = useRoomStore.getState()
  const game = useGameStore.getState()
  const place = round?.kind === 'race' ? round.finished.findIndex(({ id }) => id === me.id) + 1 : 0
  return {
    id: me.id,
    name: me.name,
    colour: me.colour,
    x: livePlayer.x,
    z: livePlayer.z,
    heading: livePlayer.heading,
    height: livePlayer.height,
    onFoot: livePlayer.onFoot,
    vehicleX: livePlayer.vehicleX,
    vehicleZ: livePlayer.vehicleZ,
    vehicleHeading: livePlayer.vehicleHeading ?? livePlayer.heading,
    vehicle: game.vehicleId,
    speed: game.speedKmh,
    score: round?.kind === 'delivery' ? roundEarned : place,
  }
}

function startRound(round: Round | null) {
  useRoomStore.setState({ round, roundEarned: 0 })
  const game = useGameStore.getState()
  if (round?.kind === 'race') game.setWaypoint({ x: round.x, z: round.z, node: round.node })
  if (round?.kind === 'delivery' && game.duty === 'off') game.goOnline()
}

function hear(message: Message, from: string) {
  const state = useRoomStore.getState()
  if (message.t === 'rider') {
    const first = !state.riders[message.rider.id]
    useRoomStore.setState({ riders: { ...state.riders, [message.rider.id]: { ...message.rider, name: cleanName(message.rider.name), seenAt: performance.now() } } })
    if (first) useGameStore.getState().raviSays(`${cleanName(message.rider.name)} has joined your room.`)
    // The host passes everyone's news on.
    if (state.host) send(message, from)
  } else if (message.t === 'gone') {
    drop(message.id)
    if (state.host) send(message, from)
  } else if (message.t === 'world') {
    // The host's clock is the room's: nudged to it when it has drifted, not every time.
    if (Math.abs(((message.hours - liveSky.hours + 36) % 24) - 12) > 0.08) liveSky.setHoursTo = message.hours
  } else if (message.t === 'round') {
    const now = Date.now()
    const { round } = message
    startRound(round === null ? null : round.kind === 'delivery' ? { kind: 'delivery', endsAt: now + round.left, done: false } : { kind: 'race', x: round.x, z: round.z, node: round.node, startsAt: now + round.startsIn, done: false, finished: [] })
  } else if (message.t === 'finished') {
    arrived(message.id, message.name)
    if (state.host) send(message, from)
  } else if (message.t === 'full') {
    fail('That room is full: six riders already.')
  }
}

function drop(id: string) {
  const { riders } = useRoomStore.getState()
  if (!riders[id]) return
  const rest = { ...riders }
  delete rest[id]
  useRoomStore.setState({ riders: rest })
  useGameStore.getState().raviSays(`${riders[id].name} has left the room.`)
}

function arrived(id: string, name: string) {
  const { round } = useRoomStore.getState()
  if (round?.kind !== 'race' || round.finished.some((one) => one.id === id)) return
  const finished = [...round.finished, { id, name }]
  useRoomStore.setState({ round: { ...round, finished } })
  if (finished.length === 1) useGameStore.getState().raviSays(`${name} got there first! Race won.`)
}

function fail(error: string) {
  leaveRoom()
  useRoomStore.setState({ status: 'failed', error })
}

/** Runs while in a room: sends this rider's news, the host's clock, and watches the round. */
function run() {
  timers.push(
    window.setInterval(() => {
      if (!useGameStore.getState().started) return
      send({ t: 'rider', rider: myNews() })
      const state = useRoomStore.getState()
      const now = performance.now()
      // Someone not heard from for a while has gone (a closed tab says nothing).
      for (const rider of Object.values(state.riders)) if (now - rider.seenAt > ROOM.quietFor) drop(rider.id)
      const { round, me } = state
      if (round?.kind === 'race' && !round.done && Date.now() >= round.startsAt && !round.finished.some(({ id }) => id === me.id)) {
        if (Math.hypot(livePlayer.x - round.x, livePlayer.z - round.z) < ROOM.raceReach) {
          arrived(me.id, me.name)
          send({ t: 'finished', id: me.id, name: me.name })
        }
      }
      if (round?.kind === 'delivery' && !round.done && Date.now() >= round.endsAt) {
        useRoomStore.setState({ round: { ...round, done: true } })
        const table = standings()
        if (table[0]) useGameStore.getState().raviSays(`Time! ${table[0].name} wins the round with ₹${table[0].score}.`)
      }
    }, ROOM.sendEvery),
  )
  timers.push(
    window.setInterval(() => {
      if (useRoomStore.getState().host) send({ t: 'world', hours: liveSky.hours })
    }, ROOM.worldEvery),
  )
}

/** Everyone in the room with this rider among them, best first: by money in a delivery round, by arrival in a race. */
export function standings(): { id: string; name: string; colour: string; score: number; me: boolean }[] {
  const { riders, round } = useRoomStore.getState()
  const mine = myNews()
  const all = [{ ...mine, me: true }, ...Object.values(riders).map((rider) => ({ ...rider, me: false }))].map(({ id, name, colour, score, me: isMe }) => ({ id, name, colour, score, me: isMe }))
  if (round?.kind === 'race') return all.sort((a, b) => (a.score || 99) - (b.score || 99))
  return all.sort((a, b) => b.score - a.score)
}

async function open(id: string | undefined): Promise<Peer> {
  const { Peer: PeerClass } = await import('peerjs')
  return new Promise((resolve, reject) => {
    const made = id ? new PeerClass(id) : new PeerClass()
    made.on('open', () => resolve(made))
    made.on('error', (error) => reject(error))
  })
}

function begin(code: string, host: boolean, name: string, id: string) {
  const colour = COLOURS[Math.abs([...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)) % COLOURS.length]
  useRoomStore.setState({ status: 'on', error: null, code, host, me: { id, name: cleanName(name), colour }, riders: {}, round: null })
  run()
  // Leaving the page says goodbye, so the others don't wait for the silence to notice.
  const bye = () => send({ t: 'gone', id })
  window.addEventListener('pagehide', bye)
  stopWatching = () => window.removeEventListener('pagehide', bye)
}

/** Makes a room and waits in it for the others. Returns its code. */
export async function createRoom(name: string): Promise<string | null> {
  leaveRoom()
  useRoomStore.setState({ status: 'connecting', error: null })
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = Array.from({ length: ROOM.codeLength }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('')
    try {
      peer = await open(PEER_PREFIX + code)
    } catch {
      continue
    }
    peer.on('connection', (link) => {
      link.on('open', () => {
        if (links.size >= ROOM.most - 1) {
          link.send({ t: 'full' } satisfies Message)
          window.setTimeout(() => link.close(), 500)
          return
        }
        links.set(link.peer, link)
        // A newcomer is told the round that's on, with what's left of it.
        const { round } = useRoomStore.getState()
        if (round && !round.done) link.send({ t: 'round', round: round.kind === 'delivery' ? { kind: 'delivery', left: round.endsAt - Date.now() } : { kind: 'race', x: round.x, z: round.z, node: round.node, startsIn: round.startsAt - Date.now() } } satisfies Message)
        for (const rider of Object.values(useRoomStore.getState().riders)) link.send({ t: 'rider', rider } satisfies Message)
      })
      link.on('data', (data) => hear(data as Message, link.peer))
      link.on('close', () => {
        links.delete(link.peer)
        drop(link.peer)
        send({ t: 'gone', id: link.peer })
      })
    })
    begin(code, true, name, peer.id)
    return code
  }
  useRoomStore.setState({ status: 'failed', error: 'Could not open a room. Check your connection and try again.' })
  return null
}

/** Joins the room with this code. Resolves once connected to its host, or false if it can't be. */
export async function joinRoom(code: string, name: string): Promise<boolean> {
  leaveRoom()
  useRoomStore.setState({ status: 'connecting', error: null })
  try {
    peer = await open(undefined)
  } catch {
    useRoomStore.setState({ status: 'failed', error: 'Could not connect. Check your connection and try again.' })
    return false
  }
  const made = peer
  return new Promise((resolve) => {
    const link = made.connect(PEER_PREFIX + code, { reliable: false })
    const giveUp = window.setTimeout(() => {
      fail('No room answers to that code. It may have ended, or your network may not allow a direct connection.')
      resolve(false)
    }, 12000)
    link.on('open', () => {
      window.clearTimeout(giveUp)
      links.set(link.peer, link)
      begin(code, false, name, made.id)
      resolve(true)
    })
    link.on('data', (data) => hear(data as Message, link.peer))
    link.on('close', () => {
      if (useRoomStore.getState().status === 'on') fail('The room has ended: its host left.')
    })
    made.on('error', () => {
      window.clearTimeout(giveUp)
      fail('No room answers to that code. It may have ended.')
      resolve(false)
    })
  })
}

export function leaveRoom() {
  const { me, status } = useRoomStore.getState()
  if (status === 'on') send({ t: 'gone', id: me.id })
  timers.forEach((timer) => window.clearInterval(timer))
  timers = []
  stopWatching?.()
  stopWatching = null
  links.clear()
  peer?.destroy()
  peer = null
  useRoomStore.setState({ status: 'off', code: null, host: false, riders: {}, round: null })
}

/** The host starts a delivery round for everyone. */
export function startDeliveryRound(minutes = ROOM.deliveryMinutes) {
  if (!useRoomStore.getState().host) return
  const left = minutes * 60 * 1000
  send({ t: 'round', round: { kind: 'delivery', left } })
  startRound({ kind: 'delivery', endsAt: Date.now() + left, done: false })
  useGameStore.getState().raviSays(`Delivery round: ${minutes} minutes. Most earned wins. Go!`)
}

/** The host starts a race to the spot they've pinned on the map. False with no pin. */
export function startRace(): boolean {
  const { waypoint } = useGameStore.getState()
  if (!useRoomStore.getState().host || !waypoint) return false
  const startsIn = ROOM.countdown * 1000
  send({ t: 'round', round: { kind: 'race', ...waypoint, startsIn } })
  startRound({ kind: 'race', ...waypoint, startsAt: Date.now() + startsIn, done: false, finished: [] })
  return true
}

export function endRound() {
  if (!useRoomStore.getState().host) return
  send({ t: 'round', round: null })
  startRound(null)
}

// Debug: the room, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItRoom?: unknown }).__deliverItRoom = { store: useRoomStore, standings, startDeliveryRound, startRace, endRound }
}
