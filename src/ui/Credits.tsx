/*
 * Who the map and models come from. The OpenStreetMap credit stays on screen while riding, as
 * its licence asks; the full list is on the title screen, in the phone's Settings and in the help
 * overlay (F1).
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

/** The line at the bottom of the screen: all of it on the title screen, only OpenStreetMap's while riding. */
export function Attribution({ riding }: { riding: boolean }) {
  return (
    <p className="attribution" data-riding={riding ? 'true' : undefined}>
      {riding ? (
        <a href={OSM} target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      ) : (
        <FullCredits />
      )}
    </p>
  )
}
