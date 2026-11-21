import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setMusicVolume, setSfxVolume } from '../audio/audioEngine'

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
      lookSpeed: 1,
      invertY: false,
      language: 'en',
      playerName: '',
      set: (changes) => set(changes),
    }),
    { name: 'swalpa-fast-settings', version: 1, partialize: ({ sfxVolume, musicVolume, lookSpeed, invertY, language, playerName }) => ({ sfxVolume, musicVolume, lookSpeed, invertY, language, playerName }) },
  ),
)

// The mixer follows the volumes: now, and whenever they're changed.
const applyVolumes = ({ sfxVolume, musicVolume }: Settings) => {
  setSfxVolume(sfxVolume)
  setMusicVolume(musicVolume)
}
applyVolumes(useSettings.getState())
useSettings.subscribe(applyVolumes)
