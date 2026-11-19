import { create } from 'zustand'
import { rushHour } from '../game/rush'
import { getAudioEvenIfPaused } from './audioEngine'

/*
 * The radio's voice: RJ Manju (made up, like the stations), who comes on between the music with a
 * short traffic update in Kanglish, or an ad for a local business that doesn't exist. Every name
 * in here is invented.
 *
 * The words are spoken by the browser's own speech (an Indian English voice where the device has
 * one), over the music turned down, after a three-note jingle; and shown on the phone as they're
 * said, for browsers with no voice. Nothing is recorded.
 */

export const RJ_NAME = 'RJ Manju'

/** What's being said on air now, for the phone to show. */
export const useOnAir = create<{ line: { id: number; station: string; kind: 'traffic' | 'ad'; text: string } | null }>(() => ({ line: null }))

/** What the update can talk about: the time, the weather, and anything happening on the roads (game/cityEvents.ts). */
export type RoadReport = { hours: number; rain: number; night: boolean; events: string[] }
export const roadReport: { get: () => RoadReport } = { get: () => ({ hours: 9, rain: 0, night: false, events: [] }) }

const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

const ROADS = ['Outer Ring Road', 'Sarjapur Road', 'Twenty-seventh Main', 'Twenty-fourth Main', 'Nineteenth Main', 'Fourteenth Main', 'the Agara junction', 'the Silk Board side']

