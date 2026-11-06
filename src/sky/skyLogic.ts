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
  /** One full day in real seconds. */
  dayLength: 600,
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
  ambientColor: Rgb
  zenith: Rgb
  horizon: Rgb
  cloudColor: Rgb
  /** 0 by day, 1 at night. */
  night: number
}

const NOON_ZENITH: Rgb = [0.35, 0.6, 0.87]
const NOON_HORIZON: Rgb = [0.81, 0.89, 0.95]
const DUSK_ZENITH: Rgb = [0.27, 0.32, 0.53]
const DUSK_HORIZON: Rgb = [0.96, 0.62, 0.38]
const NIGHT_ZENITH: Rgb = [0.03, 0.05, 0.12]
const NIGHT_HORIZON: Rgb = [0.09, 0.12, 0.2]
const OVERCAST: Rgb = [0.62, 0.66, 0.7]
const SUNLIGHT: Rgb = [1, 0.95, 0.86]
const LOW_SUNLIGHT: Rgb = [1, 0.62, 0.38]
const MOONLIGHT: Rgb = [0.62, 0.72, 1]
const DAY_AMBIENT: Rgb = [0.86, 0.93, 1]
const NIGHT_AMBIENT: Rgb = [0.55, 0.65, 0.95]
const DAY_CLOUD: Rgb = [0.97, 0.97, 0.97]
const DUSK_CLOUD: Rgb = [0.98, 0.72, 0.6]
const NIGHT_CLOUD: Rgb = [0.13, 0.15, 0.22]
const STORM_CLOUD: Rgb = [0.48, 0.5, 0.54]

const SUN_INTENSITY = 2.6
const MOON_INTENSITY = 1.3
const DAY_AMBIENT_INTENSITY = 1.1
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

/** Advances the clock and the weather. Updates `state` in place. */
export function stepSky(state: SkyState, dt: number, random: () => number = Math.random) {
  const isNight = state.hours < 5.5 || state.hours >= 18.5
  const clockSpeed = isNight ? SKY_RULES.nightClockSpeed : 1
  state.hours = (state.hours + (dt * clockSpeed * 24) / SKY_RULES.dayLength) % 24

  state.weatherLeft -= dt
  if (state.weatherLeft <= 0) changeWeather(state, random)

  const target = WEATHERS[state.weather]
  const blend = 1 - Math.exp(-SKY_RULES.weatherResponse * dt)
  state.clouds += (target.clouds - state.clouds) * blend
  state.rain += (target.rain - state.rain) * blend
  state.wind += (target.wind - state.wind) * blend
}

/** Works out the colours and lights for a moment of the day. */
export function getSkyLook({ hours, clouds }: SkyState): SkyLook {
  // The sun rises at 6, is highest at 12 and sets at 18.
  const angle = ((hours - 6) / 12) * Math.PI
  const x = Math.cos(angle)
  const y = Math.sin(angle) * 0.85
  const z = 0.45
  const length = Math.hypot(x, y, z)
  const sunDirection: [number, number, number] = [x / length, y / length, z / length]
  const sunHeight = sunDirection[1]

  const daylight = smoothstep(-0.05, 0.4, sunHeight)
  const night = 1 - smoothstep(-0.22, 0.02, sunHeight)
  const dusk = smoothstep(-0.2, 0.05, sunHeight) * (1 - smoothstep(0.1, 0.42, sunHeight))

  // Clear-sky colours from night, through sunset, to day.
  let zenith = mixColor(NIGHT_ZENITH, NOON_ZENITH, daylight)
  let horizon = mixColor(NIGHT_HORIZON, NOON_HORIZON, daylight)
  zenith = mixColor(zenith, DUSK_ZENITH, dusk)
  horizon = mixColor(horizon, DUSK_HORIZON, dusk)

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
  const lit = isDay ? sunDirection : ([-sunDirection[0], -sunDirection[1], sunDirection[2]] as const)
  const lightY = Math.max(lit[1], SKY_RULES.minLightHeight)
  const lightLength = Math.hypot(lit[0], lightY, lit[2])

  return {
    sunDirection,
    lightDirection: [lit[0] / lightLength, lightY / lightLength, lit[2] / lightLength],
    lightColor: isDay ? mixColor(LOW_SUNLIGHT, SUNLIGHT, smoothstep(0.05, 0.45, sunHeight)) : MOONLIGHT,
    lightIntensity: (isDay ? sunUp * SUN_INTENSITY : moonUp * MOON_INTENSITY) * (1 - cover * 0.72),
    shadowStrength: 1 - cover * 0.85,
    ambientIntensity:
      mix(NIGHT_AMBIENT_INTENSITY, DAY_AMBIENT_INTENSITY, daylight) * (1 - cover * 0.12),
    ambientColor: mixColor(NIGHT_AMBIENT, DAY_AMBIENT, daylight),
    zenith,
    horizon,
    cloudColor: mixColor(
      mixColor(mixColor(NIGHT_CLOUD, DAY_CLOUD, daylight), DUSK_CLOUD, dusk * (1 - cover)),
      mixColor([0, 0, 0], STORM_CLOUD, brightness),
      cover,
    ),
    night,
  }
}

/** The time as a 24-hour clock, rounded down to five minutes. */
export function formatClock(hours: number): string {
  const totalMinutes = Math.floor((hours * 60) / 5) * 5
  const hour = Math.floor(totalMinutes / 60)
  return `${String(hour).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}
