import { create } from 'zustand'
import { showSubtitle } from '../audio/subtitle'
import { linesOf, pickLine, readingTime, speak, type VoiceLine } from '../audio/voice'
import { cityEvents, type CityEventKind } from '../game/cityEvents'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { liveRoom } from '../game/rooms'
import { RUSH_ON, rushHour } from '../game/rush'
import { saveKey } from '../game/saveKeys'
import { useSettings } from '../game/settings'
import data from './characters.json'

/*
 * Talking to people. On foot, E near someone who has something to say opens a short exchange: what
 * they say (a recorded line, once it's recorded; its words and their meaning on a card either
 * way), and two or three things the rider can answer. Who they are, every line and every choice
 * are data (characters.json): this file only knows how to read it. Adding a person, a line or a
 * branch needs no code; a new kind of effect or a new place to stand does (the lists below, and
 * TalkSpots.tsx, which stands people in the world).
 */

/** Where a character is found: outside every chai stall, at the gated society's gate, outside the dark stores, at some bus stops, or beside an auto the rider has bumped. */
export type Where = 'chaiStall' | 'societyGate' | 'darkStore' | 'busStop' | 'bumpedAuto'
export type Choice = { text: string; if?: string; do?: string[]; go?: string }
type Said = { say?: string; before?: string; after?: string }
export type TalkNode = Said & { pick?: (Said & { if?: string })[]; do?: string[]; choices: Choice[] }
export type Character = {
  id: string
  name: string
  prompt: string
  where: Where
  look: { body: string; tint: number }
  start: { if?: string; go: string }[]
  nodes: Record<string, TalkNode>
}

export const CHARACTERS = data.characters as unknown as Character[]
export const characterAt = (where: Where) => CHARACTERS.find((character) => character.where === where) ?? null

/** What's on the card: who is speaking, their words and what they mean, and what the rider can say. */
export type TalkCard = { character: Character; text: string; english: string; choices: Choice[] }
export const useTalk = create<{ card: TalkCard | null }>(() => ({ card: null }))

/** A place someone wants to go, or a race ends: worked out by whoever knows the map (TalkSpots.tsx). */
export type Plan = { place: string; x: number; z: number; seconds: number; reward: number }

/**
 * What the world lends the talk: how to plan and start a lift and a time trial, and how to send the
 * auto on its way (TalkSpots.tsx sets these). And what is going on now: `plan`, the one being
 * offered; `lift` and `trial`, the ones under way; `deliveries`, to the building whose guard is
 * being talked to; `jamTip`, the chai anna's tip, kept for the next order.
 */
export const talkLive = {
  planLift: null as (() => Plan | null) | null,
  planTrial: null as (() => Plan | null) | null,
  startLift: null as ((plan: Plan) => void) | null,
  startTrial: null as ((plan: Plan) => void) | null,
  release: null as (() => void) | null,
  plan: null as Plan | null,
  lift: null as Plan | null,
  trial: null as (Plan & { left: number }) | null,
  jamTip: null as string | null,
}

/** Where the bus stops are, for the aunty and for where lifts and races end: set as the world is planned (World.tsx). */
export const talkPlaces: { stops: { x: number; z: number; rotation: number; name: string }[] } = { stops: [] }

/** The line shown while a lift or a time trial is on (ui/TalkCard.tsx), written a few times a second. */
export const useTalkGoal = create<{ text: string | null }>(() => ({ text: null }))

// ---- What's remembered between visits: how often each person has been talked to, and deliveries to the guard's building.
const MEMORY_KEY = saveKey('swalpa-fast-talk')
type Memory = { visits: Record<string, number>; societyDeliveries: number }
function readMemory(): Memory {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as Partial<Memory>
    return { visits: saved.visits ?? {}, societyDeliveries: saved.societyDeliveries ?? 0 }
  } catch {
    return { visits: {}, societyDeliveries: 0 }
  }
}
const memory = readMemory()
function keepMemory() {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Not kept: the guard forgets by the next visit.
  }
}

/** A delivery has been signed in at the gated society's gate: the guard counts them, and knows the rider after three. */
export function noteSocietyDelivery() {
  memory.societyDeliveries++
  keepMemory()
}
/** How many deliveries the guard has signed in. */
export const societyDeliveries = () => memory.societyDeliveries
/** From this many deliveries to his building, the guard greets the rider as a friend. */
export const GUARD_KNOWS_AFTER = 3

