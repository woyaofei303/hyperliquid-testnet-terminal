import { TPSL_OVERLAY_STYLES } from '../constants'

export const S = TPSL_OVERLAY_STYLES
export const BUTTON_GAP = 32
export const LEAVE_PADDING = 20
export const LEFT_OFFSET = 80
export const ESTIMATE_LEFT_OFFSET = LEFT_OFFSET
export const ESTIMATE_GAP = 4
export const SEGMENT_BORDER_OVERLAP = S.borderWidth
export const TEXT_SAFE_RIGHT_PADDING = 2
export const PROFIT_LABEL_RIGHT_PADDING = 6
export const createFont = () =>
  `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
