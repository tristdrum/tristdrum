import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { supabase, type Artwork } from '../lib/supabase'
import './PublicSite.css'

type ArtworkState =
  | { status: 'loading' | 'missing' | 'error' }
  | { status: 'ready'; artwork: Artwork }

export default function PublicArtwork() {
  const { id } = useParams<{ id: string }>()
  const [state, setState] = useState<ArtworkState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [audioFailed, setAudioFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    setAudioFailed(false)
    setImageFailed(false)

    async function loadArtwork() {
      if (!id) {
        setState({ status: 'missing' })
        return
      }
      try {
        const { data, error } = await supabase
          .from('artworks')
          .select('*')
          .eq('id', id)
          .single()
        if (!active) return
        if (
          error?.code === 'PGRST116' ||
          error?.code === '22P02' ||
          (!error && !data)
        ) {
          setState({ status: 'missing' })
        } else if (error) {
          setState({ status: 'error' })
        } else if (data) {
          setState({ status: 'ready', artwork: data })
        }
      } catch {
        if (active) setState({ status: 'error' })
      }
    }

    void loadArtwork()
    return () => {
      active = false
    }
  }, [id, attempt])

  const artwork = state.status === 'ready' ? state.artwork : null

  return (
    <div className="public-site public-artwork">
      <title>
        {artwork ? `${artwork.title} — Artwork` : 'Artwork — Tristan Drummond'}
      </title>
      <a className="public-skip" href="#artwork">
        Skip to artwork
      </a>
      <header className="folio-nav folio-width">
        <Link className="folio-name" to="/">
          Tristan Drummond<span aria-hidden="true">.</span>
        </Link>
        <Link className="folio-text-link" to="/">
          <ArrowLeft aria-hidden="true" size={18} /> Back to the website
        </Link>
      </header>
      <main id="artwork" className="artwork-content">
        {state.status === 'loading' && (
          <div className="artwork-state" role="status">
            <h1>Loading artwork…</h1>
            <p>The artwork will appear here shortly.</p>
          </div>
        )}
        {state.status === 'missing' && (
          <div className="artwork-state">
            <h1>Artwork not found.</h1>
            <p>
              This link doesn’t lead to an available artwork. Check the address
              or return to the website.
            </p>
            <Link className="folio-text-link" to="/">
              Return to the website <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        )}
        {state.status === 'error' && (
          <div className="artwork-state" role="alert">
            <h1>The artwork couldn’t load.</h1>
            <p>There was a problem connecting. Please try again.</p>
            <button
              className="folio-action"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
        )}
        {artwork && (
          <article>
            <header>
              <h1>{artwork.title}</h1>
              {artwork.subtitle && (
                <p className="artwork-subtitle">{artwork.subtitle}</p>
              )}
            </header>
            {artwork.description && (
              <p className="artwork-description">{artwork.description}</p>
            )}
            {artwork.artwork_url && (
              <figure className="artwork-picture">
                {imageFailed ? (
                  <p role="status">
                    The image couldn’t load.{' '}
                    <a href={artwork.artwork_url}>Open the image directly</a>.
                  </p>
                ) : (
                  <img
                    src={artwork.artwork_url}
                    alt={artwork.title}
                    onError={() => setImageFailed(true)}
                  />
                )}
              </figure>
            )}
            {artwork.audio_url && (
              <div className="artwork-audio">
                <p className="artwork-audio-label">
                  Listen to the accompanying audio
                </p>
                <audio
                  id="artwork-audio"
                  key={artwork.audio_url}
                  src={artwork.audio_url}
                  controls
                  preload="metadata"
                  aria-label={`Audio accompanying ${artwork.title}`}
                  onError={() => setAudioFailed(true)}
                >
                  Your browser doesn’t support this audio player.
                </audio>
                {audioFailed && (
                  <p role="status">
                    The audio couldn’t load in this player.{' '}
                    <a href={artwork.audio_url}>Open the audio file directly</a>
                    .
                  </p>
                )}
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  )
}
