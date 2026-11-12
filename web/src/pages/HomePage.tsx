import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react'
import './PublicSite.css'

const engineeringStory =
  'https://powersync.com/blog/developer-case-study-tristan-drummond-gideon-boshoff-workweek'

export default function HomePage() {
  return (
    <div className="public-site">
      <title>Tristan Drummond — WorkWeek CTO &amp; Tech Local co-founder</title>
      <a className="public-skip" href="#main">
        Skip to content
      </a>
      <header className="folio-nav folio-width">
        <a className="folio-name" href="/" aria-label="Tristan Drummond, home">
          Tristan Drummond<span aria-hidden="true">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a href="#contact">
            Contact <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </nav>
      </header>

      <main id="main">
        <section
          className="folio-intro folio-width"
          aria-labelledby="intro-title"
        >
          <h1 id="intro-title">
            I build software
            <br />
            around real work<span className="folio-period">.</span>
          </h1>
          <div className="folio-intro-bottom">
            <div className="folio-bio">
              <p>
                I’m Tristan, co-founder &amp; CTO of{' '}
                <a href="#workweek">WorkWeek</a> and co-founder of{' '}
                <a href="#tech-local">Tech Local</a>.
              </p>
              <p className="folio-location">
                East London, South Africa. Building for the people doing the
                work.
              </p>
            </div>
            <div className="folio-intro-actions">
              <a className="folio-action" href="mailto:tristan@workweek.africa">
                Get in touch <ArrowUpRight aria-hidden="true" size={20} />
              </a>
              <a className="folio-text-link" href="#work">
                Explore my work <ArrowDown aria-hidden="true" size={18} />
              </a>
            </div>
            <figure className="folio-portrait">
              <img
                src="/images/tristan-drummond.webp"
                alt="Tristan Drummond"
                width="640"
                height="800"
                fetchPriority="high"
              />
              <figcaption>Founder. Technologist.</figcaption>
            </figure>
          </div>
        </section>

        <section
          id="work"
          className="folio-work folio-width"
          aria-labelledby="work-title"
        >
          <div className="folio-section-title">
            <h2 id="work-title">The work</h2>
            <p>Two companies. A shared interest in making technology useful.</p>
          </div>
          <article id="workweek" className="folio-project">
            <div className="folio-project-heading">
              <div>
                <h3>WorkWeek</h3>
                <p className="folio-role">Co-founder &amp; CTO</p>
              </div>
              <a className="folio-text-link" href="https://www.workweek.tech/">
                Explore WorkWeek <ArrowUpRight aria-hidden="true" size={18} />
              </a>
            </div>
            <div className="folio-project-story">
              <h4>
                From the site
                <br />
                to the payroll run.
              </h4>
              <p>
                WorkWeek helps field teams manage attendance, overtime, payroll
                calculations and site costs. I lead product and engineering,
                turning feedback from the people on site into software they can
                rely on.
              </p>
            </div>
            <figure className="folio-product-image">
              <img
                src="/images/workweek-product.png"
                alt="WorkWeek’s public product demonstration: mobile clock-in, timesheets and site-cost analytics."
                width="1920"
                height="1159"
                loading="lazy"
              />
              <figcaption>
                <span>
                  The connection between work on site and decisions in the
                  office.
                </span>
                <a href="https://www.workweek.tech/">
                  WorkWeek product view{' '}
                  <ArrowUpRight aria-hidden="true" size={14} />
                </a>
              </figcaption>
            </figure>
            <aside
              className="folio-evidence"
              aria-labelledby="engineering-title"
            >
              <div>
                <h4 id="engineering-title">
                  Good engineering starts with the constraints.
                </h4>
                <p>
                  Construction sites don’t always have a reliable connection. In
                  a 2024 PowerSync interview, Gideon Boshoff and I discussed why
                  we chose a local-first approach for WorkWeek’s mobile app.
                </p>
              </div>
              <a className="folio-text-link" href={engineeringStory}>
                Read the engineering story{' '}
                <ArrowUpRight aria-hidden="true" size={18} />
                <span>PowerSync · September 2024</span>
              </a>
            </aside>
          </article>

          <article
            id="tech-local"
            className="folio-project folio-project--studio"
          >
            <div className="folio-project-heading">
              <div>
                <h3>Tech Local</h3>
                <p className="folio-role">Co-founder</p>
              </div>
              <a
                className="folio-text-link"
                href="https://www.techlocal.co.za/"
              >
                Explore Tech Local <ArrowUpRight aria-hidden="true" size={18} />
              </a>
            </div>
            <div className="folio-studio-layout">
              <div className="folio-studio-statement">
                <h4>
                  New ventures.
                  <br />
                  Practical software.
                </h4>
                <p>From an idea on the table to something people can use.</p>
              </div>
              <div className="folio-studio-copy">
                <p>
                  At Tech Local, we build ventures, custom software and AI
                  tools. The work spans product development, business automation
                  and helping teams put AI to use in their day-to-day work.
                </p>
                <p>
                  I care about the connection between the business and the
                  build: understanding the problem, making the technical
                  decisions, and staying close to how the product is used.
                </p>
                <a
                  className="folio-text-link"
                  href="https://www.techlocal.co.za/ai-employees"
                >
                  See our approach to AI employees{' '}
                  <ArrowUpRight aria-hidden="true" size={18} />
                </a>
              </div>
            </div>
            <div className="folio-studio-links">
              <p>See the work from the team.</p>
              <a href="https://www.techlocal.co.za/#projects">
                Explore the published projects{' '}
                <ArrowRight aria-hidden="true" size={20} />
              </a>
            </div>
          </article>
        </section>

        <section
          id="about"
          className="folio-about folio-width"
          aria-labelledby="about-title"
        >
          <h2 id="about-title">
            The way
            <br /> I work.
          </h2>
          <div>
            <p className="folio-about-lead">
              The people, the business and the software belong in the same
              conversation.
            </p>
            <p>
              I care about the whole problem: the person using the product, the
              business behind it, and the technical decisions that make it
              dependable. That means listening closely, being clear about
              trade-offs, and taking responsibility for what gets built.
            </p>
            <p>
              My Christian faith shapes how I approach that work—with respect
              for people’s dignity and a responsibility to serve. I want the
              things I build to be useful to the people around me.
            </p>
          </div>
        </section>

        <section
          id="contact"
          className="folio-contact"
          aria-labelledby="contact-title"
        >
          <div className="folio-width">
            <h2 id="contact-title">
              Let’s talk about
              <br />
              what you’re building.
            </h2>
            <div className="folio-contact-bottom">
              <p>
                If you’re building a company or working through a practical
                software problem, I’d be glad to hear from you.
              </p>
              <a className="folio-email" href="mailto:tristan@workweek.africa">
                tristan@workweek.africa <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <footer className="folio-footer">
              <p>© {new Date().getFullYear()} Tristan Drummond</p>
              <nav aria-label="Professional profiles">
                <a href="https://www.linkedin.com/in/tristdrum/">
                  LinkedIn <ArrowUpRight aria-hidden="true" size={15} />
                </a>
                <a href="https://github.com/tristdrum">
                  GitHub <ArrowUpRight aria-hidden="true" size={15} />
                </a>
                <a href="#main">
                  Back to top <ArrowUpRight aria-hidden="true" size={15} />
                </a>
              </nav>
            </footer>
          </div>
        </section>
      </main>
    </div>
  )
}
