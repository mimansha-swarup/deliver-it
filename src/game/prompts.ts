import { create } from 'zustand'
import type { Action } from './keyBindings'

/*
 * Context prompts: bottom centre, only while they apply ("F · Get off", "E · Pick up", "Space · Drift").
 * Whatever knows a key is useful right now sets a prompt under its own id, and clears it when it
 * isn't. A prompt with `run` is also what that key does while it shows: one key listener (Prompts.tsx)
 * runs the top prompt for the key pressed.
 */

export type Prompt = {
  id: string
  /** The action whose key is shown, as bound. */
  action: Action
  text: string
  /** What the key does while this shows. Left out, something else listens for the key. */
  run?: () => void
  /** Higher shows first; at most two show at once. */
  priority?: number
}

type PromptStore = { list: Prompt[] }

export const usePrompts = create<PromptStore>(() => ({ list: [] }))

/** Sets, changes or (with null) clears the prompt with this id. Cheap to call every frame: nothing changes unless the text or key does. */
export function setPrompt(id: string, prompt: Omit<Prompt, 'id'> | null) {
  const { list } = usePrompts.getState()
  const at = list.findIndex((other) => other.id === id)
  if (!prompt) {
    if (at >= 0) usePrompts.setState({ list: list.filter((other) => other.id !== id) })
    return
  }
  const next = { ...prompt, id }
  if (at < 0) usePrompts.setState({ list: [...list, next] })
  else if (list[at].text !== next.text || list[at].action !== next.action) usePrompts.setState({ list: list.map((other, index) => (index === at ? next : other)) })
  else list[at].run = next.run
}

/** The prompts to show now, most important first. */
export function shownPrompts(list: Prompt[]): Prompt[] {
  return [...list].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 2)
}

/** Hints shown once, ever (the drift hint): which have been learnt, kept on this device. */
const HINTS_KEY = 'deliver-it-hints'
export function hintLearnt(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as string[]).includes(id)
  } catch {
    return false
  }
}
export function learnHint(id: string) {
  try {
    const learnt = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as string[]
    if (!learnt.includes(id)) localStorage.setItem(HINTS_KEY, JSON.stringify([...learnt, id]))
  } catch {
    // Not kept: the hint shows again next visit.
  }
}
