import { useEffect } from 'react'
import { useGameStore } from '../game/gameStore'
import { isKey, keyFor, useKeys } from '../game/keyBindings'
import { livePlayer } from '../game/livePlayer'
import { TUTORIAL_STEPS, useTutorial, type TutorialStep } from '../game/tutorial'
import { useUi } from './uiState'

/*
 * The tutorial: Ravi teaches one control at a time, in the world, in chat, and a small card says
 * what to do now, with the keys as they're set. Each step finishes when the rider has done it (the
 * director below watches for that), or with Skip. Riding and steering, a breaker taken slowly,
 * going online in the Deliver It app, accepting the order, riding to the dark store, the full map,
 * delivering, a few optional tricks, and going offline for the shift summary.
 */

type StepText = { ravi: () => string; card: () => string; optional?: boolean }

const STEPS: Record<TutorialStep, StepText> = {
  ride: {
    ravi: () => `Namaskara, maga! Ravi here, from dispatch. Let's get you riding. ${keyFor('forward')} to go, ${keyFor('left')} and ${keyFor('right')} to steer.`,
    card: () => `Ride and steer: ${keyFor('forward')} to go, ${keyFor('left')} / ${keyFor('right')} to steer, ${keyFor('backward')} to brake.`,
  },
  brake: {
    ravi: () => `Super! HSR is full of speed breakers. Slow down with ${keyFor('backward')} before one and roll over it gently.`,
    card: () => `Brake (${keyFor('backward')}) before a speed breaker and take it slowly, under half speed.`,
  },
  online: {
    ravi: () => `Chennagide! Now open your phone (${keyFor('phone')}), unlock it, and go online in the Deliver It app.`,
    card: () => `Open the phone (${keyFor('phone')}), unlock (Enter), open Deliver It, and go online. (${keyFor('online')} works too.)`,
  },
  accept: {
    ravi: () => `You're online. Here's your first order, just for you. Press ${keyFor('accept')} to take it.`,
    card: () => `Accept the order: ${keyFor('accept')}.`,
  },
  pickup: {
    ravi: () => 'Follow the arrow at the top and the line on your map to the dark store on 27th Main. Stop in the orange ring.',
    card: () => 'Follow the arrow and the minimap to the dark store. Stop in the ring to collect.',
  },
  map: {
    ravi: () => `Got it! Before you go: ${keyFor('map')} opens the full map of HSR. Have a look at where you're going.`,
    card: () => `Open the full map: ${keyFor('map')} (close it the same way, or with Esc).`,
  },
  deliver: {
    ravi: () => "Now take it to the customer. They'll rate you: on time and a smooth ride gets the best tip.",
    card: () => 'Deliver to the customer: follow the green arrow, stop in the ring. Then see their rating and tip.',
  },
  extras: {
    ravi: () => `Sakkath! A few tricks, if you like: hold ${keyFor('handbrake')} while turning to drift, ${keyFor('nitro')} for nitro, ${keyFor('horn')} for the horn, ${keyFor('radio')} for the radio.`,
    card: () => `Optional: try two of drift (${keyFor('handbrake')} while turning), nitro (${keyFor('nitro')}), horn (${keyFor('horn')}), radio (${keyFor('radio')}).`,
    optional: true,
  },
  offline: {
    ravi: () => `Last one: go offline with ${keyFor('online')} to end your shift and see how it went.`,
    card: () => `Go offline (${keyFor('online')}) and look at your shift summary.`,
  },
}

/** How long the brake step waits for a breaker before a firm stop will do, in milliseconds. */
const BRAKE_FALLBACK_MS = 60_000
const POLL_MS = 200

