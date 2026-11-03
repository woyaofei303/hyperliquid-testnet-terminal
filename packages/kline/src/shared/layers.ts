export const OVERLAY_LAYER_STACK = {
  background: 10,
  solidLine: 40,
  base: 70,
  hitbox: 80,
  action: 90,
  tooltip: 100,
} as const

export type OverlayLayerKey = keyof typeof OVERLAY_LAYER_STACK

export const OVERLAY_Z_LEVELS = {
  CROSSHAIR: OVERLAY_LAYER_STACK.action + 1,
  TPSL: {
    background: OVERLAY_LAYER_STACK.background,
    solidLine: OVERLAY_LAYER_STACK.solidLine,
    base: OVERLAY_LAYER_STACK.base,
    hitbox: OVERLAY_LAYER_STACK.hitbox,
    action: OVERLAY_LAYER_STACK.action,
    tooltip: OVERLAY_LAYER_STACK.tooltip,
  },
} as const