const EVENT_WORDS: Record<CityEventKind, string> = { bus: 'a bus broken down', dig: 'the road dug up', wedding: 'a wedding procession', cow: 'a bull standing in the road' }
/** What is blocking a road just now, in words; empty if nothing is. */
export function jamWords(): string {
  return cityEvents.active.map(({ kind, road }) => `${EVENT_WORDS[kind]}${road ? ` on ${road}` : ''}`).join('; ')
}

/** The numbers an `if` can ask about. */
function values(character: Character): Record<string, number> {
  const game = useGameStore.getState()
  return {
    credits: game.credits,
    visits: memory.visits[character.id] ?? 0,
    deliveries: memory.societyDeliveries,
    hour: liveSky.hours,
    rush: rushHour(liveSky.hours) > RUSH_ON ? 1 : 0,
    jam: cityEvents.active.length > 0 ? 1 : 0,
    order: game.mission ? 1 : 0,
    riding: talkLive.lift ? 1 : 0,
    trial: talkLive.trial ? 1 : 0,
  }
}

const COMPARE: Record<string, (a: number, b: number) => boolean> = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '=': (a, b) => a === b, '<': (a, b) => a < b, '>': (a, b) => a > b }
/** Whether an `if` holds: comparisons joined by `&`. One that can't be read is taken as not holding, and said so in the console. */
export function holds(condition: string | undefined, character: Character): boolean {
  if (!condition) return true
  const known = values(character)
  return condition.split('&').every((part) => {
    const match = /^\s*(\w+)\s*(>=|<=|=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part)
    if (!match || !(match[1] in known)) {
      console.warn(`[talk] can't read the condition "${part.trim()}" (${character.id})`)
      return false
    }
    return COMPARE[match[2]](known[match[1]], Number(match[3]))
  })
}

/** Fills in the words in braces: on the screen only, as a recording can't say them. */
function fill(text: string): string {
  const plan = talkLive.plan
  const words: Record<string, string> = {
    name: useSettings.getState().playerName.trim() || 'Maga',
    place: plan?.place ?? 'the main road',
    seconds: String(plan?.seconds ?? 60),
    reward: String(plan?.reward ?? 30),
    deliveries: String(memory.societyDeliveries),
    jam: jamWords() || 'nothing just now',
  }
  return text.replace(/\{(\w+)\}/g, (whole, word: string) => words[word] ?? whole)
}

/** What a `do` does. `spend` that can't be afforded does nothing (its choice should carry `if: credits>=…`). */
function run(effects: string[] | undefined) {
  for (const effect of effects ?? []) {
    const [what, amount, label] = effect.split(':')
    const game = useGameStore.getState()
    if (what === 'spend') game.spend(label ?? 'On the street', Number(amount))
    else if (what === 'earn') earn(label ?? 'On the street', Number(amount))
    else if (what === 'fresh') useGameStore.setState({ fresh: Math.max(game.fresh, Number(amount) || 1) })
    else if (what === 'jamTip') talkLive.jamTip = rushHour(liveSky.hours) > RUSH_ON ? 'Outer Ring Road is jammed at Agara: take the inner cross roads.' : jamWords() ? `Keep clear of ${jamWords()}.` : 'The roads are clear just now.'
    else if (what === 'planLift') talkLive.plan = talkLive.planLift?.() ?? null
    else if (what === 'planTrial') talkLive.plan = talkLive.planTrial?.() ?? null
    else if (what === 'lift' && talkLive.plan) talkLive.startLift?.(talkLive.plan)
    else if (what === 'timeTrial' && talkLive.plan) talkLive.startTrial?.(talkLive.plan)
    else if (what === 'release') talkLive.release?.()
    else if (!['lift', 'timeTrial'].includes(what)) console.warn(`[talk] no such effect: ${effect}`)
  }
}

/** Money handed to the rider on the street (a tip from aunty, a race won): into the wallet and the ledger, as a tip. */
export function earn(label: string, amount: number) {
  if (!(amount > 0)) return
  useGameStore.setState((state) => ({
    credits: state.credits + amount,
    ledger: [{ id: Date.now() + Math.floor(Math.random() * 1000), day: state.day, label, amount, kind: 'tip' as const }, ...state.ledger].slice(0, 40),
  }))
}

