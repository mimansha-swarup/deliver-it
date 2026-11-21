import { create } from 'zustand'

/*
 * The subtitle: while a recorded line with Kannada in it is being spoken, what it means in English,
 * at the bottom of the screen with who is saying it (ui/Subtitle.tsx). Set by `speak` in voice.ts at
 * the moment the line starts (its turn, if it had to wait), and cleared as it ends. Only for lines
 * that carry a translation (`english` in voiceScript.json): an all-English line needs none.
 */

export type SubtitleLine = { id: number; speaker: string; text: string }

export const useSubtitle = create<{ line: SubtitleLine | null }>(() => ({ line: null }))

let nextId = 1

/** Shows a subtitle `after` seconds from now, for `seconds` (a little longer than the voice, to finish reading). */
export function showSubtitle(speaker: string, text: string, after: number, seconds: number) {
  const id = nextId++
  window.setTimeout(() => {
    useSubtitle.setState({ line: { id, speaker, text } })
    window.setTimeout(() => {
      if (useSubtitle.getState().line?.id === id) useSubtitle.setState({ line: null })
    }, (seconds + 0.6) * 1000)
  }, Math.max(0, after) * 1000)
}
