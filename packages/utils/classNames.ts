import {
  type Config,
  createTailwindMerge,
  getDefaultConfig,
} from 'tailwind-merge'

const config = getDefaultConfig()

const isFontSize = (value: string) => {
  const validSizes = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'h-l',
    'h-xl',
    'h-xxl',
    'subtitle',
    'body-regular',
    'body-s',
    'body-xs',
    'body-xxs',
  ]
  return validSizes.includes(value)
}

// @ts-expect-error 自定义配置
export const customConfig: Config = {
  ...config,
  classGroups: {
    ...config.classGroups,
    'font-size': [...config.classGroups['font-size'], { text: [isFontSize] }],
  },
}

const cn = createTailwindMerge(() => customConfig)
const classNames = cn

export { classNames, cn }
