/** A colour as red, green and blue from 0 to 1, in the same space as CSS colours. */
export type Rgb = [number, number, number]

export type WeatherName = 'clear' | 'cloudy' | 'rain'

type Weather = {
  label: string
  /** How often this weather comes up, compared with the others. */
  weight: number
  clouds: number
  rain: number
  wind: number
}

export const WEATHERS: Record<WeatherName, Weather> = {
  clear: { label: 'Clear', weight: 5, clouds: 0.2, rain: 0, wind: 0.3 },
  cloudy: { label: 'Cloudy', weight: 3, clouds: 0.75, rain: 0, wind: 0.6 },
  rain: { label: 'Rain', weight: 2, clouds: 1, rain: 1, wind: 1 },
}

const WEATHER_NAMES = Object.keys(WEATHERS) as WeatherName[]

export const SKY_RULES = {
  /**
   * One full day in real seconds: half an hour, so the sun turns about 0.2° a
   * second and shadows drift rather than visibly sweep. A day of ten minutes
   * moved every shadow noticeably from one second to the next.
   */
  dayLength: 1800,
  /** The clock runs this much faster after dark, so most riding is in daylight. */
  nightClockSpeed: 2,
  startHour: 9,
  /** A first visit (no saved progress) starts when the story says it does: 6:40 in the morning, the sun just up. */
  firstStartHour: 6 + 40 / 60,
  /** During the tutorial the clock runs no faster than this many times real time (a day is 48 times). */
  tutorialClock: 5,
  /** The clock runs at this speed through the evening's golden hour, so it lasts a few real minutes. */
  goldenClockSpeed: 0.5,
  goldenClockFrom: 16.75,
  goldenClockTo: 18.4,
  /** How long one weather lasts, in real seconds. */
  minWeatherTime: 600,
  maxWeatherTime: 110,
  /** How quickly one weather turns into the next. Higher is faster. */
  weatherResponse: 0.04,
  /** The sun and moon light from no lower than this, so shadows can't stretch forever. */
  minLightHeight: 0.2,
}

export type SkyState = {
  /** The time of day, from 0 up to 24. */
  hours: number
  weather: WeatherName
  weatherLeft: number
  /** These drift towards the current weather's values. */
  clouds: number
  rain: number
  wind: number
}

export type SkyLook = {
  /** The real sun's direction, which can be below the horizon. */
  sunDirection: [number, number, number]
  /** Where the light comes from: the sun by day, the moon by night. */
  lightDirection: [number, number, number]
  lightColor: Rgb
  lightIntensity: number
  /** How dark shadows are, from 0 to 1. Thick cloud washes them out. */
  shadowStrength: number
  ambientIntensity: number
  /** The fill light from above: the sky, cool, so shadows read a little blue. */
  ambientColor: Rgb
  /** The fill light from below: sun bounced off the red earth and roads, warm. */
  groundColor: Rgb
  /** How thick the golden haze is, from 0 to 1: thickest when the sun is low. */
  haze: number
  zenith: Rgb
  horizon: Rgb
  cloudColor: Rgb
  /** 0 by day, 1 at night. */
  night: number
  /** How crisp shadows are: 1 in clear daylight, where the sun is a small hard light; 0 under cloud and at night. */
  shadowSharpness: number
}

