import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BRAND, LOGO_BOX } from '../game/brand'
import { BrandIcon, Logo } from '../ui/Logo'

/*
 * Makes the brand's files from the one drawing in ui/Logo.tsx: the logo's SVG and PNGs, the icon
 * set, the share image and the title screen's pictures. A tool for whoever changes the logo, not
 * part of the game: it's only loaded with `?brand` in the address (Root.tsx), and it sends each
 * file to a small receiver on this machine (`RECEIVER`), from where they're copied into art/logo
 * and public.
 *
 * An SVG drawn as a picture can't use the page's fonts, so the font is put inside it: Baloo Tamma 2
 * at weight 800 (SIL Open Font Licence, which allows it), the Latin and Kannada parts only.
 */

const RECEIVER = 'http://127.0.0.1:5198/'
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Baloo+Tamma+2:wght@800&display=swap'

let fontStyle: Promise<string> | null = null

/** The font as a style block with the files inside it, for an SVG that stands by itself. */
function embeddedFont(): Promise<string> {
  fontStyle ??= (async () => {
    const css = await (await fetch(FONT_CSS)).text()
    const faces = css.split('/*').filter((face) => /^\s*(latin|kannada)\s*\*\//.test(face))
    const parts: string[] = []
    for (const face of faces) {
      const url = /url\((https:[^)]+)\)/.exec(face)?.[1]
      const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1]
      if (!url) continue
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      parts.push(`@font-face{font-family:'Baloo Tamma 2';font-weight:800;src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');${range ? `unicode-range:${range};` : ''}}`)
    }
    return `<style>${parts.join('')}</style>`
  })()
  return fontStyle
}

/** A drawing as an SVG file's text, with the font inside. */
async function standalone(markup: string): Promise<string> {
  const style = await embeddedFont()
  return markup.replace(/(<svg[^>]*>)/, `$1${style}`)
}

const logoSvg = () => standalone(renderToStaticMarkup(createElement(Logo, {})))
const iconSvg = (bleed: boolean, safe: boolean) => standalone(renderToStaticMarkup(createElement(BrandIcon, { bleed, safe })))

async function picture(svg: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  // The fonts inside an SVG picture are read a moment after it; drawn at once, the letters can be missing.
  await new Promise((resolve) => setTimeout(resolve, 300))
  return image
}

function board(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

async function send(name: string, body: Blob | string): Promise<string> {
  const reply = await fetch(`${RECEIVER}?name=${encodeURIComponent(name)}`, { method: 'POST', body })
  return `${name}: ${await reply.text()} bytes`
}

const blobOf = (canvas: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), type, quality))

/** The game's picture as it is now, cut to fill `width` by `height`. Waits for a drawn frame. */
async function frame(width: number, height: number) {
  const view = document.querySelector('canvas')
  if (!view) throw new Error('No game view')
  const { canvas, context } = board(width, height)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      const scale = Math.max(width / view.width, height / view.height)
      const w = view.width * scale
      const h = view.height * scale
      context.drawImage(view, (width - w) / 2, (height - h) / 2, w, h)
      resolve()
    }),
  )
  return { canvas, context }
}

export const brandExport = {
  /** The logo: its SVG, and PNGs at three widths on nothing (transparent). */
  async logo() {
    const svg = await logoSvg()
    const done = [await send('swalpa-fast.svg', svg)]
    const image = await picture(svg)
    for (const width of [512, 1024, 2048]) {
      const { canvas, context } = board(width, Math.round((width * LOGO_BOX.height) / LOGO_BOX.width))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      done.push(await send(`swalpa-fast-${width}.png`, await blobOf(canvas)))
    }
    return done
  },

  /** The icon set: ಸ on yellow. Rounded for browsers, square for Apple (which rounds it), and a maskable one for Android. */
  async icons() {
    const done = [await send('icon.svg', await iconSvg(false, false))]
    const sets: [string, number, boolean, boolean][] = [
      ['favicon-16.png', 16, false, false],
      ['favicon-32.png', 32, false, false],
      ['apple-touch-icon.png', 180, true, false],
      ['icon-192.png', 192, false, false],
      ['icon-512.png', 512, false, false],
      ['icon-maskable-512.png', 512, true, true],
    ]
    for (const [name, size, bleed, safe] of sets) {
      const image = await picture(await iconSvg(bleed, safe))
      const { canvas, context } = board(size, size)
      context.drawImage(image, 0, 0, size, size)
      done.push(await send(name, await blobOf(canvas)))
    }
    return done
  },

  /** The share image, 1200 by 630: the game's picture as it is now, shaded on the left, with the logo and the tagline. */
  async share(tagline: string, kannada: string, name = 'share') {
    const { canvas, context } = await frame(1200, 630)
    const shade = context.createLinearGradient(0, 0, 760, 0)
    shade.addColorStop(0, 'rgb(8 10 14 / 78%)')
    shade.addColorStop(1, 'rgb(8 10 14 / 0%)')
    context.fillStyle = shade
    context.fillRect(0, 0, 1200, 630)
    const logo = await picture(await logoSvg())
    context.drawImage(logo, 36, 110, 576, 320)
    await document.fonts.load("800 40px 'Baloo Tamma 2'", `${kannada}${tagline}`)
    context.textBaseline = 'alphabetic'
    context.fillStyle = BRAND.yellow
    context.font = "800 40px 'Baloo Tamma 2'"
    context.fillText(kannada, 72, 492)
    context.fillStyle = BRAND.cream
    context.font = "800 34px 'Baloo Tamma 2'"
    context.fillText(tagline, 72, 546)
    return send(`${name}.jpg`, await blobOf(canvas, 'image/jpeg', 0.86))
  },

  /** A title screen picture: the game as it is now, 1920 by 1080. */
  async title(name: string) {
    const { canvas } = await frame(1920, 1080)
    return send(`${name}.jpg`, await blobOf(canvas, 'image/jpeg', 0.8))
  },
}
