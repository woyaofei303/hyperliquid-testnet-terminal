'use client'

import { classNames } from '@fameex/utils'
import {
  Modal as BaseModal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react'
import { useReducedMotion } from 'framer-motion'
import { type ReactNode, useId } from 'react'

// Adapted from FameEX apps/web/src/components/Modal.tsx: 480px / 16px / fixed header and footer.
export function Modal({
  title,
  children,
  footer,
  onClose,
  busy = false,
  closeLabel = '关闭',
  className,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  busy?: boolean
  closeLabel?: string
  className?: string
}) {
  const reducedMotion = useReducedMotion()
  const closeId = useId()
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      placement="center"
      scrollBehavior="inside"
      backdrop="opaque"
      isDismissable={false}
      isKeyboardDismissDisabled={busy}
      hideCloseButton={busy}
      disableAnimation={!!reducedMotion}
      classNames={{
        wrapper: 'z-[1100]',
        backdrop: 'z-[1100] bg-black/55',
        base: 'mx-3 my-3 sm:mx-3 sm:my-3 w-[calc(100%-24px)]',
        closeButton:
          'right-4 top-4 flex size-6 items-center justify-center rounded-[4px] p-0 text-muted hover:bg-transparent hover:text-ink',
      }}
      closeButton={
        <button type="button" aria-labelledby={closeId}>
          <span id={closeId} className="sr-only">
            {closeLabel}
          </span>
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M17.2428 5.34314L18.657 6.75735L13.4143 12L18.657 17.2426L17.2428 18.6568L12.0001 13.4142L6.75748 18.6568L5.34326 17.2426L10.5859 12L5.34326 6.75735L6.75748 5.34314L12.0001 10.5858L17.2428 5.34314Z"
            />
          </svg>
        </button>
      }
      motionProps={{
        variants: {
          enter: {
            y: 0,
            opacity: 1,
            transition: { duration: 0.3, ease: 'easeOut' },
          },
          exit: {
            y: -20,
            opacity: 0,
            transition: { duration: 0.2, ease: 'easeIn' },
          },
        },
      }}
    >
      <ModalContent
        className={classNames(
          'max-h-[min(680px,calc(100dvh-24px))] max-w-[480px] overflow-hidden rounded-[16px] border border-edge bg-surface text-ink shadow-2xl',
          className,
        )}
      >
        <ModalHeader className="block px-5 pb-3 pt-5 pr-12 text-lg font-semibold md:px-6 md:pr-12">
          <h2>{title}</h2>
        </ModalHeader>
        <ModalBody className="min-h-0 gap-4 px-5 pb-6 pt-1 md:px-6 [&>*]:shrink-0">
          {children}
        </ModalBody>
        {footer && (
          <ModalFooter className="gap-3 border-t border-edge px-5 py-4 md:px-6">
            {footer}
          </ModalFooter>
        )}
      </ModalContent>
    </BaseModal>
  )
}
