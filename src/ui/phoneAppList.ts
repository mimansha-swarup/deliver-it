/* The phone's apps, by id, with their icons, and what an app can ask of the phone. */

export type AppId = 'deliver' | 'messages' | 'maps' | 'music' | 'wallet' | 'garage' | 'camera' | 'spots' | 'gaadigo' | 'settings'

/** What an app can ask of the phone: go to another app or home, open a chat, or put the phone away. */
export type PhoneNav = {
  go: (app: AppId | 'home') => void
  openThread: (thread: string) => void
  close: () => void
  thread: string | null
  /** Unread lines by thread, and marking one read. */
  unread: (thread: string) => number
}

/** The app icons: a name, a colour and a simple glyph (an SVG path on a 24 box). */
export const APPS: { id: AppId; name: string; color: string; glyph: string }[] = [
  { id: 'deliver', name: 'Deliver It', color: '#f2b82a', glyph: 'M4 9h16v10H4zM8 9V6h8v3M10 13h4' },
  { id: 'messages', name: 'Messages', color: '#3ddc97', glyph: 'M4 5h16v11H9l-4 3v-3H4z' },
  { id: 'maps', name: 'Maps', color: '#5ea2ff', glyph: 'M12 3a6 6 0 0 1 6 6c0 4.5-6 12-6 12S6 13.5 6 9a6 6 0 0 1 6-6zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  { id: 'music', name: 'Radio', color: '#e0457b', glyph: 'M9 18a3 3 0 1 1-2-2.8V5l11-2v11a3 3 0 1 1-2-2.8V6.4L9 7.7z' },
  { id: 'wallet', name: 'Wallet', color: '#8f7ae6', glyph: 'M3 7h18v12H3zM3 7l14-3v3M16 13h3' },
  { id: 'garage', name: 'Garage', color: '#ff8a3d', glyph: 'M14.5 4.5a4 4 0 0 0-5 5L4 15l3 3 5.5-5.5a4 4 0 0 0 5-5L15 10l-1-1z' },
  { id: 'camera', name: 'Camera', color: '#9aa3ad', glyph: 'M4 8h4l2-2h4l2 2h4v11H4zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  { id: 'gaadigo', name: 'GaadiGo', color: '#19a974', glyph: 'M3 15l2-6h10l3 3h3v3h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0zM7 11l-1 2h8v-2z' },
  { id: 'spots', name: 'Namma spots', color: '#e8862a', glyph: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6L3.4 9.3l6-.7z' },
  { id: 'settings', name: 'Settings', color: '#6b7280', glyph: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' },
]


/** Ravi's thread in Messages. */
export const RAVI_THREAD = 'Ravi'
