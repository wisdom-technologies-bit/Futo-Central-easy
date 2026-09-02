'use client'

import { useEffect } from 'react'

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5717691070315159'

export function AdSenseLoader() {
  useEffect(() => {
    if (window.location.origin !== 'https://futocentral.name.ng') return
    if (document.querySelector(`script[src="${ADSENSE_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = ADSENSE_SRC
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => script.remove()
    document.head.appendChild(script)
  }, [])

  return null
}
