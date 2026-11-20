/*
 * Who the map and models come from. The OpenStreetMap credit stays on screen while riding, as
 * its licence asks; the full list is on the Credits screen (ui/Menu.tsx), in the phone's Settings
 * and in the help overlay (F1).
 */

const OSM = 'https://www.openstreetmap.org/copyright'

/** Every credit, as links. */
export function FullCredits() {
  return (
    <>
      <a href={OSM} target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
      {' · '}
      <a href={`${import.meta.env.BASE_URL}data/CREDITS.txt`} target="_blank" rel="noreferrer">
        Overture Maps, Google Open Buildings, Microsoft
      </a>
      {' · '}
      <a href={`${import.meta.env.BASE_URL}models/CREDITS.txt`} target="_blank" rel="noreferrer">
        3D model credits
      </a>
    </>
  )
}

/** The line at the bottom of the screen while riding: OpenStreetMap's credit, as its licence asks. Everyone else is on the Credits screen. */
export function Attribution({ riding }: { riding: boolean }) {
  if (!riding) return null
  return (
    <p className="attribution" data-riding="true">
      <a href={OSM} target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </p>
  )
}
