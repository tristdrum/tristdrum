import { useState, useEffect, useRef } from 'react'
import { supabase, type Artwork } from '../lib/supabase'
import ArtworkForm from './ArtworkForm'
import { QRCodeSVG } from 'qrcode.react'

function AdminPortal() {
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [loading, setLoading] = useState(true)
  const [editingArtwork, setEditingArtwork] = useState<Artwork | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null)
  const qrRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadArtworks()
  }, [])

  const loadArtworks = async () => {
    try {
      const { data, error } = await supabase
        .from('artworks')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setArtworks(data || [])
    } catch (error) {
      console.error('Error loading artworks:', error)
      alert('Failed to load artworks')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (artwork: Artwork) => {
    setEditingArtwork(artwork)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this artwork?')) return

    try {
      const { error } = await supabase.from('artworks').delete().eq('id', id)
      if (error) throw error
      await loadArtworks()
    } catch (error) {
      console.error('Error deleting artwork:', error)
      alert('Failed to delete artwork')
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingArtwork(null)
    loadArtworks()
  }

  const getArtworkUrl = (artworkId: string) => {
    return `${window.location.origin}/artwork/${artworkId}`
  }

  const handleViewLink = (artwork: Artwork) => {
    const url = getArtworkUrl(artwork.id)
    navigator.clipboard.writeText(url).then(() => {
      alert(`Link copied to clipboard: ${url}`)
    }).catch(() => {
      prompt('Copy this link:', url)
    })
  }

  const handleViewQR = (artwork: Artwork) => {
    setSelectedArtwork(artwork)
    setShowQRModal(true)
  }

  const handleCloseQRModal = () => {
    setShowQRModal(false)
    setSelectedArtwork(null)
  }

  const handleDownloadQR = () => {
    if (!selectedArtwork || !qrRef.current) return

    const svg = qrRef.current.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width
      canvas.height = img.height
      
      if (ctx) {
        // Fill white background
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        // Draw the SVG image
        ctx.drawImage(img, 0, 0)
        
        // Convert to blob and download
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            const sanitizedTitle = selectedArtwork.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()
            link.download = `${sanitizedTitle}_qr.png`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }
        }, 'image/png')
      }
    }

    img.onerror = () => {
      alert('Failed to generate QR code image. Please try again.')
    }

    // Create blob URL from SVG and load it as image
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    img.src = url
  }

  if (loading) {
    return (
      <div style={{ 
        padding: '2rem', 
        textAlign: 'center',
        backgroundColor: '#ffffff',
        minHeight: '100vh',
        color: '#000000'
      }}>
        <p>Loading artworks...</p>
      </div>
    )
  }

  return (
    <div style={{ 
      padding: '2rem', 
      maxWidth: '1200px', 
      margin: '0 auto',
      backgroundColor: '#ffffff',
      minHeight: '100vh',
      color: '#000000'
    }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#000000', margin: 0 }}>Artwork Management</h1>
        <button
          onClick={() => {
            setEditingArtwork(null)
            setShowForm(true)
          }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Add New Artwork
        </button>
      </div>

      {showForm && (
        <ArtworkForm artwork={editingArtwork} onClose={handleFormClose} />
      )}

      {showQRModal && selectedArtwork && (
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
          onClick={handleCloseQRModal}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '2rem',
              maxWidth: '400px',
              width: '100%',
              color: '#000000',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, color: '#000000', marginBottom: '1rem' }}>
              QR Code: {selectedArtwork.title}
            </h2>
            <div
              ref={qrRef}
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '1rem',
                backgroundColor: '#ffffff',
                borderRadius: '4px',
                marginBottom: '1rem',
              }}
            >
              <QRCodeSVG
                value={getArtworkUrl(selectedArtwork.id)}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCloseQRModal}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                onClick={handleDownloadQR}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {artworks.length === 0 ? (
        <p style={{ color: '#000000' }}>No artworks yet. Click "Add New Artwork" to get started.</p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            backgroundColor: 'white',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa' }}>
              <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '2px solid #dee2e6', color: '#000000' }}>Title</th>
              <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '2px solid #dee2e6', color: '#000000' }}>Subtitle</th>
              <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '2px solid #dee2e6', color: '#000000' }}>Created</th>
              <th style={{ padding: '1rem', textAlign: 'right', borderBottom: '2px solid #dee2e6', color: '#000000' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {artworks.map((artwork) => (
              <tr key={artwork.id} style={{ borderBottom: '1px solid #dee2e6', backgroundColor: '#ffffff' }}>
                <td style={{ padding: '1rem', color: '#000000' }}>{artwork.title}</td>
                <td style={{ padding: '1rem', color: '#000000' }}>{artwork.subtitle || '-'}</td>
                <td style={{ padding: '1rem', color: '#000000' }}>
                  {new Date(artwork.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>
                  <button
                    onClick={() => handleViewLink(artwork)}
                    style={{
                      marginRight: '0.5rem',
                      padding: '0.25rem 0.75rem',
                      backgroundColor: '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    View Link
                  </button>
                  <button
                    onClick={() => handleViewQR(artwork)}
                    style={{
                      marginRight: '0.5rem',
                      padding: '0.25rem 0.75rem',
                      backgroundColor: '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    View QR
                  </button>
                  <button
                    onClick={() => handleEdit(artwork)}
                    style={{
                      marginRight: '0.5rem',
                      padding: '0.25rem 0.75rem',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(artwork.id)}
                    style={{
                      padding: '0.25rem 0.75rem',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default AdminPortal