const NOON_ZENITH: Rgb = [0.33, 0.57, 0.88]
/** The haze at the horizon by day: a pale warm white, not blue-white. Far things fade into it. */
const NOON_HORIZON: Rgb = [0.86, 0.87, 0.83]
const DUSK_ZENITH: Rgb = [0.27, 0.32, 0.53]
const DUSK_HORIZON: Rgb = [0.97, 0.66, 0.4]
const NIGHT_ZENITH: Rgb = [0.03, 0.05, 0.12]
const NIGHT_HORIZON: Rgb = [0.09, 0.12, 0.2]
const OVERCAST: Rgb = [0.62, 0.66, 0.7]
const SUNLIGHT: Rgb = [1, 0.9, 0.76]
const LOW_SUNLIGHT: Rgb = [1, 0.6, 0.34]
const MOONLIGHT: Rgb = [0.62, 0.72, 1]
const DAY_AMBIENT: Rgb = [0.78, 0.86, 1]
const NIGHT_AMBIENT: Rgb = [0.55, 0.65, 0.95]
/** Sunlight bounced off red earth and warm plaster. */
const DAY_GROUND: Rgb = [0.66, 0.5, 0.38]
const NIGHT_GROUND: Rgb = [0.2, 0.18, 0.22]
const DAY_CLOUD: Rgb = [0.97, 0.97, 0.97]
const DUSK_CLOUD: Rgb = [0.98, 0.72, 0.6]
const NIGHT_CLOUD: Rgb = [0.13, 0.15, 0.22]
const STORM_CLOUD: Rgb = [0.48, 0.5, 0.54]

/**
 * Clear skies (ART_DIRECTION.md: a low warm sun with crisp shadows). With no
 * cloud, the sun is warmer and a little stronger, the sky overhead a deeper
 * blue, and the fill a touch lower so the shadows read. All of it fades out as
 * cloud comes in, so cloudy and rainy days are as they were.
 */
export const CLEAR_SKY = {
  /** Cloud cover at which clear-sky looks start and stop fading. Clear weather sits at 0.2, cloudy at 0.75. */
  cloudsFrom: 0.25,
  cloudsTo: 0.55,
  sunBoost: 1.25,
  sunColor: [1, 0.82, 0.6] as Rgb,
  /** How much of `sunColor` goes into the midday sun. */
  sunWarmth: 0.7,
  zenith: [0.12, 0.36, 0.85] as Rgb,
  /** The fill light, as a share of what it would be. */
  ambient: 0.85,
  /**
   * The riding hours the light is tuned for, 8 to 11 and 4 to 6: the sun lower
   * and raking, so it's warmer and stronger still, and the shadows darker (less
   * fill and less bounce off the ground). By how much at the peak of each window.
   */
  goldenSun: 0.15,
  goldenWarmth: 0.2,
  goldenAmbient: 0.82,
  goldenBounce: 0.75,
  /**
   * Mornings (6:30 to 9:30) are warmer still: Bengaluru's morning light through dust and
   * smoke is a soft gold, not the cool blue-white of an empty sky. More of the warm sun colour,
   * and a thicker haze, at the peak.
   */
  morningWarmth: 0.3,
  morningHaze: 0.2,
  /** In the morning the sky's fill, which lights the shade, and the horizon move this far to warm. */
  morningFill: 0.4,
  morningFillColor: [1, 0.88, 0.74] as Rgb,
  morningHorizon: 0.35,
  /**
   * The evening's golden hour (about 16:45 to 18:15, the first visit's 17:30): a strong, deep orange
   * sun low across the streets, so facades facing it glow and long shadows reach over the road, with
   * a lower, bluer fill so the shade reads cool against it. Without this the real sun, only 6° up at
   * 17:30, gave a weak light and a flat fill that read as overcast, or as dusk already.
   */
  eveningSunColor: [1, 0.56, 0.27] as Rgb,
  /** How far the light's colour moves to `eveningSunColor` at the peak. */
  eveningWarmth: 0.7,
  /** The sun's light, as a share more, at the peak. */
  eveningSun: 0.35,
  /** The light comes from this low (a sine of its height: about 15°, against 25° or more the rest of the day), for long shadows. */
  eveningLightHeight: 0.26,
  /**
   * The sun's path swings this far sideways (as `z` in its direction, 0.45 the rest of the day), so the
   * evening sun crosses HSR's grid of streets at about 40° instead of running straight down the
   * east-west ones: one side of every street gets the light, and shadows fall across the road.
   */
  eveningSwing: -0.6,
  /** The fill, as a share of what it would be, and moved this far towards `eveningFillColor`. */
  eveningAmbient: 0.72,
  eveningFill: 0.6,
  eveningFillColor: [0.52, 0.66, 1] as Rgb,
  /** The warm bounce off the ground, as a share of what it would be. */
  eveningBounce: 0.7,
  /** The sky overhead moves this far back to a clear blue, so it doesn't read as overcast. */
  eveningZenith: 0.45,
  eveningZenithColor: [0.18, 0.33, 0.66] as Rgb,
}

