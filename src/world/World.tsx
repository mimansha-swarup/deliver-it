import { use } from 'react'
import { Buildings } from './Buildings'
import { DebugMap } from './DebugMap'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { loadMapData } from './mapData'

export function World() {
  const data = use(loadMapData())

  return (
    <>
      <Lighting />
      <Ground />
      <Buildings buildings={data.buildings} />
      <DebugMap data={data} />
    </>
  )
}
