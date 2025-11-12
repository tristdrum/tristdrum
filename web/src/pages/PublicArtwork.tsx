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
          backgroundColor: '#ffffff',
          color: '#000000',
        }}
      >
        <p>Loading artwork...</p>
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
          backgroundColor: '#ffffff',
          color: '#000000',
        }}
      >
        <div>
          <h1 style={{ color: '#000000' }}>Artwork Not Found</h1>
          <p style={{ color: '#000000' }}>The artwork you're looking for doesn't exist or has been removed.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '2rem',
        maxWidth: '900px',
        margin: '0 auto',
        backgroundColor: '#ffffff',
        color: '#000000',
      }}
    >
      <article>
        {artwork.artwork_url && (
          <div style={{ marginBottom: '2rem' }}>
            <img
              src={artwork.artwork_url}
              alt={artwork.title}
              style={{
                width: '100%',
                height: 'auto',
                borderRadius: '8px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              }}
            />
          </div>
        )}

        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ marginBottom: '0.5rem', fontSize: '2.5rem', color: '#000000' }}>{artwork.title}</h1>
          {artwork.subtitle && (
            <h2 style={{ marginTop: 0, fontSize: '1.5rem', color: '#666', fontWeight: 'normal' }}>
              {artwork.subtitle}
            </h2>
          )}
        </header>

        {artwork.description && (
          <div
            style={{
              marginBottom: '2rem',
              fontSize: '1.1rem',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              color: '#000000',
            }}
          >
            {artwork.description}
          </div>
        )}

        {artwork.audio_url && (
          <div style={{ marginTop: '2rem' }}>
            <audio controls style={{ width: '100%' }} src={artwork.audio_url} />
          </div>
        )}
      </article>
    </div>
  )
}

export default PublicArtwork

