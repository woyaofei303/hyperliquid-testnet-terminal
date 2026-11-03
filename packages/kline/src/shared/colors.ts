import { getColorByCssVar } from '@fameex/utils'

export const getThemeBg2Color = (): string =>
  getColorByCssVar('--fx-bg-2') || '#FFFFFF'

export const getThemeBgRColor = (): string =>
  getColorByCssVar('--fx-bg-r') || '#FDEDED'

export const getThemeBgGColor = (): string =>
  getColorByCssVar('--fx-bg-g') || '#E7F8F2'
