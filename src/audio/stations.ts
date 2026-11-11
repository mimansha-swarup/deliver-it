import { crackle, hat, kick, pluck, snare, tabla, tone, type TablaStroke } from './instruments'

/**
 * A radio station that plays music made in code. Music is counted in steps:
 * 16 to a bar, so a step is a sixteenth note. The radio calls `play` once for
 * every step, a moment before it's due, with the exact time it should sound.
 */
export type CodeStation = {
  kind: 'code'
  id: string
  name: string
  tagline: string
  /** Beats per minute. */
  tempo: number
  /** How late the off-beat sixteenths land, as a share of a step. 0 is straight. */
  swing: number
  /** Starts it fresh, and returns what plays each step. */
  start: () => (output: AudioNode, time: number, step: number, bar: number, stepLength: number) => void
}

/** Plays a YouTube playlist in a player on the phone's screen. */
export type VideoStation = {
  kind: 'video'
  id: string
  name: string
  tagline: string
  /** YouTube video ids, played in order and then looped. */
  videos: string[]
}

export type Station = CodeStation | VideoStation

const chance = (odds: number) => Math.random() < odds
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

/**
 * Lo-fi hip hop: a lazy swung beat, soft electric-piano chords, a round bass and
 * the odd stray melody note, all a little muffled, with vinyl crackle on top.
 */
const chaiBreak: CodeStation = {
  kind: 'code',
  id: 'chai-break',
  name: 'Chai Break FM',
  tagline: 'Lo-fi beats to deliver to',
  tempo: 78,
  swing: 0.22,
  start: () => {
    // Fmaj7, Em7, Dm7, Cmaj9: a slow fall that never quite lands, which is the lo-fi feel.
    const chords = [
      [53, 57, 60, 64],
      [52, 55, 59, 62],
      [50, 53, 57, 60],
      [48, 52, 55, 59, 62],
    ]
    const melodyNotes = [72, 74, 76, 79, 81, 84]

    return (output, time, step, bar, stepLength) => {
      const chord = chords[bar % chords.length]
      const barLength = stepLength * 16

      if (step === 0 || step === 7 || step === 10) kick(output, time, step === 0 ? 0.8 : 0.55)
      if (step === 4 || step === 12) snare(output, time, 0.22)
      if (step % 2 === 0) hat(output, time, 0.05 + Math.random() * 0.04)
      if (chance(0.3)) crackle(output, time + Math.random() * stepLength)

      if (step === 0) {
        tone(output, time, chord[0] - 12, barLength * 0.55, { wave: 'triangle', volume: 0.3, cutoff: 500 })
        for (const note of chord) {
          tone(output, time + Math.random() * 0.03, note, barLength * 0.95, {
            volume: 0.06,
            attack: 0.02,
            cutoff: 1400,
            layers: [0, 12],
          })
        }
      }
      if (step === 10) tone(output, time, chord[0] - 12, stepLength * 5, { wave: 'triangle', volume: 0.25, cutoff: 500 })

      if (step % 2 === 0 && chance(0.18)) {
        tone(output, time, pick(melodyNotes), stepLength * 3, { volume: 0.07, cutoff: 1800, layers: [0, 12] })
      }
    }
  },
}

/**
 * Indian fusion: a tanpura drone, a tabla playing an eight-beat keherwa, a
 * pulsing bass, and a sitar-like line that wanders the notes of raga Kafi,
 * sliding into some of them.
 */
const tablaTaxi: CodeStation = {
  kind: 'code',
  id: 'tabla-taxi',
  name: 'Tabla Taxi',
  tagline: 'Keherwa grooves and a sitar that never stops',
  tempo: 96,
  swing: 0.08,
  start: () => {
    /** Sa, the home note, here D. Every other note is counted from it. */
    const sa = 50
    // Kafi: Sa Re komal-Ga Ma Pa Dha komal-Ni, over two octaves.
    const kafi = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19]
    // Keherwa, one stroke per eighth note: dha ge na ti na ka dhi na.
    const theka: TablaStroke[] = ['dha', 'ge', 'na', 'ti', 'na', 'ka', 'dhin', 'na']
    let place = 7

    return (output, time, step, bar, stepLength) => {
      // The tanpura plucks Pa, Sa, Sa, low Sa, over and over, and lets each ring.
      if (step % 4 === 0) {
        const string = [sa + 7, sa + 12, sa + 12, sa][step / 4]
        pluck(output, time, string - 12, stepLength * 14, 0.05)
      }

      if (step % 2 === 0) tabla(output, time, theka[step / 2], sa, 0.42)
      // A quick extra stroke now and then, which is how a tabla player keeps it alive.
      else if (chance(0.15)) tabla(output, time, pick<TablaStroke>(['ti', 'na', 'ka']), sa, 0.25)

      if (step === 0 || step === 6 || step === 8 || step === 14) {
        tone(output, time, sa - 12, stepLength * 2, { wave: 'triangle', volume: 0.22, cutoff: 400 })
      }

      // The melody steps up or down the raga, rarely leaping, and rests to breathe.
      const resting = bar % 4 === 3 && step >= 8
      if (step % 2 === 0 && !resting && chance(0.55)) {
        place = Math.max(0, Math.min(kafi.length - 1, place + pick([-2, -1, -1, 1, 1, 2])))
        const long = chance(0.25)
        pluck(output, time, sa + 12 + kafi[place], stepLength * (long ? 6 : 2.5), 0.11, chance(0.3) ? 1 : 0)
      }
    }
  },
}

