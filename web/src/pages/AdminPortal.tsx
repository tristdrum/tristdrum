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
      canvas.width = img.width
      canvas.height = img.height
      
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        
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

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    img.src = url
  }

  if (loading) {
    return (
      <div style={{ 
        padding: '4rem 2rem', 
        textAlign: 'center',
        backgroundColor: '#fafafa',
        minHeight: '100vh',
        color: '#1a1a1a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <p style={{ fontSize: '0.95rem', letterSpacing: '0.02em', color: '#666' }}>Loading artworks...</p>
      </div>
    )
  }

  return (
    <div style={{ 
      padding: '4rem 2rem', 
      maxWidth: '1400px', 
      margin: '0 auto',
      backgroundColor: '#fafafa',
      minHeight: '100vh',
      color: '#1a1a1a',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    }}>
      <div style={{ marginBottom: '4rem' }}>
        <h1 style={{ 
          fontSize: '2.5rem', 
          fontWeight: 300,
          letterSpacing: '-0.02em',
          margin: '0 0 0.5rem 0',
          color: '#1a1a1a',
        }}>
          Artwork Management
        </h1>
        <p style={{ 
          fontSize: '0.95rem', 
          color: '#666',
          letterSpacing: '0.01em',
          margin: 0,
        }}>
          Manage your collection
        </p>
      </div>

      <button
        onClick={() => {
          setEditingArtwork(null)
          setShowForm(true)
        }}
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: '#1a1a1a',
          color: '#ffffff',
          border: 'none',
          borderRadius: '2px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 400,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          transition: 'all 0.2s ease',
          marginBottom: '3rem',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#333'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '#1a1a1a'
        }}
      >
        Add New Artwork
      </button>

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
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '2rem',
            backdropFilter: 'blur(8px)',
          }}
          onClick={handleCloseQRModal}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '0',
              padding: '3rem',
              maxWidth: '420px',
              width: '100%',
              color: '#1a1a1a',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ 
              marginTop: 0, 
              marginBottom: '2rem',
              fontSize: '1.25rem',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: '#1a1a1a',
            }}>
              {selectedArtwork.title}
            </h2>
            <div
              ref={qrRef}
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '1.5rem',
                backgroundColor: '#ffffff',
                marginBottom: '2rem',
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
                  padding: '0.75rem 1.5rem',
                  backgroundColor: 'transparent',
                  color: '#666',
                  border: '1px solid #ddd',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 400,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#1a1a1a'
                  e.currentTarget.style.color = '#1a1a1a'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#ddd'
                  e.currentTarget.style.color = '#666'
                }}
              >
                Close
              </button>
              <button
                onClick={handleDownloadQR}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 400,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#333'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#1a1a1a'
                }}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {artworks.length === 0 ? (
        <div style={{ 
          padding: '6rem 2rem',
          textAlign: 'center',
        }}>
          <p style={{ 
            fontSize: '0.95rem', 
            color: '#666',
            letterSpacing: '0.01em',
          }}>
            No artworks yet. Click "Add New Artwork" to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {artworks.map((artwork) => (
            <div
              key={artwork.id}
              style={{
                backgroundColor: '#ffffff',
                padding: '2rem',
                border: '1px solid #e8e8e8',
                transition: 'all 0.2s ease',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '2rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#d0d0d0'
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e8e8e8'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{ flex: 1 }}>
                <h3 style={{ 
                  margin: '0 0 0.5rem 0',
                  fontSize: '1.25rem',
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                  color: '#1a1a1a',
                }}>
                  {artwork.title}
                </h3>
                {artwork.subtitle && (
                  <p style={{ 
                    margin: '0 0 0.75rem 0',
                    fontSize: '0.9rem',
                    color: '#666',
                    letterSpacing: '0.01em',
                  }}>
                    {artwork.subtitle}
                  </p>
                )}
                <p style={{ 
                  margin: 0,
                  fontSize: '0.8rem',
                  color: '#999',
                  letterSpacing: '0.02em',
                }}>
                  {artwork.created_at
                    ? new Date(artwork.created_at).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })
                    : '—'}
                </p>
              </div>
              <div style={{ 
                display: 'flex', 
                gap: '0.5rem',
                flexWrap: 'wrap',
              }}>
                {[
                  { label: 'Link', onClick: () => handleViewLink(artwork), defaultColor: '#666' },
                  { label: 'QR', onClick: () => handleViewQR(artwork), defaultColor: '#666' },
                  { label: 'Edit', onClick: () => handleEdit(artwork), defaultColor: '#666' },
                  { label: 'Delete', onClick: () => handleDelete(artwork.id), defaultColor: '#999' },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    onClick={btn.onClick}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: 'transparent',
                      color: btn.defaultColor,
                      border: '1px solid #e8e8e8',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 400,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (btn.label === 'Delete') {
                        e.currentTarget.style.borderColor = '#dc3545'
                        e.currentTarget.style.color = '#dc3545'
                      } else {
                        e.currentTarget.style.borderColor = '#1a1a1a'
                        e.currentTarget.style.color = '#1a1a1a'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e8e8e8'
                      e.currentTarget.style.color = btn.defaultColor
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AdminPortal
