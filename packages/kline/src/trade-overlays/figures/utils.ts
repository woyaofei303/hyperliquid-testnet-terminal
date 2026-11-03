/**
 * Helper to draw rounded rect with specific corners
 */
export const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: { tl: number; tr: number; br: number; bl: number },
): void => {
  ctx.beginPath()
  ctx.moveTo(x + radius.tl, y)
  ctx.lineTo(x + width - radius.tr, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr)
  ctx.lineTo(x + width, y + height - radius.br)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height)
  ctx.lineTo(x + radius.bl, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl)
  ctx.lineTo(x, y + radius.tl)
  ctx.quadraticCurveTo(x, y, x + radius.tl, y)
  ctx.closePath()
}

/**
 * 绘制拖拽手柄（三条水平横线）
 * 参考 Figma: node-id=18456-80508
 * @param ctx Canvas 上下文
 * @param centerX 手柄中心 X 坐标
 * @param centerY 手柄中心 Y 坐标
 * @param color 线条颜色
 */
export const drawDragHandle = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  color: string,
): void => {
  const barWidth = 3
  const barHeight = 1
  const barGap = 2
  const totalHeight = 3 * barHeight + 2 * barGap

  ctx.fillStyle = color
  // 绘制3条水平线，垂直居中
  for (let i = 0; i < 3; i++) {
    const barY = centerY - totalHeight / 2 + i * (barHeight + barGap)
    ctx.fillRect(centerX - barWidth / 2, barY, barWidth, barHeight)
  }
}

/**
 * 绘制预估线拖拽手柄（三条水平横线，6*1，间距 1.5）
 */
export const drawEstimateLineDragHandle = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  color: string,
): void => {
  const barWidth = 6
  const barHeight = 1
  const barGap = 1.5
  const totalHeight = 3 * barHeight + 2 * barGap

  ctx.fillStyle = color
  // 绘制3条水平线，垂直居中
  for (let i = 0; i < 3; i++) {
    const barY = centerY - totalHeight / 2 + i * (barHeight + barGap)
    ctx.fillRect(centerX - barWidth / 2, barY, barWidth, barHeight)
  }
}

/**
 * 绘制关闭按钮图标（X）
 * 参考 Figma: node-id=18456-80498
 * @param ctx Canvas 上下文
 * @param centerX 图标中心 X 坐标
 * @param centerY 图标中心 Y 坐标
 * @param size 图标大小
 * @param color 线条颜色
 */
export const drawCloseIcon = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  _size: number,
  color: string,
): void => {
  const halfSize = 3.5

  ctx.save()
  ctx.beginPath()
  // 左上到右下
  ctx.moveTo(centerX - halfSize, centerY - halfSize)
  ctx.lineTo(centerX + halfSize, centerY + halfSize)
  // 右上到左下
  ctx.moveTo(centerX + halfSize, centerY - halfSize)
  ctx.lineTo(centerX - halfSize, centerY + halfSize)

  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
}
