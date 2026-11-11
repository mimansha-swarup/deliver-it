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

export type AudioBuses = { context: AudioContext; sfx: GainNode; music: GainNode }

let buses: AudioBuses | null = null
let musicOn = true
let sfxOn = true

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
    limiter.connect(context.destination)

    const sfx = context.createGain()
    sfx.gain.value = sfxOn ? SFX_VOLUME : 0
    sfx.connect(limiter)
    const music = context.createGain()
    music.gain.value = musicOn ? MUSIC_VOLUME : 0
    music.connect(limiter)
    buses = { context, sfx, music }

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
  if (buses) fadeTo(buses.music, on ? MUSIC_VOLUME : 0)
}

export function setSfxOn(on: boolean) {
  sfxOn = on
  if (buses) fadeTo(buses.sfx, on ? SFX_VOLUME : 0)
}
