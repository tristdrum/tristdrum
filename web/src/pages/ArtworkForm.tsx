import { useState, useEffect } from 'react'
import { supabase, type Artwork } from '../lib/supabase'

interface ArtworkFormProps {
  artwork: Artwork | null
  onClose: () => void
}

function ArtworkForm({ artwork, onClose }: ArtworkFormProps) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [description, setDescription] = useState('')
  const [artworkFile, setArtworkFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null)
  const [audioPreview, setAudioPreview] = useState<string | null>(null)

  useEffect(() => {
    if (artwork) {
      setTitle(artwork.title)
      setSubtitle(artwork.subtitle || '')
      setDescription(artwork.description || '')
      setArtworkPreview(artwork.artwork_url)
      setAudioPreview(artwork.audio_url)
    }
  }, [artwork])

  const handleArtworkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setArtworkFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setArtworkPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAudioFile(file)
      setAudioPreview(URL.createObjectURL(file))
    }
  }

  const uploadFile = async (file: File, path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from('artwork-files')
      .upload(path, file, { upsert: true })

    if (error) {
      console.error('Upload error:', error)
      return null
    }

    const { data: urlData } = supabase.storage
      .from('artwork-files')
      .getPublicUrl(data.path)

    return urlData.publicUrl
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      alert('Title is required')
      return
    }

    setSaving(true)

    try {
      let artworkUrl = artworkPreview
      let audioUrl = audioPreview

      if (artworkFile) {
        const artworkPath = `${artwork?.id || 'new'}-artwork-${Date.now()}.${artworkFile.name.split('.').pop()}`
        artworkUrl = await uploadFile(artworkFile, artworkPath)
        if (!artworkUrl) {
          throw new Error('Failed to upload artwork')
        }
      }

      if (audioFile) {
        const audioPath = `${artwork?.id || 'new'}-audio-${Date.now()}.${audioFile.name.split('.').pop()}`
        audioUrl = await uploadFile(audioFile, audioPath)
        if (!audioUrl) {
          throw new Error('Failed to upload audio')
        }
      }

      const artworkData = {
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        description: description.trim() || null,
        artwork_url: artworkUrl,
        audio_url: audioUrl,
      }

      if (artwork) {
        const { error } = await supabase
          .from('artworks')
          .update(artworkData)
          .eq('id', artwork.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('artworks').insert(artworkData)
        if (error) throw error
      }

      alert(artwork ? 'Artwork updated successfully!' : 'Artwork created successfully!')
      onClose()
    } catch (error) {
      console.error('Error saving artwork:', error)
      alert('Failed to save artwork. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '2rem',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '0',
          padding: '3rem',
          maxWidth: '700px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          color: '#1a1a1a',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ 
          marginTop: 0, 
          marginBottom: '2.5rem',
          fontSize: '1.5rem',
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: '#1a1a1a',
        }}>
          {artwork ? 'Edit Artwork' : 'New Artwork'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '2rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: 400,
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#1a1a1a',
            }}>
              Title <span style={{ color: '#999' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem 0',
                border: 'none',
                borderBottom: '1px solid #e8e8e8',
                borderRadius: '0',
                fontSize: '1rem',
                backgroundColor: 'transparent',
                color: '#1a1a1a',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s ease',
                outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor = '#1a1a1a'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = '#e8e8e8'
              }}
            />
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: 400,
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#1a1a1a',
            }}>
              Subtitle
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 0',
                border: 'none',
                borderBottom: '1px solid #e8e8e8',
                borderRadius: '0',
                fontSize: '1rem',
                backgroundColor: 'transparent',
                color: '#1a1a1a',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s ease',
                outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor = '#1a1a1a'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = '#e8e8e8'
              }}
            />
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: 400,
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#1a1a1a',
            }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                padding: '0.75rem 0',
                border: 'none',
                borderBottom: '1px solid #e8e8e8',
                borderRadius: '0',
                fontSize: '1rem',
                fontFamily: 'inherit',
                backgroundColor: 'transparent',
                color: '#1a1a1a',
                resize: 'vertical',
                transition: 'border-color 0.2s ease',
                outline: 'none',
                lineHeight: '1.6',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor = '#1a1a1a'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = '#e8e8e8'
              }}
            />
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: 400,
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#1a1a1a',
            }}>
              Artwork Image
              <span style={{ 
                fontSize: '0.75rem',
                fontWeight: 300,
                textTransform: 'none',
                letterSpacing: '0',
                color: '#999',
                marginLeft: '0.5rem',
              }}>(optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleArtworkFileChange}
              style={{ 
                width: '100%',
                fontSize: '0.875rem',
                padding: '0.5rem 0',
                cursor: 'pointer',
              }}
            />
            {artworkPreview && (
              <div style={{ marginTop: '1.5rem' }}>
                <img
                  src={artworkPreview}
                  alt="Preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '400px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            )}
          </div>

          <div style={{ marginBottom: '2.5rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: 400,
              fontSize: '0.875rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#1a1a1a',
            }}>
              Audio File
              <span style={{ 
                fontSize: '0.75rem',
                fontWeight: 300,
                textTransform: 'none',
                letterSpacing: '0',
                color: '#999',
                marginLeft: '0.5rem',
              }}>(optional)</span>
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleAudioFileChange}
              style={{ 
                width: '100%',
                fontSize: '0.875rem',
                padding: '0.5rem 0',
                cursor: 'pointer',
              }}
            />
            {audioPreview && (
              <div style={{ marginTop: '1.5rem' }}>
                <audio
                  controls
                  src={audioPreview}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e8e8e8' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: 'transparent',
                color: '#666',
                border: '1px solid #e8e8e8',
                borderRadius: '2px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 400,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!saving) {
                  e.currentTarget.style.borderColor = '#1a1a1a'
                  e.currentTarget.style.color = '#1a1a1a'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e8e8e8'
                e.currentTarget.style.color = '#666'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#1a1a1a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '2px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 400,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                transition: 'all 0.2s ease',
                opacity: saving ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!saving) {
                  e.currentTarget.style.backgroundColor = '#333'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1a1a1a'
              }}
            >
              {saving ? 'Saving...' : artwork ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ArtworkForm
