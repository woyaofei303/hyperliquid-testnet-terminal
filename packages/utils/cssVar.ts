const parseHexColor = (value: string) => {
  const hex = value.replace('#', '').trim()
  if (hex.length !== 3 && hex.length !== 6) return null
  const fullHex =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex
  const r = Number.parseInt(fullHex.slice(0, 2), 16)
  const g = Number.parseInt(fullHex.slice(2, 4), 16)
  const b = Number.parseInt(fullHex.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return { r, g, b }
}

const parseRgbColor = (value: string) => {
  const rgbMatch = value.match(/rgba?\(([^)]+)\)/i)
  const raw = rgbMatch ? rgbMatch[1] : value
  const parts = raw
    .replace('/', ' ')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (parts.length < 3) return null
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part))
  if ([r, g, b].some((item) => Number.isNaN(item))) return null
  return { r, g, b }
}

/**
 * Reads a CSS custom property from `:root` and returns an `rgba()` color string.
 *
 * Opacity resolution order:
 *  1. Explicit `opacity` argument (if provided)
 *  2. Companion CSS variable `${varName}-opacity` (e.g. `--fx-divider-2-opacity`)
 *  3. Falls back to `1`
 *
 * Supports both hex (`#aabbcc` / `#abc`) and space-separated RGB (`11 12 14`)
 * variable values.
 */
export const getColorByCssVar = (varName: string, opacity?: number): string => {
  if (typeof document === 'undefined') return ''
  const root = getComputedStyle(document.documentElement)
  const cssVarColor = root.getPropertyValue(varName).trim()
  if (!varName || !cssVarColor) {
    console.error(`不是有效的 key ${varName}`)
    return ''
  }

  const parsed = cssVarColor.startsWith('#')
    ? parseHexColor(cssVarColor)
    : parseRgbColor(cssVarColor)
  if (!parsed) {
    console.error(`无法解析颜色值 ${cssVarColor}`)
    return ''
  }

  const resolvedOpacity =
    opacity ??
    (Number.parseFloat(root.getPropertyValue(`${varName}-opacity`).trim()) || 1)

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${resolvedOpacity})`
}

export const createCssVar = (key: string) => {
  return {
    base: getColorByCssVar(key),
    opacity: (value: number) => getColorByCssVar(key, value),
  }
}

export const withAlpha = (color: string, alpha: number) => {
  if (!color) return color

  // 如果已经是 rgba，直接替换 alpha
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alpha})`)
  }

  // 如果是 rgb
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
  }

  // 处理 #RRGGBB
  if (color.startsWith('#')) {
    const hex = color.replace('#', '')
    const bigint = parseInt(hex, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  return color
}
