import { use } from 'react'
import { Player } from '../vehicle/Player'
import { Buildings } from './Buildings'
import { DebugMap } from './DebugMap'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { loadMapData } from './mapData'
import { Roads } from './Roads'

export function World() {
  const data = use(loadMapData())

  return (
    <>
      <Lighting />
      <Ground />
      <Roads roads={data.roads} />
      <Buildings buildings={data.buildings} />
      <DebugMap data={data} />
      <Player buildings={data.buildings} />
    </>
  )
}
