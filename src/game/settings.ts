import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setMasterVolume, setMusicVolume, setSfxVolume, setVoiceVolume } from '../audio/audioEngine'

/*
 * The player's settings that aren't the game's own state: how loud sound and music are, how the
 * mouse moves the camera, and the menus' language. Saved on this device under their own name, apart
 * from progress, so a fresh start keeps them. (The picture quality and "Always walk to the door"
 * were in the progress save before this existed, and stay there.)
 */

export type Language = 'en' | 'kn'

/**
 * How many frames a second the game draws at most (game/framePacing.ts): 60 unless the player
 * chooses otherwise, whatever the screen can do, so the device stays cool. 0 is every refresh of the screen.
 */
export type FrameRate = 'saver' | 'smooth' | 'unlimited'
export const FRAME_RATES: Record<FrameRate, number> = { saver: 30, smooth: 60, unlimited: 0 }

type Settings = {
  /** 0 to 1: a share of each bus's own level (audio/audioEngine.ts). */
  sfxVolume: number
  musicVolume: number
  /** Over everything, and Ravi's and the customers' voices on their own. */
  masterVolume: number
  voiceVolume: number
  /** Whether anyone is heard talking (Ravi, Manju, customers, the guard, the store's staff). Off, their words are still on screen and in the chat. */
  voicesOn: boolean
  /** How fast the mouse turns the camera, as a multiple of the usual: 0.4 to 2. */
  lookSpeed: number
  /** Mouse up looks down. */
  invertY: boolean
  language: Language
  /** The name other riders see in a room (net/room.ts). */
  playerName: string
  frameRate: FrameRate
  /** Battery saver comes on by itself on battery power, or when the device is heating (game/framePacing.ts). */
  autoSaver: boolean
  /** Draws a step above the screen's own points (1.25×) on Medium and High, where the screen has the pixels for it: sharper, and warmer. */
  sharpPicture: boolean
  set: (changes: Partial<Omit<Settings, 'set'>>) => void
}

export const LOOK_SPEED = { min: 0.4, max: 2 }

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      sfxVolume: 1,
      musicVolume: 1,
      masterVolume: 1,
      voiceVolume: 1,
      voicesOn: true,
      lookSpeed: 1,
      invertY: false,
      language: 'en',
      playerName: '',
      frameRate: 'smooth',
      autoSaver: true,
      sharpPicture: false,
      set: (changes) => set(changes),
    }),
    { name: 'swalpa-fast-settings', version: 1, partialize: ({ sfxVolume, musicVolume, masterVolume, voiceVolume, voicesOn, lookSpeed, invertY, language, playerName, frameRate, autoSaver, sharpPicture }) => ({ sfxVolume, musicVolume, masterVolume, voiceVolume, voicesOn, lookSpeed, invertY, language, playerName, frameRate, autoSaver, sharpPicture }) },
  ),
)

// The mixer follows the volumes: now, and whenever they're changed.
const applyVolumes = ({ sfxVolume, musicVolume, masterVolume, voiceVolume, voicesOn }: Settings) => {
  setSfxVolume(sfxVolume)
  setMusicVolume(musicVolume)
  setMasterVolume(masterVolume ?? 1)
  // Muted mid-sentence, whoever is speaking goes quiet at once; nobody new starts (audio/voice.ts).
  setVoiceVolume(voicesOn === false ? 0 : (voiceVolume ?? 1))
}
applyVolumes(useSettings.getState())
useSettings.subscribe(applyVolumes)
