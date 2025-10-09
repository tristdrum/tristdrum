import './App.css'

type Stat = {
  label: string
  value: string
}

type FocusCard = {
  title: string
  subtitle: string
  description: string
  tags: string[]
  linkLabel?: string
  href?: string
}

type TimelineItem = {
  year: string
  title: string
  detail: string
}

type Signal = {
  title: string
  description: string
  meta: string
}

type LabProject = {
  title: string
  detail: string
  meta: string
  tags?: string[]
  href?: string
}

const stats: Stat[] = [
  { label: 'Role', value: 'Co-founder & CTO · WorkWeek' },
  { label: 'Team', value: '6 humans · remote SA' },
  { label: 'Impact', value: '1M+ shifts logged' },
  { label: 'Growth', value: 'ZAR 250k MRR · breakeven' },
]

const focusCards: FocusCard[] = [
  {
    title: 'WorkWeek',
    subtitle: 'Co-founder & CTO',
    description:
      'Blue-collar workforce SaaS powering selfie + geolocation clock-ins, automated overtime, and payroll for thousands of workers. Remote six-person team, spun out of The Delta with ZAR 250k MRR and 20% founder ownership.',
    tags: ['Time tracking', 'Payroll', 'Data-free app'],
    linkLabel: 'Visit WorkWeek',
    href: 'https://workweek.africa',
  },
  {
    title: 'Tech Local',
    subtitle: 'Vibe coder studio',
    description:
      '50/50-owned studio training “vibe coders” to ship AI-assisted sites via WhatsApp, Custom GPT copilots, and automation rails so local businesses access world-class stacks without predatory retainers.',
    tags: ['AI tooling', 'Automation', 'Training'],
    linkLabel: 'Explore Tech Local',
    href: 'https://techlocal.co.za',
  },
  {
    title: 'Champ Foundation',
    subtitle: 'Human dignity platform',
    description:
      'Voucher-powered giving that pairs donors, beneficiaries, and partner NPOs on a “journey to dignity.” Heartflow pilots proved the model; Champ keeps the dream alive as resources and AI mature.',
    tags: ['Impact', 'Dignity', 'Community'],
  },
]

const timeline: TimelineItem[] = [
  {
    year: 'Now',
    title: 'Tech lead at WorkWeek',
    detail:
      'Guiding a sub-10-person crew toward African-unicorn scale—data-free clock-ins, automated wages, and blue-collar justice in every release.',
  },
  {
    year: '2022',
    title: 'Delta’s top venture-build squad',
    detail:
      'Formed and led Codelight inside The Delta, shipping MVPs in weeks and earning the builder’s strongest track record.',
  },
  {
    year: 'Earlier',
    title: 'Business & CS at Africa’s top university',
    detail:
      'Studied at the continent’s best university while raising capital instincts and technical foundations for entrepreneurial work.',
  },
  {
    year: 'Origins',
    title: 'Raised for entrepreneurship',
    detail:
      'Grew up learning to serve people through technology and venture building—a family and community focus that shaped every project since.',
  },
]

const signals: Signal[] = [
  {
    title: 'Entrepreneurial roots',
    description:
      'Raised to build companies with purpose—learned sales, capital instincts, and hustle early so every product starts from real market care.',
    meta: 'Origin',
  },
  {
    title: 'University craftsmanship',
    description:
      'Blended Business + Computer Science at Africa’s leading university, pairing disciplined systems thinking with commercial intuition.',
    meta: 'Foundation',
  },
  {
    title: 'Builder of builders',
    description:
      'Led the top-performing venture team inside The Delta, spinning WorkWeek out and coaching talent so small crews can ship huge outcomes.',
    meta: 'Leadership',
  },
]

const labProjects: LabProject[] = [
  {
    title: 'MATTTCHES',
    detail:
      'Values-based connections app for Matt Budden—AI prompts guide daily reflections and suggest in-person meetups for aligned communities.',
    meta: 'In-person community',
    tags: ['AI prompts', 'Events', 'Values'],
    href: 'https://matttches.com',
  },
  {
    title: 'Clio',
    detail:
      'CLI orchestrator that coordinates Codex, Claude, Cursor, and more to vibe-code deployments. Built with Agents SDK + FastAPI on Fly.io.',
    meta: 'Automation core',
    tags: ['Agents', 'CLI', 'Automation'],
  },
  {
    title: 'Tech Local client stack',
    detail:
      'Custom GPTs, Supabase back offices, and low-cost WhatsApp onboarding for Wheco Holdings, civils companies, and micro-enterprises.',
    meta: 'Delivery system',
    tags: ['Supabase', 'WhatsApp', 'No lock-in'],
  },
]

