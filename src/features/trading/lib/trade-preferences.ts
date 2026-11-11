import { createStoredBoolean } from '../../../../packages/utils/storage.ts'

export const tradePreferences = {
  skipOrder: createStoredBoolean('hl-skip-order-confirm', false),
  skipClose: createStoredBoolean('hl-skip-close-confirm', false),
}