/** 1 through the evening's golden hour, about 16:45 to 18:15, easing in and out. */
function eveningHours(hours: number): number {
  return smoothstep(16.25, 16.9, hours) * (1 - smoothstep(18.05, 18.4, hours))
}

/** 1 through the morning, 6:30 to 9:30, easing in and out over half an hour. */
function morningHours(hours: number): number {
  return smoothstep(6, 6.5, hours) * (1 - smoothstep(9.5, 10, hours))
}

/** 1 through the riding windows (8 to 11 and 4 to 6), easing in and out over half an hour. */
function goldenHours(hours: number): number {
  const window = (from: number, to: number) => smoothstep(from - 0.5, from, hours) * (1 - smoothstep(to, to + 0.5, hours))
  return Math.max(window(8, 11), window(16, 18))
}

const SUN_INTENSITY = 2.8
const MOON_INTENSITY = 1.3
const DAY_AMBIENT_INTENSITY = 1
const NIGHT_AMBIENT_INTENSITY = 1

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function mixColor(a: Rgb, b: Rgb, amount: number): Rgb {
  return [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)]
}

/** 0 below `start`, 1 above `end`, with a smooth curve between. */
function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

export function createSkyState(hours: number = SKY_RULES.startHour): SkyState {
  const { clouds, rain, wind } = WEATHERS.clear
  return {
    hours,
    weather: 'clear',
    weatherLeft: SKY_RULES.minWeatherTime,
    clouds,
    rain,
    wind,
  }
}

/** Starts a different weather from the current one. */
export function changeWeather(state: SkyState, random: () => number) {
  const options = WEATHER_NAMES.filter((name) => name !== state.weather)
  const total = options.reduce((sum, name) => sum + WEATHERS[name].weight, 0)

  let roll = random() * total
  state.weather = options[options.length - 1]
  for (const name of options) {
    roll -= WEATHERS[name].weight
    if (roll < 0) {
      state.weather = name
      break
    }
  }

  const { minWeatherTime, maxWeatherTime } = SKY_RULES
  state.weatherLeft = minWeatherTime + random() * (maxWeatherTime - minWeatherTime)
}

/**
 * Advances the clock and the weather. Updates `state` in place. `clockScale` slows the clock alone
 * (not the weather), as going online does, so a shift is a few game hours.
 */
export function stepSky(state: SkyState, dt: number, random: () => number = Math.random, clockScale = 1) {
  const isNight = state.hours < 5.5 || state.hours >= 18.5
  const isGolden = state.hours >= SKY_RULES.goldenClockFrom && state.hours < SKY_RULES.goldenClockTo
  const clockSpeed = (isNight ? SKY_RULES.nightClockSpeed : isGolden ? SKY_RULES.goldenClockSpeed : 1) * clockScale
  state.hours = (state.hours + (dt * clockSpeed * 24) / SKY_RULES.dayLength) % 24

  state.weatherLeft -= dt
  if (state.weatherLeft <= 0) changeWeather(state, random)

  const target = WEATHERS[state.weather]
  const blend = 1 - Math.exp(-SKY_RULES.weatherResponse * dt)
  state.clouds += (target.clouds - state.clouds) * blend
  state.rain += (target.rain - state.rain) * blend
  state.wind += (target.wind - state.wind) * blend
}