const socialLinks = [
  { label: 'WorkWeek', href: 'https://workweek.africa' },
  { label: 'Tech Local', href: 'https://techlocal.co.za' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/tristdrum/' },
  { label: 'GitHub', href: 'https://github.com/tristdrum' },
  { label: 'X (Twitter)', href: 'https://x.com/tristdrum' },
]

function App() {
  return (
    <main className="page">
      <div className="backdrop">
        <div className="orb orb-one" aria-hidden="true"></div>
        <div className="orb orb-two" aria-hidden="true"></div>
        <div className="orb orb-three" aria-hidden="true"></div>
      </div>

      <div className="frame">
        <nav className="nav">
          <div className="nav__brand">
            <span className="nav__dot" aria-hidden="true"></span>
            <span>tristdrum.com</span>
          </div>
          <div className="nav__links">
            {socialLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        </nav>

        <header className="hero">
          <p className="hero__eyebrow">African technologist · Builder for humans</p>
          <h1 className="hero__title">
            Tristan Drummond
            <span className="hero__subtitle">
              Calm, exacting technologist delivering data-free operations tools for blue-collar teams.
            </span>
          </h1>
          <p className="hero__copy">
            CTO at WorkWeek, South Africa’s time tracking and wages platform for remote and on-site crews.
            I translate worker stories into humble software—automatic overtime, site insights, and payroll clarity built for humans.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="mailto:tristan@workweek.africa">
              Build together
            </a>
            <a className="button button--ghost" href="https://github.com/tristdrum" target="_blank" rel="noreferrer">
              Browse the work
            </a>
          </div>
          <div className="hero__stats">
            {stats.map((stat) => (
              <div key={stat.label} className="stat">
                <span className="stat__label">{stat.label}</span>
                <span className="stat__value">{stat.value}</span>
              </div>
            ))}
          </div>
        </header>

        <section className="section">
          <div className="section__header">
            <span className="eyebrow">Now</span>
            <h2>Shipping WorkWeek with field-trusted care</h2>
            <p>
              The team and I obsess over tools that feel simple for supervisors and workers alike—accurate wage calculations,
              instant accountability, and reports that keep payroll grounded in truth.
            </p>
          </div>
          <div className="card-grid">
            {focusCards.map((card) => (
              <div key={card.title} className="card">
                <div className="card__accent" aria-hidden="true"></div>
                <div className="card__header">
                  <span className="card__subtitle">{card.subtitle}</span>
                  <h3>{card.title}</h3>
                </div>
                <p className="card__copy">{card.description}</p>
                <div className="tag-row">
                  {card.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                {card.href && card.linkLabel && (
                  <a className="card__link" href={card.href} target="_blank" rel="noreferrer">
                    {card.linkLabel}
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="section section--labs">
          <div className="section__header">
            <span className="eyebrow">Active labs</span>
            <h2>Systems I’m quietly compounding</h2>
            <p>
              From WhatsApp copilots to multi-agent coding orchestration, each experiment feeds back into WorkWeek,
              Tech Local, and the communities we serve.
            </p>
          </div>
          <div className="lab-grid">
            {labProjects.map((project) => (
              <div key={project.title} className="lab">
                <span className="lab__meta">{project.meta}</span>
                <h3>{project.title}</h3>
                <p>{project.detail}</p>
                {project.tags && (
                  <div className="tag-row">
                    {project.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {project.href && (
                  <a className="lab__link" href={project.href} target="_blank" rel="noreferrer">
                    Learn more <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="section section--timeline">
          <div className="section__header">
            <span className="eyebrow">Chapters</span>
            <h2>Momentum guided by patience</h2>
            <p>
              From civic infrastructure to WorkWeek’s time tracking suite, my arc is about building durable systems that honor
              people, reduce waste, and keep operations calm even as they scale.
            </p>
          </div>
          <div className="timeline">
            {timeline.map((item) => (
              <div key={item.year} className="timeline__item">
                <div className="timeline__marker" aria-hidden="true"></div>
                <div className="timeline__content">
                  <span className="timeline__year">{item.year}</span>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section section--signals">
          <div className="section__header">
            <span className="eyebrow">Signals</span>
            <h2>How Tristan shows up</h2>
            <p>
              Expect entrepreneurial grit, talent-density rituals, and humility—every season builds on decades of family influence, university discipline, and venture-building reps.
            </p>
          </div>
          <div className="signal-grid">
            {signals.map((signal) => (
              <div key={signal.title} className="signal">
                <span className="signal__meta">{signal.meta}</span>
                <h3>{signal.title}</h3>
                <p>{signal.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section section--cta">
          <div className="cta">
            <div>
              <span className="eyebrow eyebrow--bright">Next build</span>
              <h2>Bring Tristan into your next chapter</h2>
              <p>
                Ready for a WorkWeek implementation, a Tech Local experiment, or a Champ Foundation riff?
                Let’s shape technology that honors blue-collar teams and unlocks human dignity.
              </p>
            </div>
            <div className="cta__actions">
              <a className="button button--primary" href="https://calendar.app.google/Q4Ym3ZFuosmq2j977" target="_blank" rel="noreferrer">
                Schedule a deep dive
              </a>
              <a
                className="button button--ghost"
                href="https://www.linkedin.com/in/tristdrum/"
                target="_blank"
                rel="noreferrer"
              >
                Share context
              </a>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div className="footer__meta">
            <span>© {new Date().getFullYear()} Tristan Drummond</span>
            <span>Crafted with patience in South Africa</span>
          </div>
          <div className="footer__links">
            {socialLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        </footer>
      </div>
    </main>
  )
}

export default App
