'use client'

import { useEffect, useRef } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

type VideoJsPlayerProps = { src: string; poster?: string; onError?: () => void }

export function VideoJsPlayer({ src, poster, onError }: VideoJsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)

  useEffect(() => {
    if (!videoRef.current) return
    const player = videojs(videoRef.current, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: 'metadata',
      poster,
      sources: [{ src, type: 'video/mp4' }],
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      controlBar: { pictureInPictureToggle: true },
    })
    playerRef.current = player
    player.on('error', () => onError?.())
    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) playerRef.current.dispose()
      playerRef.current = null
    }
  }, [onError])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.poster(poster || '')
    player.src({ src, type: 'video/mp4' })
    player.load()
  }, [src, poster])

  return <div className="video-js-shell"><video ref={videoRef} className="video-js vjs-big-play-centered" playsInline /></div>
}
