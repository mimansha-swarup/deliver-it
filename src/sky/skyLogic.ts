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
  /** How long one weather lasts, in real seconds. */
  minWeatherTime: 45,
  maxWeatherTime: 110,
  /** How quickly one weather turns into the next. Higher is faster. */
  weatherResponse: 0.15,
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

export function createSkyState(): SkyState {
  const { clouds, rain, wind } = WEATHERS.clear
  return {
    hours: SKY_RULES.startHour,
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
  const clockSpeed = (isNight ? SKY_RULES.nightClockSpeed : 1) * clockScale
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
/** The haze at its thinnest, around noon, and at night, as shares of its thickest. */
const NOON_HAZE = 0.45
const NIGHT_HAZE = 0.25

/** Works out the colours and lights for a moment of the day. */
export function getSkyLook({ hours, clouds }: SkyState): SkyLook {
  // The sun rises at 6, is highest at 12 and sets at 18.
  const angle = ((hours - 6) / 12) * Math.PI
  const x = Math.cos(angle)
  const y = Math.sin(angle) * SKY_SUN_CLIMB
  const z = 0.45
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
  const clear = 1 - smoothstep(CLEAR_SKY.cloudsFrom, CLEAR_SKY.cloudsTo, clouds)
  const golden = goldenHours(hours) * clear
  zenith = mixColor(zenith, CLEAR_SKY.zenith, clear * daylight * (1 - dusk))

  // Cloud cover greys everything, and dims it after dark too.
  const cover = smoothstep(0.3, 1, clouds)
  const brightness = mix(0.14, 1, 1 - night)
  const overcast = mixColor([0, 0, 0], OVERCAST, brightness)
  zenith = mixColor(zenith, overcast, cover * 0.9)
  horizon = mixColor(horizon, overcast, cover * 0.9)

  // The sun and moon take turns. Both are at zero at the moment they swap.
  const sunUp = smoothstep(0, 0.18, sunHeight)
  const moonUp = smoothstep(0, 0.18, -sunHeight)
  const isDay = sunHeight >= 0
  const lit = isDay ? lightSun : ([-sunDirection[0], -sunDirection[1], sunDirection[2]] as const)
  const lightY = Math.max(lit[1], SKY_RULES.minLightHeight)
  const lightLength = Math.hypot(lit[0], lightY, lit[2])

  return {
    sunDirection,
    lightDirection: [lit[0] / lightLength, lightY / lightLength, lit[2] / lightLength],
    lightColor: isDay
      ? mixColor(
          mixColor(LOW_SUNLIGHT, SUNLIGHT, smoothstep(0.05, 0.45, lightSun[1])),
          CLEAR_SKY.sunColor,
          Math.min(1, clear * CLEAR_SKY.sunWarmth + golden * CLEAR_SKY.goldenWarmth),
        )
      : MOONLIGHT,
    lightIntensity:
      (isDay ? sunUp * SUN_INTENSITY * mix(1, CLEAR_SKY.sunBoost, clear) * (1 + golden * CLEAR_SKY.goldenSun) : moonUp * MOON_INTENSITY) *
      (1 - cover * 0.72),
    shadowStrength: 1 - cover * 0.85,
    ambientIntensity:
      mix(NIGHT_AMBIENT_INTENSITY, DAY_AMBIENT_INTENSITY, daylight) *
      (1 - cover * 0.12) *
      mix(1, CLEAR_SKY.ambient, clear * daylight) *
      mix(1, CLEAR_SKY.goldenAmbient, golden * daylight),
    ambientColor: mixColor(NIGHT_AMBIENT, DAY_AMBIENT, daylight),
    groundColor: mixColor(mixColor(NIGHT_GROUND, DAY_GROUND, daylight), [0, 0, 0], (1 - CLEAR_SKY.goldenBounce) * golden * daylight),
    // Thickest with the sun low, thinner at noon and after dark. Cloud thickens it too.
    haze: Math.min(
      1,
      mix(NIGHT_HAZE, mix(1, NOON_HAZE, smoothstep(0.15, 0.5, sunHeight)), daylight) + cover * 0.3,
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
