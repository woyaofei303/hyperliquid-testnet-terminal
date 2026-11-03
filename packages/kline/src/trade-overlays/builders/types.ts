import type { getTpslButtonOverlayIds, getTpslOverlayIds } from '../idFactory'

export type OverlayIds = ReturnType<typeof getTpslOverlayIds>
export type ButtonOverlayIds = ReturnType<typeof getTpslButtonOverlayIds>
