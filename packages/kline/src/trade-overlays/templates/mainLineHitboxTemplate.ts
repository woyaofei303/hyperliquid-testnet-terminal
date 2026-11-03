import type { OverlayTemplate } from 'klinecharts'
import { TPSL_MAIN_LINE_HITBOX_FIGURE, TPSL_OVERLAY_STYLES } from '../constants'
import {
  registerMainLineHitboxFigure,
  type TPSLMainLineHitboxAttrs,
} from '../figures/index'
import { getTpslOverlayId, TPSL_TEMPLATE_NAMES } from '../idFactory'
import { isEstimateLineExtendData, isTpslButtonExtendData } from '../typeGuards'
import { clamp } from '../utils'

const S = TPSL_OVERLAY_STYLES

export interface MainLineHitboxExtendData {
  /** hitbox 宽度 */
  width: number
  /** 关联的 baseId（用于拖拽状态判断） */
  baseId?: string
  /** hover 状态变化回调 */
  onHoverChange?: (hovered: boolean) => void
  /** 是否启用 mouse enter */
  enableEnter?: boolean
  /** 是否启用 mouse leave */
  enableLeave?: boolean
  /** 关联的按钮 overlay IDs（用于联动显示/隐藏） */
  buttonOverlayIds?: {
    close?: string
    tpsl?: string
    tpConnector?: string
    slConnector?: string
  }
  /** 点击主线回调 */
  onClick?: () => void
}

/**
 * 主线命中区域 Overlay Template
 * 负责捕获 hover 事件，控制关闭按钮和止盈止损按钮的显示
 */
export const mainLineHitboxTemplate: OverlayTemplate<MainLineHitboxExtendData> =
  {
    name: TPSL_TEMPLATE_NAMES.mainLineHitbox,
    fixedZLevel: true,
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length === 0) return []
      registerMainLineHitboxFigure()

      const extendData = overlay.extendData
      if (!extendData) return []
      const { width } = extendData
      const mainY = clamp(
        coordinates[0].y,
        S.height / 2,
        bounding.height - S.height / 2,
      )

      const attrs: TPSLMainLineHitboxAttrs = {
        x: 0,
        y: mainY,
        width,
        height: S.height,
      }

      return [
        {
          key: 'mainLineHitbox',
          type: TPSL_MAIN_LINE_HITBOX_FIGURE,
          attrs,
          ignoreEvent:
            extendData.enableEnter === false
              ? [
                  'onMouseMove',
                  'onPressedMoveStart',
                  'onPressedMoving',
                  'onPressedMoveEnd',
                ]
              : ['onPressedMoveStart', 'onPressedMoving', 'onPressedMoveEnd'],
        },
      ]
    },

    // hover 进入：显示关联的按钮
    onMouseEnter: (event) => {
      const { overlay, chart } = event
      if (!overlay.extendData || !overlay.id) return

      const extendData = overlay.extendData
      if (extendData.enableEnter === false) return
      extendData.onHoverChange?.(true)
      const container = chart.getDom(overlay.paneId, 'root')
      if (container) {
        container.style.cursor = 'pointer'
      }
    },

    // hover 离开：隐藏关联的按钮
    onMouseLeave: (event) => {
      const { overlay, chart } = event
      if (!overlay.extendData || !overlay.id) return

      const extendData = overlay.extendData
      if (extendData.enableLeave === false) return

      const baseId = extendData.baseId
      if (baseId) {
        const tpOverlay = chart.getOverlays({
          id: getTpslOverlayId(baseId, 'tpLine'),
        })[0]
        const slOverlay = chart.getOverlays({
          id: getTpslOverlayId(baseId, 'slLine'),
        })[0]
        const buttonIds = extendData.buttonOverlayIds
        const tpslOverlay = buttonIds?.tpsl
          ? chart.getOverlays({ id: buttonIds.tpsl })[0]
          : undefined
        const isTpDragging = isEstimateLineExtendData(tpOverlay?.extendData)
          ? Boolean(tpOverlay.extendData._isDragging)
          : false
        const isSlDragging = isEstimateLineExtendData(slOverlay?.extendData)
          ? Boolean(slOverlay.extendData._isDragging)
          : false
        const isButtonDragging = isTpslButtonExtendData(tpslOverlay?.extendData)
          ? Boolean(tpslOverlay.extendData._isDragging)
          : false
        if (isTpDragging || isSlDragging || isButtonDragging) return
      }

      extendData.onHoverChange?.(false)
    },

    onClick: (event) => {
      const { overlay } = event
      const extendData = overlay.extendData
      if (!extendData) return
      extendData.onClick?.()
    },
  }
