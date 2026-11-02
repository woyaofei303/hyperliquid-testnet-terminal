import type { FormatDateParams, Period } from 'klinecharts'

const SECOND_PERIOD_CROSSHAIR_TEMPLATE = 'YYYY-MM-DD HH:mm:ss'

type DateToken = 'YYYY' | 'MM' | 'DD' | 'HH' | 'mm' | 'ss'

function formatDateByTemplate(
  dateTimeFormat: Intl.DateTimeFormat,
  timestamp: number,
  template: string,
): string {
  const date = {} as Record<DateToken, string>

  dateTimeFormat
    .formatToParts(new Date(timestamp))
    .forEach(({ type, value }) => {
      switch (type) {
        case 'year':
          date.YYYY = value
          break
        case 'month':
          date.MM = value
          break
        case 'day':
          date.DD = value
          break
        case 'hour':
          date.HH = value === '24' ? '00' : value
          break
        case 'minute':
          date.mm = value
          break
        case 'second':
          date.ss = value
          break
        default:
          break
      }
    })

  return template.replace(
    /YYYY|MM|DD|HH|mm|ss/g,
    (token) => date[token as DateToken],
  )
}

export function formatBaseKlineDate(
  params: FormatDateParams,
  period: Period | null,
): string {
  const template =
    params.type === 'crosshair' &&
    period?.type === 'second' &&
    period.span === 1
      ? SECOND_PERIOD_CROSSHAIR_TEMPLATE
      : params.template

  return formatDateByTemplate(params.dateTimeFormat, params.timestamp, template)
}
