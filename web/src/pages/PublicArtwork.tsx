import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, type Artwork } from '../lib/supabase'

function PublicArtwork() {
  const { id } = useParams<{ id: string }>()
  const [artwork, setArtwork] = useState<Artwork | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

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
        padding: '4rem 2rem',
        maxWidth: '1000px',
        margin: '0 auto',
        backgroundColor: '#fafafa',
        color: '#1a1a1a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <article>
        <header style={{ marginBottom: '3rem' }}>
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
          <div style={{ 
            marginBottom: '3rem',
          }}>
            <audio 
              controls 
              style={{ 
                width: '100%',
                maxWidth: '600px',
              }} 
              src={artwork.audio_url} 
            />
          </div>
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
  )
}

export default PublicArtwork
