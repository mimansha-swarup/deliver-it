/** `?tutorial=1` in the address starts the tutorial whatever the save says, at home. */
export function forcedTutorial(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('tutorial') === '1'
}
