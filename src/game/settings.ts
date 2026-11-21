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

type Settings = {
  /** 0 to 1: a share of each bus's own level (audio/audioEngine.ts). */
  sfxVolume: number
  musicVolume: number
  /** Over everything, and Ravi's and the customers' voices on their own. */
  masterVolume: number
  voiceVolume: number
  /** How fast the mouse turns the camera, as a multiple of the usual: 0.4 to 2. */
  lookSpeed: number
  /** Mouse up looks down. */
  invertY: boolean
  language: Language
  /** The name other riders see in a room (net/room.ts). */
  playerName: string
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
      lookSpeed: 1,
      invertY: false,
      language: 'en',
      playerName: '',
      set: (changes) => set(changes),
    }),
    { name: 'swalpa-fast-settings', version: 1, partialize: ({ sfxVolume, musicVolume, masterVolume, voiceVolume, lookSpeed, invertY, language, playerName }) => ({ sfxVolume, musicVolume, masterVolume, voiceVolume, lookSpeed, invertY, language, playerName }) },
  ),
)

// The mixer follows the volumes: now, and whenever they're changed.
const applyVolumes = ({ sfxVolume, musicVolume, masterVolume, voiceVolume }: Settings) => {
  setSfxVolume(sfxVolume)
  setMusicVolume(musicVolume)
  setMasterVolume(masterVolume ?? 1)
  setVoiceVolume(voiceVolume ?? 1)
}
applyVolumes(useSettings.getState())
useSettings.subscribe(applyVolumes)
