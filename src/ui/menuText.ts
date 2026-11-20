import { useSettings, type Language } from '../game/settings'

/*
 * The menus' words, in English and in Kannada. Kannada is chosen in Settings; a label with no
 * Kannada yet shows in English, so the menus are never half blank. Only the menus are translated so
 * far: the game itself (Ravi, customers, the phone) is in English with Kannada mixed in, as before.
 */

const TEXT = {
  continue: ['Continue', 'ಮುಂದುವರಿಸಿ'],
  newGame: ['New game', 'ಹೊಸ ಆಟ'],
  explore: ['Explore mode', 'ಸುತ್ತಾಟ'],
  exploreDetail: ['Roam the city: no orders, no fuel, any vehicle', 'ಊರು ಸುತ್ತಿ: ಆರ್ಡರ್ ಇಲ್ಲ, ಪೆಟ್ರೋಲ್ ಚಿಂತೆ ಇಲ್ಲ'],
  settings: ['Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್'],
  controls: ['Controls', 'ನಿಯಂತ್ರಣಗಳು'],
  credits: ['Credits', 'ಕೃತಜ್ಞತೆಗಳು'],
  back: ['Back', 'ಹಿಂದೆ'],
  firstTime: ['Your first day on the job', 'ಕೆಲಸದ ಮೊದಲ ದಿನ'],
  free: ['Free in your browser · No download · Progress saves on this device', 'ಬ್ರೌಸರ್‌ನಲ್ಲೇ ಉಚಿತ · ಡೌನ್‌ಲೋಡ್ ಬೇಡ · ನಿಮ್ಮ ಆಟ ಈ ಸಾಧನದಲ್ಲೇ ಉಳಿಯುತ್ತದೆ'],
  feedback: ['Feedback', 'ಅಭಿಪ್ರಾಯ'],
  paused: ['Paused', 'ವಿರಾಮ'],
  resume: ['Resume', 'ಮುಂದುವರಿಸಿ'],
  unstuck: ['Unstuck', 'ಸಿಕ್ಕಿಕೊಂಡಿದ್ದೀರಾ?'],
  unstuckDetail: ['Puts you and your vehicle back on the nearest road', 'ನಿಮ್ಮನ್ನು ಹತ್ತಿರದ ರಸ್ತೆಗೆ ತರುತ್ತದೆ'],
  quit: ['Save and quit to menu', 'ಉಳಿಸಿ, ಮೆನುಗೆ ಹೋಗಿ'],
  quitDetail: ['Your progress is saved on this device', 'ನಿಮ್ಮ ಆಟ ಈ ಸಾಧನದಲ್ಲಿ ಉಳಿದಿದೆ'],
  picture: ['Picture', 'ಚಿತ್ರ'],
  quality: ['Quality', 'ಗುಣಮಟ್ಟ'],
  low: ['Low', 'ಕಡಿಮೆ'],
  medium: ['Medium', 'ಮಧ್ಯಮ'],
  high: ['High', 'ಹೆಚ್ಚು'],
  sound: ['Sound', 'ಧ್ವನಿ'],
  soundVolume: ['Sound effects', 'ಧ್ವನಿ ಪರಿಣಾಮಗಳು'],
  musicVolume: ['Music', 'ಸಂಗೀತ'],
  camera: ['Camera', 'ಕ್ಯಾಮೆರಾ'],
  sensitivity: ['Mouse sensitivity', 'ಮೌಸ್ ವೇಗ'],
  invertY: ['Invert up and down', 'ಮೇಲೆ-ಕೆಳಗೆ ತಿರುಗುಮುರುಗು'],
  language: ['Language', 'ಭಾಷೆ'],
  languageNote: ['Kannada covers the menus for now. The game itself stays in English with Ravi’s Kannada.', 'ಸದ್ಯಕ್ಕೆ ಮೆನುಗಳು ಮಾತ್ರ ಕನ್ನಡದಲ್ಲಿವೆ. ಆಟ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲೇ ಇದೆ, ರವಿಯ ಕನ್ನಡದ ಜೊತೆ.'],
  deliveries: ['Deliveries', 'ಡೆಲಿವರಿ'],
  alwaysWalk: ['Always walk to the door', 'ಯಾವಾಗಲೂ ಬಾಗಿಲಿನವರೆಗೆ ನಡೆದು ಹೋಗಿ'],
  alwaysWalkNote: ['Off: at a house on the street, hand over from your vehicle at the gate.', 'ಆಫ್: ರಸ್ತೆ ಬದಿಯ ಮನೆಗೆ ಗೇಟ್ ಬಳಿಯೇ ಗಾಡಿಯಿಂದ ಕೊಡಬಹುದು.'],
  progress: ['Progress', 'ನಿಮ್ಮ ಆಟ'],
  resetTutorial: ['Reset the tutorial', 'ಟ್ಯುಟೋರಿಯಲ್ ಮತ್ತೆ ತೋರಿಸಿ'],
  tutorialReset: ['The tutorial will play again', 'ಟ್ಯುಟೋರಿಯಲ್ ಮತ್ತೆ ಬರುತ್ತದೆ'],
  freshStart: ['Fresh start', 'ಮೊದಲಿನಿಂದ ಶುರು ಮಾಡಿ'],
  freshQuestion: ['Erase everything and start again?', 'ಎಲ್ಲವನ್ನೂ ಅಳಿಸಿ ಮತ್ತೆ ಶುರು ಮಾಡಬೇಕೇ?'],
  freshDetail: ['Your money, level, vehicles, savings for home and awards on this device are deleted. This can’t be undone. Your settings and keys are kept.', 'ಈ ಸಾಧನದಲ್ಲಿರುವ ನಿಮ್ಮ ಹಣ, ಲೆವೆಲ್, ಗಾಡಿಗಳು ಮತ್ತು ಪ್ರಶಸ್ತಿಗಳು ಅಳಿಸಿಹೋಗುತ್ತವೆ. ಇದನ್ನು ಹಿಂಪಡೆಯಲು ಆಗದು.'],
  freshYes: ['Yes, erase it all', 'ಹೌದು, ಅಳಿಸಿ'],
  freshNo: ['No, keep my progress', 'ಬೇಡ, ಹಾಗೇ ಇರಲಿ'],
  skip: ['Skip', 'ಬಿಟ್ಟುಬಿಡಿ'],
  next: ['Next', 'ಮುಂದೆ'],
  startRiding: ['Start riding', 'ಹೊರಡಿ'],
} as const satisfies Record<string, readonly [string, string]>

export type TextKey = keyof typeof TEXT

export function textIn(language: Language, key: TextKey): string {
  const [english, kannada] = TEXT[key]
  return language === 'kn' && kannada ? kannada : english
}

/** The menus' words in the chosen language: `const t = useT()` then `t('continue')`. */
export function useT(): (key: TextKey) => string {
  const language = useSettings((state) => state.language)
  return (key) => textIn(language, key)
}
