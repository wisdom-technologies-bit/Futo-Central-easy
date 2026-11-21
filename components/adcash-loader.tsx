// TODO: if Adcash provides an ads.txt line, add it to public/ads.txt.
'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    aclib?: {
      runAutoTag?: (options: { zoneId: string }) => void
    }
  }
}

const ZONE_ID = 'rctmmwbeou'
const SCRIPT_ID = 'aclib'
const SCRIPT_SRC = 'https://acscdn.com/script/aclib.js'
const ALLOWED_ORIGIN = 'https://futocentral.name.ng'

/** Once per page load, even if the component remounts. */
let autoTagRequested = false

/**
 * Adcash Auto Tag. It injects its own ad placements, so this renders nothing and
 * no slot containers exist anywhere in the app.
 */
export function AdcashLoader() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.origin !== ALLOWED_ORIGIN) return
    if (window.location.pathname.startsWith('/editorial')) return

    const runAutoTag = () => {
      if (autoTagRequested) return
      if (typeof window.aclib?.runAutoTag !== 'function') return
      autoTagRequested = true
      window.aclib.runAutoTag({ zoneId: ZONE_ID })
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (window.aclib) runAutoTag()
      else existing.addEventListener('load', runAutoTag, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.type = 'text/javascript'
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = runAutoTag
    script.onerror = () => {
      // Fail silently: no ad, no error surfaced to the reader.
      script.remove()
    }
    document.head.appendChild(script)
  }, [])

  return null
}
