'use client'

import Script from 'next/script'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type OneSignalInitOptions = {
  appId: string
  serviceWorkerPath?: string
  notifyButton?: { enable: boolean }
}

type OneSignalApi = {
  init: (options: OneSignalInitOptions) => Promise<void>
  Notifications: { requestPermission: () => Promise<void>; permission: boolean }
  User: {
    PushSubscription: {
      optedIn: boolean
      id?: string
      addEventListener?: (event: string, listener: (event: { current?: { id?: string; optedIn?: boolean } }) => void) => void
    }
    onesignalId?: string
  }
}

declare global {
  interface Window {
    OneSignalDeferred?: ((callback: (oneSignal: OneSignalApi) => void) => void)[]
    __futoOneSignalInitialized?: boolean
  }
}

const OneSignalContext = createContext<{ supported: boolean; enabled: boolean; request: () => Promise<boolean> }>({
  supported: false,
  enabled: false,
  request: async () => false,
})

const CANONICAL_ORIGIN = 'https://futocentral.name.ng'

export function OneSignalProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = useState<OneSignalApi | null>(null)
  const [supported, setSupported] = useState(false)
  const [shouldLoadSdk, setShouldLoadSdk] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const canUsePush = Boolean(
      process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID &&
      window.location.origin === CANONICAL_ORIGIN &&
      'Notification' in window &&
      'serviceWorker' in navigator,
    )
    setSupported(canUsePush)
  }, [])

  const request = useCallback(async () => {
    if (!supported || loading) return Boolean(api?.User.PushSubscription.optedIn)
    if (api) {
      try {
        await api.Notifications.requestPermission()
        return Boolean(api.User.PushSubscription.optedIn)
      } catch {
        return false
      }
    }

    const publicAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
    if (!publicAppId) return false

    setLoading(true)
    setShouldLoadSdk(true)
    window.OneSignalDeferred = window.OneSignalDeferred || []

    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        setLoading(false)
        resolve(false)
      }, 10000)
      window.OneSignalDeferred.push(async (oneSignal: OneSignalApi) => {
        window.clearTimeout(timeout)
        try {
          if (!window.__futoOneSignalInitialized) {
            await oneSignal.init({ appId: publicAppId, notifyButton: { enable: false }, serviceWorkerPath: '/OneSignalSDKWorker.js' })
            window.__futoOneSignalInitialized = true
          }
          oneSignal.User.PushSubscription.addEventListener?.('change', (event) => {
            const subscriptionId = event.current?.id
            if (subscriptionId) void fetch('/api/notifications/onesignal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscriptionId, userId: oneSignal.User.onesignalId, enabled: Boolean(event.current?.optedIn) }),
            }).catch(() => undefined)
          })
          await oneSignal.Notifications.requestPermission()
          setApi(oneSignal)
          resolve(Boolean(oneSignal.User.PushSubscription.optedIn))
        } catch {
          window.__futoOneSignalInitialized = false
          resolve(false)
        } finally {
          setLoading(false)
        }
      })
    })
  }, [api, loading, supported])

  const value = useMemo(() => ({ supported, enabled: Boolean(api?.User.PushSubscription.optedIn), request }), [supported, api, request])

  return (
    <OneSignalContext.Provider value={value}>
      {children}
      {shouldLoadSdk && <Script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" strategy="afterInteractive" />}
    </OneSignalContext.Provider>
  )
}

export const useOneSignal = () => useContext(OneSignalContext)
