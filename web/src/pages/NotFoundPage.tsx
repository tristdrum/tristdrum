import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import './PublicSite.css'

export default function NotFoundPage() {
  return (
    <div className="public-site">
      <title>Page not found — Tristan Drummond</title>
      <header className="folio-nav folio-width">
        <Link className="folio-name" to="/">
          Tristan Drummond<span aria-hidden="true">.</span>
        </Link>
      </header>
      <main className="artwork-content artwork-state">
        <h1>That page isn’t here.</h1>
        <p>
          The address may have changed. You can find my work and contact details
          on the homepage.
        </p>
        <Link className="folio-action" to="/">
          <ArrowLeft aria-hidden="true" size={18} /> Back to the homepage
        </Link>
      </main>
    </div>
  )
}
