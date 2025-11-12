import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, type Artwork } from '../lib/supabase'

function PublicArtwork() {
  const { id } = useParams<{ id: string }>()
  const [artwork, setArtwork] = useState<Artwork | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showPlayer, setShowPlayer] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (id) {
      loadArtwork(id)
    }
  }, [id])

  const loadArtwork = async (artworkId: string) => {
    try {
      const { data, error } = await supabase
        .from('artworks')
        .select('*')
        .eq('id', artworkId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          setNotFound(true)
        } else {
          throw error
        }
      } else {
        setArtwork(data)
      }
    } catch (error) {
      console.error('Error loading artwork:', error)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
        setShowPlayer(true)
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percentage = x / rect.width
    const newTime = percentage * duration
    
    if (audioRef.current && !isNaN(newTime)) {
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const x = moveEvent.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, x / rect.width))
      const newTime = percentage * duration
      
      if (audioRef.current && !isNaN(newTime)) {
        audioRef.current.currentTime = newTime
        setCurrentTime(newTime)
      }
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    handleMouseMove(e.nativeEvent)
  }

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          backgroundColor: '#fafafa',
          color: '#1a1a1a',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <p style={{ fontSize: '0.95rem', letterSpacing: '0.02em', color: '#666' }}>Loading artwork...</p>
      </div>
    )
  }

  if (notFound || !artwork) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#fafafa',
          color: '#1a1a1a',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div>
          <h1 style={{ 
            fontSize: '2rem',
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: '#1a1a1a',
            marginBottom: '0.5rem',
          }}>
            Artwork Not Found
          </h1>
          <p style={{ 
            fontSize: '0.95rem',
            color: '#666',
            letterSpacing: '0.01em',
          }}>
            The artwork you're looking for doesn't exist or has been removed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#fafafa',
        color: '#1a1a1a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        paddingBottom: showPlayer ? '120px' : '0',
      }}
    >
      <div style={{
        padding: '4rem 2rem',
        maxWidth: '1000px',
        margin: '0 auto',
      }}>
        <article>
          <header style={{ 
            marginBottom: '3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '2rem',
          }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ 
                marginBottom: '0.75rem', 
                fontSize: '3rem',
                fontWeight: 300,
                letterSpacing: '-0.03em',
                lineHeight: '1.1',
                color: '#1a1a1a',
              }}>
                {artwork.title}
              </h1>
              {artwork.subtitle && (
                <h2 style={{ 
                  marginTop: 0,
                  fontSize: '1.25rem',
                  fontWeight: 300,
                  letterSpacing: '0.01em',
                  color: '#666',
                }}>
                  {artwork.subtitle}
                </h2>
              )}
            </div>
            
            {artwork.audio_url && (
              <button
                onClick={handlePlayPause}
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: '#1a1a1a',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.backgroundColor = '#333'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.backgroundColor = '#1a1a1a'
                }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
            )}
          </header>

        {artwork.description && (
          <div
            style={{
              marginBottom: '3rem',
              fontSize: '1.125rem',
              lineHeight: '1.8',
              whiteSpace: 'pre-wrap',
              color: '#1a1a1a',
              fontWeight: 300,
              letterSpacing: '0.01em',
              maxWidth: '65ch',
            }}
          >
            {artwork.description}
          </div>
        )}

        {artwork.audio_url && (
          <audio
            ref={audioRef}
            src={artwork.audio_url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            style={{ display: 'none' }}
          />
        )}

        {artwork.artwork_url && (
          <div style={{ 
            marginBottom: '4rem',
            backgroundColor: '#ffffff',
            padding: '2rem',
            border: '1px solid #e8e8e8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img
              src={artwork.artwork_url}
              alt={artwork.title}
              style={{
                maxHeight: 'calc(100vh - 400px)',
                width: 'auto',
                height: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
        </article>
      </div>

      {/* Bottom Player */}
      {artwork.audio_url && showPlayer && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid #e8e8e8',
            padding: '1.5rem 2rem',
            boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.1)',
            transform: showPlayer ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s ease',
            zIndex: 1000,
          }}
        >
          <div style={{
            maxWidth: '1000px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            {/* Track Info and Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1.5rem',
            }}>
              {/* Play/Pause Button */}
              <button
                onClick={handlePlayPause}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: '#1a1a1a',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.25rem',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#333'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#1a1a1a'
                }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              {/* Track Title */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '1rem',
                  fontWeight: 500,
                  color: '#1a1a1a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {artwork.title}
                </div>
                {artwork.subtitle && (
                  <div style={{
                    fontSize: '0.875rem',
                    color: '#666',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {artwork.subtitle}
                  </div>
                )}
              </div>

              {/* Time Display */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem',
                color: '#666',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}>
                <span>{formatTime(currentTime)}</span>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Progress Bar - Custom Scrubber */}
            <div 
              onClick={handleSeek}
              onMouseDown={handleMouseDown}
              style={{ 
                position: 'relative', 
                height: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {/* Background Track */}
              <div style={{
                position: 'absolute',
                width: '100%',
                height: '6px',
                backgroundColor: '#e8e8e8',
                borderRadius: '3px',
              }} />
              
              {/* Progress Fill - Single Source of Truth */}
              <div style={{
                position: 'absolute',
                width: `${(currentTime / duration) * 100 || 0}%`,
                height: '6px',
                backgroundColor: '#1a1a1a',
                borderRadius: '3px',
                pointerEvents: 'none',
                transition: 'width 0.1s linear',
              }} />
              
              {/* Thumb - Uses Same Calculation */}
              <div style={{
                position: 'absolute',
                left: `${(currentTime / duration) * 100 || 0}%`,
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: '#1a1a1a',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                transition: 'transform 0.2s ease, left 0.1s linear',
              }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1)'
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PublicArtwork
