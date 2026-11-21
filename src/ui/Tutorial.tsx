import { useEffect } from 'react'
import { useGameStore } from '../game/gameStore'
import { keyFor, useKeys } from '../game/keyBindings'
import { livePlayer } from '../game/livePlayer'
import { firstOrder, TUTORIAL_STEPS, useTutorial, type TutorialStep } from '../game/tutorial'
import { useDiscovery } from '../game/discovery'

/*
 * The tutorial: Ravi teaches one control at a time, in the world, in chat, and a small card says
 * what to do now, with the keys as they're set. Each step finishes when the rider has done it (the
 * director below watches for that), or with Skip. Four steps: accept the first order (the rider is
 * online with it waiting), ride, pick up at the dark store, deliver. Then "You're free to explore". Every step can
 * be skipped, the whole of it too, and Settings on the phone plays it again.
 */

type StepText = { ravi: () => string; card: () => string; optional?: boolean }

const STEPS: Record<TutorialStep, StepText> = {
  accept: {
    ravi: () => `Namaskara, maga! Ravi here, from Deliver It dispatch. No time for chai: you're online and your first order is already here. Press ${keyFor('accept')} to take it.`,
    card: () => `Your first order is waiting. Accept it: ${keyFor('accept')}.`,
  },
  ride: {
    ravi: () => `Super! Now ride: ${keyFor('forward')} to go, ${keyFor('left')} and ${keyFor('right')} to steer, ${keyFor('backward')} to brake. Follow the green arrow at the top to the dark store.`,
    card: () => `Ride: ${keyFor('forward')} to go, ${keyFor('left')} / ${keyFor('right')} to steer, ${keyFor('backward')} to brake. Follow the green arrow.`,
  },
  pickup: {
    ravi: () => `That's it. The dark store is close: park outside, get off with ${keyFor('mount')}, walk in and take the bag at the counter with ${keyFor('interact')}. (${keyFor('map')} shows the whole map, any time.)`,
    card: () => `At the dark store: stop, get off (${keyFor('mount')}), walk in at the door (${keyFor('interact')}), take the bag at the counter (${keyFor('interact')}), walk out and get back on (${keyFor('mount')}).`,
  },
  deliver: {
    ravi: () => "Got it! Now to the customer's door, it's not far. On time and no crashes gets the best tip.",
    card: () => `Follow the green arrow to the customer. Park, get off (${keyFor('mount')}), walk to the door, ring the bell and hand it over (${keyFor('interact')}).`,
  },
}

const POLL_MS = 200
/** "You're free to explore" comes this long after the first hand-over, in milliseconds. */
const FREE_CARD_AFTER_MS = 6500

/** Watches for each step being done, and has Ravi introduce each one. */
function TutorialDirector() {
  const step = useTutorial((state) => state.step)
  const next = useTutorial((state) => state.next)

  useEffect(() => {
    if (!step) return
    const game = useGameStore.getState()
    game.raviSays(STEPS[step].ravi())
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
      // The first order: a plain parcel to a house on the street (not a flat up a lift, nor the gated
      // society), as near as the planner finds in a good many tries, and with something at the door
      // worth remembering where it can be had: the dog who only barks.
      if (!state.planner) return
      const fits = (one: typeof mission) => one.door.kind === 'house' && one.story.cargo === 'parcel' && one.story.care === 'none'
      let mission = state.planner.planMission(livePlayer.x, livePlayer.z, 1)
      let best = fits(mission) ? mission : null
      for (let tries = 0; tries < 60; tries++) {
        mission = state.planner.planMission(livePlayer.x, livePlayer.z, 1)
        if (!fits(mission)) continue
        const better = !best || (mission.door.scene === 'dog' ? 0.75 : 1) * mission.routeLength < (best.door.scene === 'dog' ? 0.75 : 1) * best.routeLength
        if (better) best = mission
      }
      mission = best ?? mission
      firstOrder.metres = mission.routeLength
      firstOrder.scene = mission.door.scene
      useGameStore.setState({ offer: { mission, expiresAt: performance.now() + 10 * 60 * 1000 } })
    }

    const check = () => {
      const state = useGameStore.getState()
      switch (step) {
        case 'ride':
          // Moving is enough (it used to want a turn as well, and a rider who went straight to the
          // store was left reading "ride and steer" at its door). Anyone already past the pickup has ridden.
          if (state.speedKmh >= 15 || (state.mission && state.phase !== 'toPickup')) finish()
          break
        case 'accept':
          // The tutorial opens on an order: online without being asked, and the order there at once.
          if (state.duty !== 'online' && !state.mission) state.goOnline()
          offerNow()
          if (state.mission) finish()
          break
        case 'pickup':
          if (state.phase !== 'toPickup' && state.mission) finish()
          break
        case 'deliver':
          // Handed over: the tutorial is done there and then (its card used to stay up, still saying
          // "follow the green arrow", until the result card closed). The city is theirs; said a few
          // seconds on, once the first-order award has had its moment.
          if (state.lastReward || state.history.length > 0) {
            finish(`That's the job, maga! You're free to explore. Stay online and orders keep coming; ${keyFor('online')} goes offline, ${keyFor('phone')} is your phone, ${keyFor('map')} the map.`)
            window.setTimeout(() => useDiscovery.getState().showCard('You’re free to explore', 'Orders keep coming while you’re online · P for your phone · Tab for the map'), FREE_CARD_AFTER_MS)
          }
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
