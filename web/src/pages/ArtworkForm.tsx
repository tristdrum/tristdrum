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

      // Upload artwork file if new one selected
      if (artworkFile) {
        const artworkPath = `${artwork?.id || 'new'}-artwork-${Date.now()}.${artworkFile.name.split('.').pop()}`
        artworkUrl = await uploadFile(artworkFile, artworkPath)
        if (!artworkUrl) {
          throw new Error('Failed to upload artwork')
        }
      }

      // Upload audio file if new one selected
      if (audioFile) {
        const audioPath = `${artwork?.id || 'new'}-audio-${Date.now()}.${audioFile.name.split('.').pop()}`
        audioUrl = await uploadFile(audioFile, audioPath)
        if (!audioUrl) {
          throw new Error('Failed to upload audio')
        }
      }

      // Save artwork record
      const artworkData = {
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        description: description.trim() || null,
        artwork_url: artworkUrl,
        audio_url: audioUrl,
      }

      if (artwork) {
        // Update existing
        const { error } = await supabase
          .from('artworks')
          .update(artworkData)
          .eq('id', artwork.id)

        if (error) throw error
      } else {
        // Create new
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '2rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          color: '#000000',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, color: '#000000' }}>{artwork ? 'Edit Artwork' : 'New Artwork'}</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#000000' }}>
              Title <span style={{ color: 'red' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem',
                backgroundColor: '#ffffff',
                color: '#000000',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#000000' }}>
              Subtitle
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem',
                backgroundColor: '#ffffff',
                color: '#000000',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#000000' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '1rem',
                fontFamily: 'inherit',
                backgroundColor: '#ffffff',
                color: '#000000',
              }}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#000000' }}>
              Artwork Image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleArtworkFileChange}
              style={{ width: '100%' }}
            />
            {artworkPreview && (
              <img
                src={artworkPreview}
                alt="Preview"
                style={{
                  marginTop: '1rem',
                  maxWidth: '100%',
                  maxHeight: '300px',
                  borderRadius: '4px',
                }}
              />
            )}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#000000' }}>
              Audio File (optional)
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={handleAudioFileChange}
              style={{ width: '100%' }}
            />
            {audioPreview && (
              <audio
                controls
                src={audioPreview}
                style={{ marginTop: '1rem', width: '100%' }}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: saving ? 'not-allowed' : 'pointer',
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

