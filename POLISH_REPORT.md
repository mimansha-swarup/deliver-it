# Polish sprint 1: report

Branch `polish-1`, 21 November 2026. Feature freeze: only what a first-time player meets in their
first 15 minutes. Every number here was measured on one machine (a 120 Hz laptop screen, headless
Chrome, production build) with `scripts/bench.mjs --ride --hour 17.5`.

The same report as a page, with the before/after screenshots and the video:
https://claude.ai/artifact/BwZx9TAuNehxdFQ9Qmj1eS (private until shared).

**Preview:** the branch is pushed, but this site builds Netlify previews for pull requests only
(`https://polish-1--deliver-simulator.netlify.app` returns 404). Open a pull request for
`polish-1` and Netlify posts the preview link on it. Production is untouched.

## The short version

- **Done and checked:** the first five minutes (four tutorial steps, a short first order, "You're
  free to explore"), the rider on foot, the way out of the dark store, the mid-ride freezes on
  High, the feedback form, sound buses and sliders, Explore's GaadiGo, the file rename, the
  playthrough video.
- **Targets met:** High is 83 to 96 FPS on all four spawns (was 66 to 74). Low is 120 FPS. A
  20-minute play had no console errors. First delivery in 1 min 51 s from the title screen
  (target: under 4 minutes).
- **Targets not met:** the worst frame on High is 50 ms on two of four spawns (target 25 ms).
  Low with the CPU slowed 4× is 40 FPS (target 60). Load to first ride is 7.0 to 8.1 s (target 8 s).
- **Not done:** parked-bike model quality (12), entrance clearance audit (8), indicators on
  traffic (part of 9), a door-opening animation (part of 2), the LinkedIn link (no address), and
  the two-device room test. Reasons are in the last section.

## Frame rate, worst frame and load, per spawn (17:30, clear)

| Spawn | Quality | FPS before | FPS after | Worst frame before | Worst frame after | Load to ride |
|---|---|---|---|---|---|---|
| main-road | High | 72 | 91 | 167 ms | 50 ms | 7.9 s |
| residential-street | High | 68 | 86 | 166 ms | 25 ms | 7.1 s |
| agara-flyover | High | 74 | 96 | 166 ms | 18 ms | 8.1 s |
| hosur-road | High | 66 | 83 | 167 ms | 50 ms | 7.0 s |
| main-road | Low | not measured | 120 | not measured | 10 ms | |
| residential-street | Low | not measured | 120 | not measured | 10 ms | |
| main-road | Low, CPU 4× slower | 37 | 40 | 210 ms | 50 ms | |
| residential-street | Low, CPU 4× slower | 36 | 41 | 49 ms | 35 ms | |

The same build varies by about ten FPS between runs, so read these as ranges.

**What the freezes were.** Every ride had three to five frames of 100 to 200 ms a few seconds in.
They were the automatic resolution scaler lowering the resolution mid-ride: each change rebuilds
every buffer the picture is drawn through. With the resolution held fixed the freezes went and
the same road ran at 91 FPS. The game now starts one step lower on screens faster than 60 Hz
(where it aims for 80 FPS), behind the loading screen, and remembers on each device where each
quality settled.

**What Low at 4× needs.** The frame's work is 21 ms there and has to be under 14. The player's own
vehicle and rider are about a quarter of it (75 separate small meshes, about 20 of them helmet
details). Merging those is the next step; it was not done in this sprint.

## What changed, item by item

### Phase 1: first five minutes

1. **New game flow.** The tutorial is four steps (accept, ride, pick up, deliver) instead of
   eight; the map, GaadiGo and going offline are told in passing. The first order is the nearest
   plain parcel to a house, 277 to 343 m of road in three tries, with the dog at the door where the
   planner can give one. A delivery ends with "You're free to explore". Timed with an autopilot
   at normal speed: delivered 1 min 51 s after the title screen.
2. **Customers at the door.** No placeholder figures were found: customers are the pedestrian
   models, they come to the gate, reach for the bag, and the recorded line plays. No change made.
   A door-opening animation was not added.
3. **Objective line and prompts.** Three stale or missing prompts fixed: the ride step waited for
   a turn and stayed up at the store's door; with the bag in hand nothing in the store marked the
   way out; and the last tutorial card stayed up after the delivery.

### Phase 2: on foot and camera

4. **Rider on foot.** On foot the rider is now a standing body of the pedestrians' build, walking
   by their walk, in the jacket colour and the helmet. The seated model, stood upright, was hunched
   with its arms against its sides; it is kept for the seat, getting on and off, and falls. Strides
   follow the distance covered. Limits: a jog is the walk with longer strides, not its own cycle;
   the jacket's back print is not on the standing body; the swap at the end of getting off is a cut.
5. **On-foot camera.** Checked, not changed: about 3.5 m back at shoulder height.
6. **Camera occlusion.** Checked, not changed: trees, poles, people and parked vehicles between
   camera and rider are dithered away; walls pull the camera in.
7. **Transitions.** Entering and leaving the store fade through dark with the place's name. The
   washed-out frame on leaving was the door's marker beam, which the rider stands inside: it is now
   hidden within 3.5 m. The rider is lit by the room indoors.
8. **Entrances clear.** Not audited.

### Phase 3: vehicles

9. **Lights.** Checked on the player's three modelled vehicles: lamps are parts of the model, red
   tail lamps, no floating discs. Traffic indicators were not checked or added.
10. **Vehicle LOD.** Already per vehicle, by camera distance, with a 4 m hysteresis. Not changed.
11. **Player scooter.** The mirrors came down from shoulder height to just over the grips. The
    headlamp is in the cowl already. Front panels and number plate not changed.
12. **Parked bikes.** Not done. See "Skipped".
13. **Tripo models.** Checked, not changed: the Vega 150's tank is plain; the Bhaara E-Cargo's box
    is Deliver It yellow with the logo. Colliders and rider pose were not re-measured.
14. **Explore and rentals.** Explore lists every vehicle free and unlocked, with no rental clock;
    the career save keeps its own vehicle and money. In career an overdue rental was charged its
    late fee (₹23 for 3 hours), collected, and the scooter came back.
15. **Brand-named files.** `yamaha.glb` is `sportbike.glb`, with its identifiers. Makes remain only
    in `CREDITS.txt` (the licences require the titles) and in the import script's source folders.

### Phase 4: sound

16. **Voices.** Phone voices (Ravi, customers, staff) have their own bus above the music, and the
    music dips to 45% while one speaks. RJ Manju stays on the music's bus with the radio treatment.
    Turn-taking and subtitles were already in place.
17. **Balance and sliders.** Settings has Master, Voices, Sound effects and Music. Levels were set
    by the mix's numbers; nothing was judged by ear.
18. **YouTube station.** Confirmed removed; only composed stations and generated voices.

### Phase 5: performance and stability

19. **High at 17:30.** See the table and "What the freezes were".
20. **Low at 4×.** 37 to 40 FPS: not met. What never moves (3,700 scene objects) now has its
    placement worked out once, and is thawed if it ever moves.
21. **20 minutes without errors.** A 20.2-minute automated play of the production build: no errors.
    Two warnings remain, both from libraries (a deprecated clock, two texture loaders). The game's
    own 28 start-up warnings are gone.

### Phase 6: launch prep

22. **Feedback.** A Feedback entry in the pause menu and on the title screen: what you liked, what
    broke, optional email. It posts to Netlify Forms. It can only be tested on a Netlify deploy,
    and form detection has to be switched on in the site's Netlify settings.
23. **Analytics.** Anonymous events are written (session start, tutorial complete, first delivery,
    session length, quality, errors; no cookies, no identifiers) and described in Credits. They
    send nothing until `ANALYTICS_URL` in `src/game/analytics.ts` is set.
24. **Share tags.** The live page's `og:image` and `twitter:image` are absolute and the image
    returns 200 (1200×630 JPEG). The platforms' own preview debuggers were not run.
25. **Credits.** The LinkedIn link shows once `LINKEDIN_URL` in `src/game/brand.ts` is given; it is
    empty. The Day counter was checked earlier against a migrated save.
26. **Multiplayer.** "Couldn't connect" with Try again, on the menu and while riding. Riders show on
    the full map with names and on the minimap as a coloured dot with an initial.

### Final

27. **Playthrough.** `clips/polish/swalpa-fast-first-five-minutes.mp4` (4 min 54 s, 1280×720): a
    fresh save, title screen, story, tutorial, the first delivery, then free riding at dusk. It is
    played by an autopilot, so the riding is clumsier than a person's.
28. **This report.**

## Skipped, and why

- **Parked bikes (12).** The blurry bike close to the camera is the model itself, simplified hard,
  not a far model shown near. Fixing it means baking a replacement into the traffic format (the
  Tripo Vega would also retire the one non-commercial model). That is model-pipeline work with its
  own checks, too large to do safely here.
- **Entrance clearance (8), traffic indicators (9), door animation (2).** Not reached.
- **Low at 4× (20) and the 25 ms worst frame (19).** Improved, not met; the next step is named above.
- **LinkedIn (25).** No address was given.
- **Two devices on two networks (26).** One machine can't test it.
- **Analytics endpoint (23) and Netlify Forms (22).** Each needs an account setting only you can make.