/** How high the sun in the sky climbs: its height is scaled by this. It peaks at about 62°. */
const SKY_SUN_CLIMB = 0.85
/**
 * How high the sunlight comes from, scaled the same way. Bengaluru's real noon
 * sun is nearly overhead, but a lower light gives longer shadows and warmer
 * light all day, as the art direction asks. At 0.55 it peaks at about 51°. The
 * sky's colours still follow the real sun, so mornings stay blue, not dusky.
 */
const LIGHT_SUN_CLIMB = 0.55
/**
 * What full cloud takes off the light, as shares: the sun, the shadows it casts, and the fill from
 * the sky. Under cloud the light is dimmer and softer but it still comes from somewhere, so a
 * wall still has a lit side and a shaded one and its plaster still shows. (The sun was cut by 0.72
 * and the shadows by 0.85 with the fill left almost whole, 0.12: everything was lit evenly from
 * all round, and a rainy street was flat colour.)
 */
const CLOUD_LIGHT = { sun: 0.5, shadow: 0.7, fill: 0.28 }

/** The haze at its thinnest, around noon, and at night, as shares of its thickest. */
const NOON_HAZE = 0.45
const NIGHT_HAZE = 0.25

/** Works out the colours and lights for a moment of the day. */
export function getSkyLook({ hours, clouds }: SkyState): SkyLook {
  const clear = 1 - smoothstep(CLEAR_SKY.cloudsFrom, CLEAR_SKY.cloudsTo, clouds)
  const evening = eveningHours(hours) * clear
  // The sun rises at 6, is highest at 12 and sets at 18.
  const angle = ((hours - 6) / 12) * Math.PI
  const x = Math.cos(angle)
  const y = Math.sin(angle) * SKY_SUN_CLIMB
  const z = mix(0.45, CLEAR_SKY.eveningSwing, evening)
  const length = Math.hypot(x, y, z)
  const sunDirection: [number, number, number] = [x / length, y / length, z / length]
  const sunHeight = sunDirection[1]
  const lowY = Math.sin(angle) * LIGHT_SUN_CLIMB
  const lowLength = Math.hypot(x, lowY, z)
  const lightSun: [number, number, number] = [x / lowLength, lowY / lowLength, z / lowLength]

  const daylight = smoothstep(-0.05, 0.4, sunHeight)
  const night = 1 - smoothstep(-0.22, 0.02, sunHeight)
  const dusk = smoothstep(-0.2, 0.05, sunHeight) * (1 - smoothstep(0.1, 0.42, sunHeight))

  // Clear-sky colours from night, through sunset, to day.
  let zenith = mixColor(NIGHT_ZENITH, NOON_ZENITH, daylight)
  let horizon = mixColor(NIGHT_HORIZON, NOON_HORIZON, daylight)
  zenith = mixColor(zenith, DUSK_ZENITH, dusk)
  horizon = mixColor(horizon, DUSK_HORIZON, dusk)

  // A clear sky is a deeper blue overhead (not at the horizon, which stays hazy).
  const golden = goldenHours(hours) * clear
  const morning = morningHours(hours) * clear
  zenith = mixColor(zenith, CLEAR_SKY.zenith, clear * daylight * (1 - dusk))
  zenith = mixColor(zenith, CLEAR_SKY.eveningZenithColor, evening * CLEAR_SKY.eveningZenith)
  horizon = mixColor(horizon, DUSK_HORIZON, morning * CLEAR_SKY.morningHorizon)

  // Cloud cover greys everything, and dims it after dark too.
  const cover = smoothstep(0.3, 1, clouds)
  const brightness = mix(0.14, 1, 1 - night)
  const overcast = mixColor([0, 0, 0], OVERCAST, brightness)
  zenith = mixColor(zenith, overcast, cover * 0.9)
  horizon = mixColor(horizon, overcast, cover * 0.9)

  // The sun and moon take turns. Both are at zero at the moment they swap.
  // In the evening's golden hour the sun keeps its strength until it's nearly down.
  const sunUp = mix(smoothstep(0, 0.18, sunHeight), smoothstep(0, 0.05, sunHeight), evening)
  const moonUp = smoothstep(0, 0.18, -sunHeight)
  const isDay = sunHeight >= 0
  const lit = isDay ? lightSun : ([-sunDirection[0], -sunDirection[1], sunDirection[2]] as const)
  const lightY = Math.max(lit[1], mix(SKY_RULES.minLightHeight, CLEAR_SKY.eveningLightHeight, isDay ? evening : 0))
  const lightLength = Math.hypot(lit[0], lightY, lit[2])

  return {
    sunDirection,
    lightDirection: [lit[0] / lightLength, lightY / lightLength, lit[2] / lightLength],
    lightColor: isDay
      ? mixColor(
          mixColor(
            mixColor(LOW_SUNLIGHT, SUNLIGHT, smoothstep(0.05, 0.45, lightSun[1])),
            CLEAR_SKY.sunColor,
            Math.min(1, clear * CLEAR_SKY.sunWarmth + golden * CLEAR_SKY.goldenWarmth + morning * CLEAR_SKY.morningWarmth),
          ),
          CLEAR_SKY.eveningSunColor,
          evening * CLEAR_SKY.eveningWarmth,
        )
      : MOONLIGHT,
    lightIntensity:
      (isDay ? sunUp * SUN_INTENSITY * mix(1, CLEAR_SKY.sunBoost, clear) * (1 + golden * CLEAR_SKY.goldenSun) * (1 + evening * CLEAR_SKY.eveningSun) : moonUp * MOON_INTENSITY) *
      (1 - cover * CLOUD_LIGHT.sun),
    shadowStrength: 1 - cover * CLOUD_LIGHT.shadow,
    ambientIntensity:
      mix(NIGHT_AMBIENT_INTENSITY, DAY_AMBIENT_INTENSITY, daylight) *
      (1 - cover * CLOUD_LIGHT.fill) *
      mix(1, CLEAR_SKY.ambient, clear * daylight) *
      mix(1, CLEAR_SKY.goldenAmbient, golden * daylight) *
      mix(1, CLEAR_SKY.eveningAmbient, evening),
    ambientColor: mixColor(
      mixColor(mixColor(NIGHT_AMBIENT, DAY_AMBIENT, daylight), CLEAR_SKY.morningFillColor, morning * CLEAR_SKY.morningFill),
      CLEAR_SKY.eveningFillColor,
      evening * CLEAR_SKY.eveningFill,
    ),
    groundColor: mixColor(
      mixColor(mixColor(NIGHT_GROUND, DAY_GROUND, mix(daylight, 1, evening)), [0, 0, 0], (1 - CLEAR_SKY.goldenBounce) * golden * daylight),
      [0, 0, 0],
      (1 - CLEAR_SKY.eveningBounce) * evening,
    ),
    // Thickest with the sun low, thinner at noon and after dark. Cloud thickens it too.
    haze: Math.min(
      1,
      mix(NIGHT_HAZE, mix(1, NOON_HAZE, smoothstep(0.15, 0.5, sunHeight)), daylight) + cover * 0.3 + morning * CLEAR_SKY.morningHaze,
    ),
    zenith,
    horizon,
    cloudColor: mixColor(
      mixColor(mixColor(NIGHT_CLOUD, DAY_CLOUD, daylight), DUSK_CLOUD, dusk * (1 - cover)),
      mixColor([0, 0, 0], STORM_CLOUD, brightness),
      cover,
    ),
    night,
    shadowSharpness: clear * daylight,
  }
}

/** The time as a 24-hour clock, rounded down to five minutes. */
export function formatClock(hours: number): string {
  const totalMinutes = Math.floor((hours * 60) / 5) * 5
  const hour = Math.floor(totalMinutes / 60)
  return `${String(hour).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}