/** Watches for each step being done, and has Ravi introduce each one. */
function TutorialDirector() {
  const step = useTutorial((state) => state.step)
  const next = useTutorial((state) => state.next)

  useEffect(() => {
    if (!step) return
    const game = useGameStore.getState()
    game.raviSays(STEPS[step].ravi())
    const started = performance.now()
    const startHeading = livePlayer.heading
    const startGentle = livePlayer.gentle
    let bumpsSeen = livePlayer.bumps
    let fastSince = 0
    let rewardSeen = false
    let summarySeen = false
    const tricks = new Set<string>()
    let done = false
    const finish = (line?: string) => {
      if (done) return
      done = true
      if (line) useGameStore.getState().raviSays(line)
      next()
    }

    // The first order comes at once in the tutorial, and waits for an answer.
    const offerNow = () => {
      const state = useGameStore.getState()
      if (state.duty !== 'online' || state.mission || state.offer) return
      state.makeOffer()
      useGameStore.getState().extendOffer(10 * 60 * 1000)
    }

    const check = () => {
      const state = useGameStore.getState()
      switch (step) {
        case 'ride': {
          const turned = Math.abs(Math.atan2(Math.sin(livePlayer.heading - startHeading), Math.cos(livePlayer.heading - startHeading)))
          if (state.speedKmh >= 15 && turned > 0.6) finish()
          break
        }
        case 'brake': {
          if (livePlayer.gentle > startGentle) finish('Nicely done. Slow over the breakers and your parcels stay safe.')
          else if (livePlayer.bumps > bumpsSeen) {
            bumpsSeen = livePlayer.bumps
            state.raviSays('Too fast, maga! Slow down before the next one.')
          }
          // No breaker on the way? A firm stop from speed will do, after a minute.
          if (state.speedKmh >= 20) fastSince = performance.now()
          if (performance.now() - started > BRAKE_FALLBACK_MS && fastSince && state.speedKmh <= 4 && performance.now() - fastSince < 3000) {
            finish('Good braking. Remember it before the humps.')
          }
          break
        }
        case 'online':
          if (state.duty === 'online') finish()
          break
        case 'accept':
          offerNow()
          if (state.mission) finish()
          break
        case 'pickup':
          if (state.phase !== 'toPickup' && state.mission) finish()
          break
        case 'map':
          if (useUi.getState().mapOpen) finish()
          break
        case 'deliver':
          if (state.lastReward) rewardSeen = true
          else if (rewardSeen) finish()
          break
        case 'extras':
          if (state.drifting) tricks.add('drift')
          if (state.nitroOn) tricks.add('nitro')
          if (tricks.size >= 2) finish('Ha, a natural!')
          break
        case 'offline':
          if (state.shiftSummary) summarySeen = true
          else if (summarySeen) finish("That's the job, maga. Ride anywhere, go online whenever you like. Nale sigona!")
          break
      }
    }
    const timer = window.setInterval(check, POLL_MS)
    // The horn and the radio count as tricks too.
    const onKey = (event: KeyboardEvent) => {
      if (step !== 'extras') return
      if (isKey('horn', event.code)) tricks.add('horn')
      if (isKey('radio', event.code)) tricks.add('radio')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [step, next])

  return null
}

/** The card top-left: which step, what to do, and Skip. */
function TutorialCard() {
  const step = useTutorial((state) => state.step)
  const next = useTutorial((state) => state.next)
  const finish = useTutorial((state) => state.finish)
  // Re-renders when keys are changed, so the card shows the new ones.
  useKeys((state) => state.bindings)
  if (!step) return null
  const { card, optional } = STEPS[step]
  return (
    <section className="tutorial-card" aria-live="polite">
      <p className="tutorial-step">
        Tutorial · {TUTORIAL_STEPS.indexOf(step) + 1} of {TUTORIAL_STEPS.length}
        {optional && <span className="tutorial-optional">Optional</span>}
      </p>
      <p className="tutorial-text">{card()}</p>
      <p className="tutorial-buttons">
        <button type="button" onClick={(event) => { next(); event.currentTarget.blur() }}>
          Skip step
        </button>
        <button
          type="button"
          onClick={(event) => {
            finish()
            useGameStore.getState().raviSays('No problem, maga. You can replay the tutorial from Settings on your phone.')
            event.currentTarget.blur()
          }}
        >
          Skip tutorial
        </button>
      </p>
    </section>
  )
}

export function Tutorial() {
  return (
    <>
      <TutorialDirector />
      <TutorialCard />
    </>
  )
}
