import { useEffect, useRef, useState, type ReactNode } from 'react'
import { unlockAudio } from '../audio/audioEngine'
import { playPing } from '../audio/uiSounds'
import { FEEDBACK_URL, GAME_NAME, LINKEDIN_URL, VERSION } from '../game/brand'
import { useGameStore } from '../game/gameStore'
import { QUALITY_LEVELS } from '../game/qualitySettings'
import { clearProgress } from '../game/saveKeys'
import { LOOK_SPEED, useSettings } from '../game/settings'
import { useTutorial } from '../game/tutorial'
import { KeyList } from './HelpOverlay'
import { useT, type TextKey } from './menuText'

/*
 * The menus' parts, shared by the title screen and the pause menu: a list of big buttons, and the
 * Settings, Controls and Credits panels. All of it works with the arrow keys and Enter as well as
 * the mouse: up and down move between whatever can be used (buttons, sliders, switches), Enter or
 * Space uses it, left and right move a slider, and Esc goes back. Moving and choosing make a small
 * sound, and whatever has the keyboard is ringed.
 */

const USABLE = 'button:not(:disabled), input:not(:disabled), a[href]'

/**
 * The tick as the mouse comes onto something usable inside a panel (a button, a slider, a switch, a
 * link): once per thing, not for every move across it.
 */
function useHoverSound() {
  const last = useRef<Element | null>(null)
  return (event: React.MouseEvent) => {
    const over = (event.target as Element).closest(USABLE)
    if (over === last.current) return
    last.current = over
    if (over) sound('menuMove')
  }
}

/**
 * A menu sound. Browsers only allow sound once the page has been clicked or a key pressed, so the
 * very first hover after the page opens is silent; everything after the first click or key is heard.
 */
function sound(kind: 'menuMove' | 'menuSelect' | 'menuBack') {
  unlockAudio()
  playPing(kind)
}

/**
 * Up and down move the keyboard between the usable things inside `root`, wrapping at the ends. With
 * nothing chosen yet, the first press takes the first of them (and Enter uses it), so the keyboard
 * works from the moment a menu shows without a ring appearing before it's asked for.
 */
function useArrowKeys(root: React.RefObject<HTMLElement | null>, onBack?: () => void) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const within = root.current
      // Not while a key is being chosen for an action (Controls), which takes the next press itself.
      if (!within || document.querySelector('[data-listening="true"]')) return
      if (event.code === 'Escape' && onBack) {
        event.preventDefault()
        sound('menuBack')
        onBack()
        return
      }
      const items = [...within.querySelectorAll<HTMLElement>(USABLE)]
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        event.preventDefault()
        const step = event.code === 'ArrowDown' ? 1 : -1
        const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length
        items[next].focus()
        items[next].scrollIntoView({ block: 'nearest' })
        sound('menuMove')
      } else if (event.code === 'Enter' && at < 0 && !event.repeat) {
        event.preventDefault()
        items[0].focus()
        items[0].click()
      }
    }
    // On the document, not the window: the pause menu stops keys there, before the game (which listens on the window) hears them.
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [root, onBack])
}

export type MenuItem = { id: string; label: string; detail?: string; primary?: boolean; onSelect: () => void }

