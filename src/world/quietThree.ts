import { BufferGeometry } from 'three'

/*
 * `toNonIndexed()` on a shape that already has no index does nothing but warn, and the game calls
 * it on every shape it builds without asking first (some have an index, some don't): 27 warnings
 * in the console at every start. Asked of a shape with no index, it now hands the shape back quietly.
 */
const toNonIndexed = BufferGeometry.prototype.toNonIndexed
BufferGeometry.prototype.toNonIndexed = function (this: BufferGeometry) {
  return this.index === null ? this : toNonIndexed.call(this)
}