let closing = 0
/** The lines said in this talk so far: nobody says the same thing twice in one talk. */
const heard = new Set<string>()
/** Where the rider was when the talk began (set by whoever knows: `keepTalkNear`). */
let begunAt: { x: number; z: number } | null = null
/** A talk ends when the rider is this far from where it began, in metres: ridden off, or walked away. */
const LEAVE = 3.5

/** Whether a node has nothing new left to say in this talk: it only ever says lines of one family, and all of them have been heard. */
function spent(character: Character, id: string | undefined): boolean {
  const node = id ? character.nodes[id] : undefined
  if (!node || node.pick || !node.say) return false
  const lines = linesOf(node.say)
  return lines.length > 0 && lines.every((line) => heard.has(line.id))
}

/** Call a few times a second with where the rider is: a talk left behind closes itself. */
export function keepTalkNear(x: number, z: number) {
  if (!useTalk.getState().card) return
  if (!begunAt) begunAt = { x, z }
  else if (Math.hypot(x - begunAt.x, z - begunAt.z) > LEAVE) closeTalk()
}

function show(character: Character, id: string) {
  const node = character.nodes[id]
  if (!node) {
    console.warn(`[talk] ${character.id} has no node "${id}"`)
    closeTalk()
    return
  }
  run(node.do)
  const said = node.pick?.find((option) => holds(option.if, character)) ?? node
  const line: VoiceLine = said.say ? pickLine(said.say, heard) : { id: '', character: character.name, line: '', notes: '' }
  if (line.id) heard.add(line.id)
  // An answer that would only bring back what's been said already isn't offered: no going round in circles.
  const choices = node.choices.filter((choice) => holds(choice.if, character) && !spent(character, choice.go))
  useTalk.setState({ card: { character, text: fill(`${said.before ?? ''}${line.line}${said.after ?? ''}`), english: line.english ?? '', choices } })
  if (line.id) void speak(line.id, 'street')
  // Nothing to answer: the last word is theirs, and the card goes when it's been read.
  window.clearTimeout(closing)
  if (choices.length === 0) closing = window.setTimeout(closeTalk, Math.min(5200, readingTime(line.line) + 900))
}

/** Starts talking to someone: the rider stands still while the card is up. */
export function openTalk(character: Character) {
  if (useTalk.getState().card) return
  liveRoom.frozen = true
  heard.clear()
  begunAt = null
  const first = character.start.find((option) => holds(option.if, character)) ?? character.start[character.start.length - 1]
  memory.visits[character.id] = (memory.visits[character.id] ?? 0) + 1
  keepMemory()
  show(character, first.go)
}

/** The rider answers with one of the choices on the card. */
export function chooseTalk(index: number) {
  const card = useTalk.getState().card
  const choice = card?.choices[index]
  if (!card || !choice) return
  run(choice.do)
  if (choice.go) show(card.character, choice.go)
  else closeTalk()
}

export function closeTalk() {
  window.clearTimeout(closing)
  if (!useTalk.getState().card) return
  useTalk.setState({ card: null })
  liveRoom.frozen = false
}

/**
 * Something called out on the street, or said on the phone, outside a talk: one of a family of
 * lines, heard if it's recorded, and on the screen either way (its words, and what they mean).
 */
export function bark(family: string, speaker: string, treatment: 'street' | 'phone' = 'street') {
  const line = pickLine(family)
  if (!line.line) return
  void speak(line.id, treatment).then((playing) => {
    // A recorded line with a translation shows its own subtitle as it plays (voice.ts).
    if (playing && line.english) return
    showSubtitle(speaker, line.english && line.english !== line.line ? `${line.line} (${line.english})` : line.line, 0, readingTime(line.line) / 1000)
  })
}

/** The chai anna's tip comes back as the next order is accepted: a line in the chat, where the order's own messages are. */
export function watchTalk(): () => void {
  return useGameStore.subscribe((state, previous) => {
    if (state.mission && !previous.mission && talkLive.jamTip) {
      state.postChat('customer', 'Chai stall anna', `Remember: ${talkLive.jamTip}`)
      talkLive.jamTip = null
    }
  })
}

// Debug: the talk, to open and answer from the console or a script (`__deliverItTalk`, with ?debug).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __deliverItTalk: { open: (id: string) => { const character = CHARACTERS.find((one) => one.id === id); if (character) openTalk(character) }, choose: chooseTalk, close: closeTalk, live: talkLive, card: () => useTalk.getState().card, bark } })
}