/** A column of big buttons: the first is the one Enter takes. */
export function MenuList({ items, label }: { items: MenuItem[]; label: string }) {
  const root = useRef<HTMLUListElement>(null)
  useArrowKeys(root)
  return (
    <ul className="menu-list" ref={root} aria-label={label}>
      {items.map(({ id, label: text, detail, primary, onSelect }) => (
        <li key={id}>
          <button
            type="button"
            // `title-start` is the name the benchmark and screenshot scripts press to start a ride.
            className={primary ? 'menu-button menu-primary title-start' : 'menu-button'}
            data-item={id}
            // The mouse over a button chooses it as the arrow keys do, with the same tick (once, on arriving).
            onMouseEnter={(event) => {
              if (document.activeElement === event.currentTarget) return
              event.currentTarget.focus({ preventScroll: true })
              sound('menuMove')
            }}
            onClick={() => {
              sound('menuSelect')
              onSelect()
            }}
          >
            <span className="menu-button-label">{text}</span>
            {detail && <span className="menu-button-detail">{detail}</span>}
            {primary && <kbd>Enter</kbd>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A panel over the menu: a title, its contents, and Back (Esc). The keyboard starts on Back. */
export function MenuPanel({ title, onBack, children, wide = false }: { title: string; onBack: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT()
  const root = useRef<HTMLElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  useArrowKeys(root, onBack)
  const hover = useHoverSound()
  useEffect(() => back.current?.focus({ preventScroll: true }), [])
  return (
    <section className="menu-panel" data-wide={wide || undefined} ref={root} role="dialog" aria-label={title} onMouseOver={hover}>
      <header className="menu-panel-top">
        <h2>{title}</h2>
        <button
          type="button"
          ref={back}
          className="menu-back"
          onClick={() => {
            sound('menuBack')
            onBack()
          }}
        >
          {t('back')} <kbd>Esc</kbd>
        </button>
      </header>
      <div className="menu-panel-body">{children}</div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="menu-group">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (value: number) => void }) {
  return (
    <label className="menu-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{show}</output>
    </label>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="menu-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          sound('menuSelect')
          onChange(event.target.checked)
        }}
      />
      <span>{label}</span>
    </label>
  )
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; text: string; lang?: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="menu-choice" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map(({ id, text, lang }) => (
          <button
            key={id}
            type="button"
            lang={lang}
            aria-pressed={value === id}
            onClick={() => {
              sound('menuSelect')
              onChange(id)
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Settings: the picture, sound and music, the camera, the language, deliveries, and progress (the
 * tutorial again, and a fresh start, which asks first). `inGame`: opened from the pause menu, where
 * the tutorial starts at once instead of on the next ride.
 */
export function SettingsPanel({ onBack, inGame = false, onTutorial }: { onBack: () => void; inGame?: boolean; onTutorial?: () => void }) {
  const t = useT()
  const quality = useGameStore((state) => state.quality)
  const alwaysWalk = useGameStore((state) => state.alwaysWalk)
  const settings = useSettings()
  const [asking, setAsking] = useState(false)
  const [tutorialSet, setTutorialSet] = useState(false)
  const percent = (share: number) => `${Math.round(share * 100)}%`

  if (asking) {
    return (
      <MenuPanel title={t('freshStart')} onBack={() => setAsking(false)}>
        <div className="menu-confirm" role="alertdialog" aria-label={t('freshQuestion')}>
          <p className="menu-confirm-question">{t('freshQuestion')}</p>
          <p>{t('freshDetail')}</p>
          <div className="menu-confirm-buttons">
            <button type="button" className="menu-plain" onClick={() => { sound('menuBack'); setAsking(false) }}>
              {t('freshNo')}
            </button>
            <button
              type="button"
              className="menu-danger"
              onClick={() => {
                clearProgress()
                window.location.reload()
              }}
            >
              {t('freshYes')}
            </button>
          </div>
        </div>
      </MenuPanel>
    )
  }

  return (
    <MenuPanel title={t('settings')} onBack={onBack}>
      <Group title={t('picture')}>
        <Choice
          label={t('quality')}
          value={quality}
          options={QUALITY_LEVELS.map((level) => ({ id: level, text: t(level as TextKey) }))}
          onChange={(level) => useGameStore.getState().setQuality(level)}
        />
      </Group>
      <Group title={t('sound')}>
        <Slider label={t('soundVolume')} value={settings.sfxVolume} min={0} max={1} step={0.05} show={percent(settings.sfxVolume)} onChange={(sfxVolume) => settings.set({ sfxVolume })} />
        <Slider label={t('musicVolume')} value={settings.musicVolume} min={0} max={1} step={0.05} show={percent(settings.musicVolume)} onChange={(musicVolume) => settings.set({ musicVolume })} />
      </Group>
      <Group title={t('camera')}>
        <Slider
          label={t('sensitivity')}
          value={settings.lookSpeed}
          min={LOOK_SPEED.min}
          max={LOOK_SPEED.max}
          step={0.1}
          show={`${settings.lookSpeed.toFixed(1)}×`}
          onChange={(lookSpeed) => settings.set({ lookSpeed })}
        />
        <Switch label={t('invertY')} checked={settings.invertY} onChange={(invertY) => settings.set({ invertY })} />
      </Group>
      <Group title={t('language')}>
        <Choice
          label={t('language')}
          value={settings.language}
          options={[
            { id: 'en', text: 'English' },
            { id: 'kn', text: 'ಕನ್ನಡ', lang: 'kn' },
          ]}
          onChange={(language) => settings.set({ language })}
        />
        <p className="menu-note">{t('languageNote')}</p>
      </Group>
      <Group title={t('deliveries')}>
        <Switch label={t('alwaysWalk')} checked={alwaysWalk} onChange={(on) => useGameStore.getState().setAlwaysWalk(on)} />
        <p className="menu-note">{t('alwaysWalkNote')}</p>
      </Group>
      <Group title={t('progress')}>
        <div className="menu-row">
          <button
            type="button"
            className="menu-plain"
            disabled={tutorialSet}
            onClick={() => {
              sound('menuSelect')
              if (inGame) {
                useTutorial.getState().start()
                onTutorial?.()
              } else useTutorial.setState({ done: false, replay: true })
              setTutorialSet(true)
            }}
          >
            {tutorialSet ? t('tutorialReset') : t('resetTutorial')}
          </button>
          <button type="button" className="menu-danger" onClick={() => { sound('menuSelect'); setAsking(true) }}>
            {t('freshStart')}
          </button>
        </div>
      </Group>
    </MenuPanel>
  )
}

/** Controls: every action and its keys, each changeable, and the mouse. */
export function ControlsPanel({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <MenuPanel title={t('controls')} onBack={onBack} wide>
      <KeyList editable />
    </MenuPanel>
  )
}

const OSM = 'https://www.openstreetmap.org/copyright'
const file = (path: string) => `${import.meta.env.BASE_URL}${path}`

function Outside({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

/** Credits: who made the game, and everyone whose map, models, type and sounds are in it. */
export function CreditsPanel({ onBack }: { onBack: () => void }) {
  const t = useT()
  return (
    <MenuPanel title={t('credits')} onBack={onBack} wide>
      <div className="menu-credits">
        <p className="menu-credits-maker">
          Made by <strong>Mimansha Swarup</strong> in Bengaluru
          {LINKEDIN_URL && (
            <>
              {' · '}
              <Outside href={LINKEDIN_URL}>LinkedIn</Outside>
            </>
          )}
        </p>

        <Group title="The map">
          <p>
            Streets, buildings, parks and lakes: <Outside href={OSM}>© OpenStreetMap contributors</Outside>, under the Open Database License (ODbL). HSR Layout and Agara are
            as its volunteers mapped them.
          </p>
          <p>
            Buildings and places of worship OpenStreetMap doesn’t have yet: Overture Maps Foundation, from Google Open Buildings (CC BY 4.0) and Microsoft Global ML Building
            Footprints (ODbL), and its places data (CDLA Permissive 2.0). <Outside href={file('data/CREDITS.txt')}>Every map source</Outside>
          </p>
        </Group>

        <Group title="3D models">
          <p>
            Traffic and people, each simplified and recoloured for the game, CC BY 4.0: cars by BHP3D, the auto by bhagathartworks, the delivery bike by Caitlin Pillay, people by
            Kalakar, Pixel_Monster, Aashutosh Dabhade and dk8026854; riders by Atrikumar Das and newArteest; the bull by stealth86. City pieces: Downtown City MegaKit by Quaternius (CC0). The sports bike by VTX (CC BY-NC-SA 4.0). The game has no connection with any
            vehicle maker. <Outside href={file('models/CREDITS.txt')}>Every model, with links</Outside>
            {' · '}
            <Outside href={file('textures/CREDITS.txt')}>Textures</Outside>
          </p>
        </Group>

        <Group title="Sound and music">
          <p>
            Engines, horns, rain, footsteps and the phone’s sounds are made in the game as it runs: there are no recordings. The radio’s own stations are composed in code. The
            video station plays videos from YouTube, which belong to their owners.
          </p>
        </Group>

        <Group title="Voices">
          <p>No recorded voices yet: Ravi, the customers and the family speak in text. When voices are recorded, the people who gave them are named here.</p>
        </Group>

        <Group title="Type">
          <p>Baloo Tamma 2 by Ek Type, for English and Kannada, under the SIL Open Font Licence.</p>
        </Group>

        <p className="menu-note">
          {GAME_NAME} is an independent game. “Deliver It”, “GaadiGo” and every shop and brand in it are made up; none is a real company.
        </p>
      </div>
    </MenuPanel>
  )
}

/** The line at the foot of a menu: the version, and where to send feedback. Nothing else. */
export function MenuFooter() {
  const t = useT()
  return (
    <p className="menu-footer">
      <span>v{VERSION}</span>
      {FEEDBACK_URL && (
        <a href={FEEDBACK_URL} target="_blank" rel="noreferrer noopener">
          {t('feedback')}
        </a>
      )}
    </p>
  )
}