/**
 * Synthwave for the ring road at night: a four-on-the-floor kick, a running
 * octave bass, wide chords and a bright arpeggio over the top.
 */
const ringRoadNights: CodeStation = {
  kind: 'code',
  id: 'ring-road-nights',
  name: 'Ring Road Nights',
  tagline: 'Synthwave for empty midnight roads',
  tempo: 104,
  swing: 0,
  start: () => {
    // Am, F, C, G: the classic loop.
    const chords = [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ]

    return (output, time, step, bar, stepLength) => {
      const chord = chords[bar % chords.length]
      const root = chord[0] - 24

      if (step % 4 === 0) kick(output, time, 0.75)
      if (step === 4 || step === 12) snare(output, time, 0.25)
      if (step % 4 === 2) hat(output, time, 0.09, true)

      tone(output, time, root + (step % 2 === 0 ? 0 : 12), stepLength * 0.9, {
        wave: 'sawtooth',
        volume: 0.12,
        cutoff: 700,
      })

      if (step === 0) {
        for (const note of chord) {
          tone(output, time, note, stepLength * 16, { wave: 'sawtooth', volume: 0.035, attack: 0.3, cutoff: 1200, detune: 12 })
        }
      }

      if (step % 2 === 0) {
        const note = chord[(step / 2) % chord.length] + 12 * (step % 8 < 4 ? 1 : 2)
        tone(output, time, note, stepLength * 1.6, { wave: 'square', volume: 0.04, cutoff: 3000 })
      }
    }
  },
}

/**
 * "HSR After Hours": 30 songs chosen by the player, from Kannada indie and
 * Bangalore rock to the café sound around HSR Layout. Each id is the artist's
 * or label's own upload, checked to allow playing outside YouTube. Three songs
 * from the list weren't on YouTube under that name, so the closest song by the
 * same artist stands in, marked "stand-in".
 *
 * The id stays 'hsr-indie' so a saved choice of this station still works.
 */
const hsrAfterHours: VideoStation = {
  kind: 'video',
  id: 'hsr-indie',
  name: 'HSR After Hours',
  tagline: 'Songs from around HSR, on YouTube',
  videos: [
    'y4QPOKGcnuI', // 1. Vasuki Vaibhav: Gira Gira
    'BmUe3-sfr7E', // 2. Prateek Kuhad: Kasoor
    'J3m3uptDf0Q', // 3. Anuv Jain: Alag Aasmaan
    'U77d9912lrw', // 4. The Local Train: Aaftaab
    'zKd3oBWe7G0', // 5. Sagar Simha: Doora
    'sElE_BfQ67s', // 6. Cigarettes After Sex: Apocalypse
    'sBzrzS1Ag_g', // 7. Tame Impala: The Less I Know The Better
    '6WuoRV66ti8', // 8. Vasu Dixit: Nadiyolage
    '6eGCi4SVy94', // 9. OAFF, Savera: Doobey (stand-in for "Savera")
    'hWOB5QYcmh0', // 10. HONNE: Day 1
    'puQlNY1ikwM', // 11. Tanmay Gururaj: Ninna Notavu
    '_kgQxGew2gI', // 12. Swarathma: Jamba
    'e4h0VoZpdI8', // 13. Raghu Dixit: Lokada Kalaji
    'LCQdM9fkeqs', // 14. Thermal and a Quarter: Bangalore Blues (stand-in for "Namma Bengaluru")
    'Y8ZApXcnhy4', // 15. Sumedh K: Tulasi
    'HSzJL-GJBHc', // 16. Sanjith Hegde: Kareyole
    'q-TJxeZZxpc', // 17. Parvaaz: Ghaib
    'oESni03J8h8', // 18. Agam: Rangapura Vihara
    'qLCLvzTGFVM', // 19. The Local Train: Dil Mere
    '0gosur3db5I', // 20. Ritviz: Udd Gaye
    'slNebO7Yips', // 21. Nucleya: Bass Rani (Aaja)
    'hOHKltAiKXQ', // 22. Hanumankind: Big Dawgs
    'Il7Nv270zNk', // 23. Prateek Kuhad: cold/mess
    'Pc-FNBnSplg', // 24. When Chai Met Toast: Firefly
    'dWqb-WqbGh8', // 25. Lucky Ali: O Sanam
    'jTkEOh88cB0', // 26. The Bicycle Days: Circles (stand-in for "A Song for the Moon")
    '2g5xkLqIElU', // 27. Tame Impala: Borderline
    'MNmiN43iAyQ', // 28. Parvaaz: Beparwah
    'mS-rBCrA3C4', // 29. Swarathma: Raah e Fakira
    '5qxYc0CarVo', // 30. Thermal and a Quarter: Lies
  ],
}

export const STATIONS: Station[] = [chaiBreak, tablaTaxi, ringRoadNights, hsrAfterHours]
