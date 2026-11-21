'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A small "i" control that sits at the bottom-left of an imported story and
 * names the publisher it came from. No link, no URL: the source address is
 * never exposed on a public page.
 */
export function SourceNote({ sourceName }: { sourceName: string }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="source-note" ref={wrapper}>
      <button
        type="button"
        className="source-note-button"
        aria-label="Source information"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        i
      </button>
      {open ? <div className="source-note-popover">Sourced from {sourceName}</div> : null}
    </div>
  )
}
