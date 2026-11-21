/**
 * The one AudioContext the game uses, and its mixer.
 *
 *   horns ─► sfx bus ───┐
 *                        ├─► limiter ─► speakers
 *   radio ─► music bus ─┘
 *
 * Each bus is a GainNode, so muting music or horns is just turning its gain
 * to 0, with nothing stopped or rebuilt. The limiter (a compressor) keeps a
 * jam's worth of horns over a loud song from clipping.
 */
const SFX_VOLUME = 0.22
const MUSIC_VOLUME = 0.32
/** How long a mute or unmute fades over, in seconds, so it doesn't click. */
const FADE = 0.15

/** `ui`: the menus' own sounds, which keep playing while the game's are hushed behind the pause menu. */
export type AudioBuses = { context: AudioContext; sfx: GainNode; music: GainNode; ui: GainNode; voice: GainNode; master: GainNode }
/**
 * The mix, loudest first: voices (Ravi, customers, on their own bus), then music (the radio, with the
 * RJ in it), then the street and the engine. Everything goes through `master`, the one volume over all.
 */
const VOICE_VOLUME = 0.78
/** While someone speaks on the phone the music drops to this share, and comes back after. */
const MUSIC_UNDER_VOICE = 0.45

let buses: AudioBuses | null = null
let musicOn = true
let sfxOn = true
/** The player's own volumes, 0 to 1 (game/settings.ts): a share of each bus's level. */
let musicShare = 1
let sfxShare = 1
let masterShare = 1
let voiceShare = 1
/** The game's own sounds are hushed while the pause menu is up. */
let hushed = false
const sfxLevel = () => (sfxOn && !hushed ? SFX_VOLUME * sfxShare : 0)
const uiLevel = () => (sfxOn ? SFX_VOLUME * sfxShare : 0)
const musicLevel = () => (musicOn ? MUSIC_VOLUME * musicShare : 0)

/**
 * Browsers only allow sound after the player has tapped or pressed something.
 * Call this from a click, such as Start riding.
 */
export function unlockAudio() {
  if (!buses) {
    const context = new AudioContext()
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 8
    const master = context.createGain()
    master.gain.value = masterShare
    master.connect(context.destination)
    limiter.connect(master)
    const voice = context.createGain()
    voice.gain.value = VOICE_VOLUME * voiceShare
    voice.connect(limiter)

    const sfx = context.createGain()
    sfx.gain.value = sfxLevel()
    sfx.connect(limiter)
    const music = context.createGain()
    music.gain.value = musicLevel()
    music.connect(limiter)
    const ui = context.createGain()
    ui.gain.value = uiLevel()
    ui.connect(limiter)
    buses = { context, sfx, music, ui, voice, master }

    // Nothing plays while the game is in the background, which saves the battery.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void context.suspend()
      else void context.resume()
    })
  }
  void buses.context.resume()
}

/** The mixer, once sound is allowed and running. Null until then. */
export function getAudio(): AudioBuses | null {
  return buses && buses.context.state === 'running' ? buses : null
}

/** The mixer as soon as it exists, even before it starts running. */
export function getAudioEvenIfPaused(): AudioBuses | null {
  return buses
}

function fadeTo(gain: GainNode, value: number) {
  const now = gain.context.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setTargetAtTime(value, now, FADE / 3)
}

export function setMusicOn(on: boolean) {
  musicOn = on
  if (buses) fadeTo(buses.music, musicLevel())
}

export function setSfxOn(on: boolean) {
  sfxOn = on
  if (buses) {
    fadeTo(buses.sfx, sfxLevel())
    fadeTo(buses.ui, uiLevel())
  }
}

export function setMusicVolume(share: number) {
  musicShare = Math.max(0, Math.min(1, share))
  if (buses) fadeTo(buses.music, musicLevel())
}

export function setSfxVolume(share: number) {
  sfxShare = Math.max(0, Math.min(1, share))
  if (buses) {
    fadeTo(buses.sfx, sfxLevel())
    fadeTo(buses.ui, uiLevel())
  }
}

/** The pause menu is up (or gone again): the engine, horns and street go quiet behind it; the music plays on. */
export function setHushed(on: boolean) {
  hushed = on
  if (buses) fadeTo(buses.sfx, sfxLevel())
}

export function setMasterVolume(share: number) {
  masterShare = Math.max(0, Math.min(1, share))
  if (buses) fadeTo(buses.master, masterShare)
}

export function setVoiceVolume(share: number) {
  voiceShare = Math.max(0, Math.min(1, share))
  if (buses) fadeTo(buses.voice, VOICE_VOLUME * voiceShare)
}

/** Someone speaks on the phone from `at` (the audio clock) for `seconds`: the music goes under them and comes back. */
export function duckMusicFor(at: number, seconds: number) {
  if (!buses) return
  const { gain } = buses.music
  const level = musicLevel()
  gain.setTargetAtTime(level * MUSIC_UNDER_VOICE, at, 0.08)
  gain.setTargetAtTime(level, at + seconds + 0.15, 0.25)
}
