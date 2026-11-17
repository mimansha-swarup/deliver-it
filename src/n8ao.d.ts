/** n8ao ships without types. Only what the game uses is described here. */
declare module 'n8ao' {
  export class N8AOPostPass {
    /** Looks through the scene each frame for transparent materials, and turns `transparencyAware` on if it finds any. */
    autoDetectTransparency: boolean
    configuration: {
      /** Draws the scene twice more each frame so transparent things get correct AO. */
      transparencyAware: boolean
    }
  }
}
