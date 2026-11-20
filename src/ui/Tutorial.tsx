import { useEffect } from 'react'
import { useGameStore } from '../game/gameStore'
import { keyFor, useKeys } from '../game/keyBindings'
import { livePlayer } from '../game/livePlayer'
import { TUTORIAL_STEPS, useTutorial, type TutorialStep } from '../game/tutorial'
import { useUi } from './uiState'

/*
 * The tutorial: Ravi teaches one control at a time, in the world, in chat, and a small card says
 * what to do now, with the keys as they're set. Each step finishes when the rider has done it (the
 * director below watches for that), or with Skip. It opens on an order: the rider is online with
 * their first order waiting, accepts it, then learns riding and steering and a breaker taken slowly
 * on the way to the dark store; picking up, the full map, delivering, GaadiGo (the other vehicles),
 * and going offline for the shift summary (and online again whenever they like). Every step can
 * be skipped, the whole of it too, and Settings on the phone plays it again.
 */

type StepText = { ravi: () => string; card: () => string; optional?: boolean }

const STEPS: Record<TutorialStep, StepText> = {
  accept: {
    ravi: () => `Namaskara, maga! Ravi here, from Deliver It dispatch. No time for chai: you're online and your first order is already here. Press ${keyFor('accept')} to take it.`,
    card: () => `Your first order is waiting. Accept it: ${keyFor('accept')}.`,
  },
  ride: {
    ravi: () => `Super! Now ride: ${keyFor('forward')} to go, ${keyFor('left')} and ${keyFor('right')} to steer. The arrow at the top points to the dark store.`,
    card: () => `Ride and steer: ${keyFor('forward')} to go, ${keyFor('left')} / ${keyFor('right')} to steer, ${keyFor('backward')} to brake.`,
  },
  brake: {
    ravi: () => `Chennagide! HSR is full of speed breakers. Slow down with ${keyFor('backward')} before one and roll over it gently, or the parcel suffers.`,
    card: () => `Brake (${keyFor('backward')}) before a speed breaker and take it slowly, under half speed.`,
  },
  pickup: {
    ravi: () => `Follow the arrow at the top and the line on your map to the dark store on 27th Main. Park outside, get off with ${keyFor('mount')}, walk in and collect the bag at the counter with ${keyFor('interact')}.`,
    card: () => `Ride to the dark store, stop and get off (${keyFor('mount')}). Walk in at its door (${keyFor('interact')}) and pick up the bag at the counter (${keyFor('interact')}). Then back out and on (${keyFor('mount')}).`,
  },
  map: {
    ravi: () => `Got it! Before you go: ${keyFor('map')} opens the full map of HSR. Have a look at where you're going.`,
    card: () => `Open the full map: ${keyFor('map')} (close it the same way, or with Esc).`,
  },
  deliver: {
    ravi: () => "Now take it to the customer's door. They'll rate you: on time and a smooth ride gets the best tip.",
    card: () => `Deliver it: follow the green arrow, park, get off (${keyFor('mount')}) and walk it to the door. ${keyFor('interact')} rings the bell and hands it over. Then see their rating and tip.`,
  },
  gaadigo: {
    ravi: () => `Sakkath! One more thing: GaadiGo, on your phone (${keyFor('phone')}). It rents and sells other vehicles: a cycle, an electric scooter, later a van for the big orders. Open it and have a look.`,
    card: () => `Open the phone (${keyFor('phone')}), unlock (Enter), and open GaadiGo: other vehicles to rent or buy, brought to you.`,
  },
  offline: {
    ravi: () => `Last one: ${keyFor('online')} takes you offline, and online again when you want work (the Deliver It app on your phone does it too). Go offline now to end your shift and see how it went.`,
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
      // A simple one to learn on: a plain parcel to a house's gate, not a flat up a lift or the gated society.
      if (!state.planner) return
      let mission = state.planner.planMission(livePlayer.x, livePlayer.z, 1)
      for (let tries = 0; tries < 20 && (mission.door.kind === 'flat' || mission.door.kind === 'society' || mission.story.cargo !== 'parcel' || mission.door.scene !== 'plain'); tries++) {
        mission = state.planner.planMission(livePlayer.x, livePlayer.z, 1)
      }
      useGameStore.setState({ offer: { mission, expiresAt: performance.now() + 10 * 60 * 1000 } })
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
        case 'accept':
          // The tutorial opens on an order: online without being asked, and the order there at once.
          if (state.duty !== 'online' && !state.mission) state.goOnline()
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
        case 'gaadigo':
          if (useUi.getState().phoneApp === 'gaadigo') finish(`That's your fleet. Tricks for the road: hold ${keyFor('handbrake')} in a turn to drift, ${keyFor('nitro')} for nitro, ${keyFor('horn')} for the horn. ${keyFor('help')} shows every control.`)
          break
        case 'offline':
          if (state.shiftSummary) summarySeen = true
          else if (summarySeen) finish("That's the job, maga. Ride anywhere, go online whenever you like. Nale sigona!")
          break
      }
    }
    const timer = window.setInterval(check, POLL_MS)
    return () => {
      window.clearInterval(timer)
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
