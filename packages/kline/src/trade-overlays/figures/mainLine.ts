import {
  getThemeBg2Color,
  getThemeBgGColor,
  getThemeBgRColor,
} from '../../shared/colors'
import { getChartEngine } from '../../shared/engine'
import { TPSL_MAIN_LINE_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import { TPSL_LINE_TYPES } from '../types'
import type { TPSLMainLineAttrs } from './types'
import { drawCloseIcon, drawDragHandle, drawRoundedRect } from './utils'

const S = TPSL_OVERLAY_STYLES
const LINE_WIDTH = S.line.width
const LINE_DASH = S.line.dash

/** X按钮和止盈止损按钮之间的间距 */
const BUTTON_GAP = 0

/** 拖拽图标的padding */
const DRAG_HANDLE_PADDING = S.mainLine.tpslButton.dragHandlePadding

// ===== 注册状态标志 =====
let mainLineFigureRegistered = false

/**
 * ============================================================================
 * 注册主线图形
 * Register Main Line Figure
 * ============================================================================
 *
 * 绘制内容：
 * 1. 水平实线 - 表示入场价格
 * 2. 收益标签 - 红/绿底色，显示 "收益额 -3%"
 * 3. 持仓量标签 - 白底，显示持仓数量
 * 4. 关闭按钮 - Hover时显示，点击关闭overlay
 * 5. 止盈止损按钮 - Hover时显示，可拖拽创建预估收益线
 * 6. 拖拽手柄 - 三条横线图标，表示可拖拽
 */
export const registerMainLineFigure = (): void => {
  if (mainLineFigureRegistered) return
  mainLineFigureRegistered = true

  getChartEngine().registerFigure({
    name: TPSL_MAIN_LINE_FIGURE,
    draw: (
      ctx: CanvasRenderingContext2D,
      attrs: TPSLMainLineAttrs,
      _styles: unknown,
    ) => {
      const {
        x,
        y,
        width,
        lineType,
        profitText,
        positionText,
        orderPriceText,
        priceText: _priceText,
        isHovered,
        isLoss,
        isCloseHovered,
        isTPSLHovered,
      } = attrs

      const isOrder = lineType !== TPSL_LINE_TYPES.Position
      const color = isLoss ? S.colors.loss.primary : S.colors.profit.primary
      const bgColor = getThemeBg2Color()
      const badgeBgColor = isLoss ? getThemeBgRColor() : getThemeBg2Color()
      // hover时的深色背景
      const hoverBgColor = isLoss ? getThemeBgRColor() : getThemeBgGColor()

      ctx.save()

      // Draw horizontal line
      ctx.beginPath()
      ctx.setLineDash(LINE_DASH)
      ctx.moveTo(x, y)
      ctx.lineTo(width, y)
      ctx.strokeStyle = color
      ctx.lineWidth = LINE_WIDTH
      ctx.stroke()
      ctx.setLineDash([])

      ctx.font = `${S.text.fontWeight.regular} ${S.text.fontSize}px ${S.text.fontFamily}`
      const badgeY = y - S.height / 2

      // Calculate positions
      let currentX = x

      if (isOrder) {
        // ===== 委托单模式：显示 "限价" + 价格，hover 时显示关闭按钮和止盈止损 =====
        // 参考 Figma: node-id=18453-37272
        // 1. 限价标签: "限价" 文案
        const limitText = ''
        const limitTextWidth = ctx.measureText(limitText).width
        const limitBadgeWidth =
          limitTextWidth + S.mainLine.leftBadge.paddingX * 2

        // Draw limit badge background (左侧圆角)
        drawRoundedRect(ctx, currentX, badgeY, limitBadgeWidth, S.height, {
          tl: 2,
          tr: 0,
          br: 0,
          bl: 2,
        })
        ctx.fillStyle = color
        ctx.fill()

        // Draw "限价" text
        ctx.fillStyle = S.colors.text
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(limitText, currentX + limitBadgeWidth / 2, y)

        currentX += limitBadgeWidth

        // 2. 价格标签
        const priceText = orderPriceText || ''
        const priceTextWidth = ctx.measureText(priceText).width
        const priceBadgeWidth =
          priceTextWidth + S.mainLine.positionBadge.paddingX * 2

        // Draw price badge background (白底 + 边框)
        ctx.beginPath()
        ctx.rect(currentX, badgeY, priceBadgeWidth, S.height)
        ctx.fillStyle = bgColor
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = S.borderWidth
        ctx.stroke()

        // Draw price text
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.fillText(priceText, currentX + priceBadgeWidth / 2, y)

        currentX += priceBadgeWidth - S.borderWidth

        // 3. 关闭按钮（hover 时显示，右侧圆角）
        if (isHovered) {
          const closeSize = S.mainLine.closeButton.size
          const closePadding = S.mainLine.closeButton.padding
          const closeWidth = closeSize + closePadding * 2

          // Draw close button background
          drawRoundedRect(ctx, currentX, badgeY, closeWidth, S.height, {
            tl: 0,
            tr: 2,
            br: 2,
            bl: 0,
          })
          ctx.fillStyle = isCloseHovered ? hoverBgColor : badgeBgColor
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // Draw close icon (X)
          drawCloseIcon(ctx, currentX + closeWidth / 2, y, closeSize, color)

          currentX += closeWidth - S.borderWidth

          // 按钮间距
          currentX += BUTTON_GAP

          // 4. 止盈止损按钮（hover 时显示）
          const tpslText = ''
          const tpslTextWidth = ctx.measureText(tpslText).width
          const tpslWidth = tpslTextWidth + S.mainLine.tpslButton.paddingX * 2
          const dragHandleWidth =
            S.mainLine.tpslButton.dragHandleWidth + DRAG_HANDLE_PADDING * 2

          // Draw tpsl button background
          drawRoundedRect(
            ctx,
            currentX,
            badgeY,
            tpslWidth + dragHandleWidth,
            S.height,
            {
              tl: 0,
              tr: 2,
              br: 2,
              bl: 0,
            },
          )
          ctx.fillStyle = isTPSLHovered ? hoverBgColor : bgColor
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // Draw tpsl text
          ctx.fillStyle = color
          ctx.textAlign = 'center'
          ctx.fillText(tpslText, currentX + tpslWidth / 2, y)

          // Draw vertical separator line between text and drag handle
          ctx.beginPath()
          ctx.moveTo(currentX + tpslWidth, badgeY)
          ctx.lineTo(currentX + tpslWidth, badgeY + S.height)
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // Draw drag handle
          const handleX = currentX + tpslWidth
          drawDragHandle(ctx, handleX + dragHandleWidth / 2, y, color)
        }
      } else {
        // ===== 持仓模式：显示收益额 + 持仓量 + (hover时)关闭按钮 + 止盈止损按钮 =====
        // 1. Left badge (profit text): "收益额 -3%"
        const profitWidth = Math.max(
          S.mainLine.leftBadge.minWidth,
          ctx.measureText(profitText).width + S.mainLine.leftBadge.paddingX * 2,
        )

        // Draw left badge background
        drawRoundedRect(ctx, currentX, badgeY, profitWidth, S.height, {
          tl: 2,
          tr: 0,
          br: 0,
          bl: 2,
        })
        ctx.fillStyle = color
        ctx.fill()

        // Draw profit text
        ctx.fillStyle = S.colors.text
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(profitText, currentX + profitWidth / 2, y)

        currentX += profitWidth

        // 2. Position badge: "764.09"
        const positionWidth = Math.max(
          S.mainLine.positionBadge.minWidth,
          ctx.measureText(positionText).width +
            S.mainLine.positionBadge.paddingX * 2,
        )

        // Draw position badge background
        ctx.beginPath()
        ctx.rect(currentX, badgeY, positionWidth, S.height)
        ctx.fillStyle = bgColor
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = S.borderWidth
        ctx.stroke()

        // Draw position text
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.fillText(positionText, currentX + positionWidth / 2, y)

        currentX += positionWidth - S.borderWidth

        if (isHovered) {
          // 3. Close button (only show on hover)
          const closeSize = S.mainLine.closeButton.size
          const closePadding = S.mainLine.closeButton.padding
          const closeWidth = closeSize + closePadding * 2

          // Draw close button background (hover时颜色变深)
          drawRoundedRect(ctx, currentX, badgeY, closeWidth, S.height, {
            tl: 0,
            tr: 0,
            br: 0,
            bl: 0,
          })
          ctx.fillStyle = isCloseHovered ? hoverBgColor : badgeBgColor
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // Draw close icon (X)
          drawCloseIcon(ctx, currentX + closeWidth / 2, y, closeSize, color)

          currentX += closeWidth - S.borderWidth

          // 按钮间距
          currentX += BUTTON_GAP

          // 4. TPSL button: "止盈止损" with drag handle
          const tpslText = ''
          const tpslTextWidth = ctx.measureText(tpslText).width
          const tpslWidth = tpslTextWidth + S.mainLine.tpslButton.paddingX * 2
          const dragHandleWidth =
            S.mainLine.tpslButton.dragHandleWidth + DRAG_HANDLE_PADDING * 2

          // Draw tpsl button background
          drawRoundedRect(
            ctx,
            currentX,
            badgeY,
            tpslWidth + dragHandleWidth,
            S.height,
            {
              tl: 0,
              tr: 2,
              br: 2,
              bl: 0,
            },
          )
          ctx.fillStyle = isTPSLHovered ? hoverBgColor : bgColor
          ctx.fill()

          // 绘制实线边框
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // Draw tpsl text
          ctx.fillStyle = color
          ctx.textAlign = 'center'
          ctx.fillText(tpslText, currentX + tpslWidth / 2, y)

          // Draw vertical separator line between text and drag handle
          ctx.beginPath()
          ctx.moveTo(currentX + tpslWidth, badgeY)
          ctx.lineTo(currentX + tpslWidth, badgeY + S.height)
          ctx.strokeStyle = color
          ctx.lineWidth = S.borderWidth
          ctx.stroke()

          // 5. Drag handle (拖拽手柄)
          const handleX = currentX + tpslWidth
          drawDragHandle(ctx, handleX + dragHandleWidth / 2, y, color)
        }
      }

      // Price label on the right (Y-axis area will handle this)

      ctx.restore()
    },
    checkEventOn: (
      coordinate: { x: number; y: number },
      attrs: TPSLMainLineAttrs,
    ) => {
      const { x, y, width } = attrs
      const halfHeight = S.height / 2
      return (
        coordinate.x >= x &&
        coordinate.x <= width &&
        coordinate.y >= y - halfHeight &&
        coordinate.y <= y + halfHeight
      )
    },
  })
}