function trafficUpdate(station: string, { hours, rain, night, events }: RoadReport): string {
  const hello = pick([`Namaskara Bengaluru! ${RJ_NAME} here on ${station}, with your traffic update.`, `Hello hello, ${RJ_NAME} here on ${station}. Traffic update, guru.`, `${RJ_NAME} back on ${station}. Quick traffic update, swalpa listen maadi.`])
  const lines: string[] = []
  // What's actually on the roads comes first.
  for (const event of events.slice(0, 2)) lines.push(event)
  const rush = rushHour(hours)
  if (rush > 0.4) lines.push(pick([`Outer Ring Road is full jam near Agara, bumper to bumper. Service road thogoli if you can.`, `Peak hour, guru. ${pick(ROADS)} is moving like a wedding procession. Adjust maadi.`, `Office time traffic everywhere. Signal alli full line. Patience irali, horn beda.`]))
  else if (night) lines.push(pick([`Roads are khaali now. But slow hogi, street dogs are on duty.`, `Late night, empty roads. Signal jump maadbedi, police mama is still awake at Agara.`]))
  else lines.push(pick([`${pick(ROADS)} is moving freely. Sakkath time to ride.`, `No major jam right now. ${pick(ROADS)} is clear, ${pick(ROADS)} swalpa slow.`, `Smooth traffic all over HSR. Enjoy maadi.`]))
  if (rain > 0.3) lines.push(pick([`Male bartha ide! Roads are slippery, brake slowly. Under the flyover water is standing.`, `It is raining, guru. Raincoat haakoli, and watch the potholes, they are swimming pools now.`]))
  const bye = pick([`Helmet haakoli, signal follow maadi. Back to the music.`, `Ride safe, Bengaluru. More music, less horn.`, `That's it from me. Drive maadi, don't fly maadi.`])
  // Every sentence starts with a capital, whatever it was built from.
  return [hello, ...lines, bye].map((line) => line.replace(/(^|[.!?] )([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase())).join(' ')
}

/** Ads for businesses that don't exist: each a line or two, with a slogan. */
const ADS = [
  `Vehicle beka? GaadiGo! Scooter, cycle, even a van, on rent by the hour, delivered to where you stand. EMI also available. GaadiGo: neevu ride maadi, tension namge.`,
  `Minchu E-One, the electric scooter that goes like lightning and drinks nothing. Charge maadi, chill maadi. Minchu: current alli future.`,
  `Swarna Mahal Jewellers, since nineteen sixty-two. This wedding season, making charges are fifty percent off. Swarna Mahal: namma mane, namma chinna.`,
  `Hungry at midnight? Crispy Coop is open till two. Crispy outside, juicy inside, pocket friendly. Crispy Coop: ondu bite, full delight.`,
  `Filter House coffee. Decoction made slow, served hot, in steel tumblers only. One sip and Monday becomes Sunday. Filter House: kaapi first, everything next.`,
  `Sampige Residency, two and three BHK flats, just five minutes from everywhere, according to our brochure. Site visit free. Sampige Residency: mane andre idu.`,
  `Paisley Pop end of season sale! Kurtas, shirts, sarees, flat forty percent off. Fashion for everyone, budget for everyone. Paisley Pop, Twenty-seventh Main.`,
  `Riders beku! Join Deliver It. Flexible hours, weekly payout, and a yellow jacket that makes you famous. Deliver It: bega, jopana, on time.`,
  `Stride Shoe Company. School shoes, office shoes, chappals for the whole family. Buy two, third pair for ajji free. Stride: hejje hejje comfort.`,
  `Volt Bazaar mega exchange mela! Old mixie kodi, new mixie thogoli. TVs, fridges, phones, zero percent EMI. Volt Bazaar: current affairs, low price.`,
]

/** The jingle: three rising notes and a shimmer, on the music bus. */
function jingle() {
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses
  const start = context.currentTime + 0.05
  ;[659, 784, 1047].forEach((hz, index) => {
    const at = start + index * 0.14
    for (const [ratio, share] of [[1, 1], [2, 0.3]]) {
      const tone = context.createOscillator()
      tone.type = 'triangle'
      tone.frequency.value = hz * ratio
      const level = context.createGain()
      level.gain.setValueAtTime(0, at)
      level.gain.linearRampToValueAtTime(0.5 * share, at + 0.015)
      level.gain.exponentialRampToValueAtTime(0.0001, at + (index === 2 ? 0.9 : 0.3))
      tone.connect(level).connect(music)
      tone.start(at)
      tone.stop(at + 1)
    }
  })
}

/** The voice: an Indian English one if the device has it, else any English one. Null with no speech at all. */
function findVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  return voices.find(({ lang }) => lang === 'en-IN') ?? voices.find(({ lang }) => lang.startsWith('en-IN')) ?? voices.find(({ lang }) => lang.startsWith('en')) ?? null
}

let nextId = 1
let ad = Math.floor(Math.random() * ADS.length)
let lastWasAd = Math.random() < 0.5

/**
 * One break: the jingle, then a traffic update or an ad (they take turns), spoken and shown.
 * `duck` turns the music down while it's said. `done` is called when it's over.
 */
export function playBreak(station: string, duck: (down: boolean) => void, done: () => void) {
  lastWasAd = !lastWasAd
  const kind = lastWasAd ? 'ad' : 'traffic'
  const text = kind === 'ad' ? ADS[ad++ % ADS.length] : trafficUpdate(station, roadReport.get())
  const id = nextId++
  jingle()
  duck(true)
  useOnAir.setState({ line: { id, station, kind, text } })
  const finish = () => {
    if (useOnAir.getState().line?.id !== id) return
    useOnAir.setState({ line: null })
    duck(false)
    done()
  }
  // Long enough to read if nothing speaks it: about fourteen characters a second.
  const readingMs = 2500 + text.length * 70
  const voice = findVoice()
  if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang ?? 'en-IN'
    utterance.rate = 1.04
    utterance.pitch = 1.08
    utterance.volume = 0.85
    utterance.onend = finish
    utterance.onerror = finish
    window.setTimeout(() => {
      if (useOnAir.getState().line?.id === id) speechSynthesis.speak(utterance)
    }, 650)
    // In case the browser never says it's finished.
    window.setTimeout(finish, readingMs + 9000)
  } else window.setTimeout(finish, readingMs)
}

/** Cuts the RJ off: the station was changed or the music turned off. */
export function stopBreak() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  useOnAir.setState({ line: null })
}
