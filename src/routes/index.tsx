import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  PanelRight,
  ShieldCheck,
} from "lucide-react";
import logoAsset from "@/assets/minted-mark.png.asset.json";
import "./landing.css";

export const Route = createFileRoute("/")({ component: LandingPage });

const EXTENSION_URL =
  "https://chromewebstore.google.com/detail/minted-panel-workbench/dppfnbikpojpgdiobckgcknmkjlfoinh?hl=en";

function LandingPage() {
  return (
    <div className="mp-site">
      <Header />
      <main>
        <Hero />
        <Customers />
        <Workflow />
        <DashboardSection />
        <WorkbenchSection />
        <Capabilities />
        <HowItWorks />
        <Questions />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <a
      className={`mp-brand${light ? " mp-brand-light" : ""}`}
      href="/"
      aria-label="Minted Panel home"
    >
      <span className="mp-brand-mark">
        <img src={logoAsset.url} alt="" />
      </span>
      <span>
        minted<span className="mp-brand-panel">panel</span>
      </span>
    </a>
  );
}

function Header() {
  return (
    <header className="mp-header">
      <div className="mp-container mp-header-inner">
        <Brand />
        <nav className="mp-nav" aria-label="Main navigation">
          <details className="mp-products">
            <summary>
              Products <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
            </summary>
            <div className="mp-products-menu">
              <a
                href="#dashboard"
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                <span className="mp-menu-icon">
                  <LayoutDashboard size={19} />
                </span>
                <span>
                  <strong>Dashboard</strong>
                  <small>The case view behind our service</small>
                </span>
                <ArrowUpRight size={16} className="mp-menu-arrow" />
              </a>
              <a
                href="#workbench"
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                <span className="mp-menu-icon">
                  <PanelRight size={19} />
                </span>
                <span>
                  <strong>Workbench</strong>
                  <small>Portal support for our team</small>
                </span>
                <ArrowUpRight size={16} className="mp-menu-arrow" />
              </a>
            </div>
          </details>
          <a href="#how-it-works" className="mp-nav-secondary">
            How it works
          </a>
        </nav>
        <div className="mp-header-actions">
          <Link to="/login" className="mp-login">
            Log in
          </Link>
          <Link to="/contact" className="mp-button mp-button-dark mp-header-cta">
            Get in touch <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mp-hero" aria-labelledby="mp-hero-title">
      <div className="mp-container mp-hero-content">
        <div className="mp-hero-copy">
          <div className="mp-eyebrow">
            <span className="mp-eyebrow-dot" /> Provider credentialing services
          </div>
          <h1 id="mp-hero-title">Provider credentialing, handled by our team.</h1>
          <p>
            Our team helps manage provider details, payer applications, portal work, and the next
            steps that keep cases moving. Dashboard and Workbench help us keep that work organized
            and visible.
          </p>
          <div className="mp-hero-actions">
            <Link to="/contact" className="mp-button mp-button-dark">
              Talk to our team <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="mp-text-link">
              See how it works <ArrowRight size={17} />
            </a>
          </div>
          <div className="mp-hero-note">
            <ShieldCheck size={17} /> Human-led credentialing, supported by practical tools
          </div>
        </div>
        <HeroDiagram />
      </div>
      <div className="mp-hero-bottom mp-container">
        <span>PROVIDER DETAILS</span>
        <span>PAYER APPLICATIONS</span>
        <span>FOLLOW-THROUGH</span>
      </div>
    </section>
  );
}

function HeroDiagram() {
  return (
    <div
      className="mp-hero-visual"
      role="img"
      aria-label="Illustration showing how our team moves a case from Dashboard to portal work in Workbench"
    >
      <div className="mp-visual-grid" />
      <div className="mp-hero-window mp-hero-dashboard">
        <div className="mp-window-top">
          <span className="mp-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Dashboard</span>
          <LayoutDashboard size={14} />
        </div>
        <div className="mp-demo-heading">
          <span className="mp-demo-kicker">OUR CASE WORKSPACE</span>
          <strong>Keep the next step clear.</strong>
        </div>
        <div className="mp-demo-row">
          <span className="mp-demo-row-icon">
            <ClipboardList size={16} />
          </span>
          <span>
            <b>Provider record</b>
            <small>Details ready for enrollment</small>
          </span>
          <span className="mp-demo-check">
            <Check size={14} />
          </span>
        </div>
        <div className="mp-demo-row">
          <span className="mp-demo-row-icon">
            <FileCheck2 size={16} />
          </span>
          <span>
            <b>Payer application</b>
            <small>Next action: complete portal form</small>
          </span>
          <ArrowRight size={15} />
        </div>
      </div>
      <div className="mp-hero-connector">
        <span>
          <ArrowRight size={19} />
        </span>
      </div>
      <div className="mp-hero-window mp-hero-workbench">
        <div className="mp-window-top">
          <span className="mp-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Workbench</span>
          <PanelRight size={14} />
        </div>
        <div className="mp-demo-heading">
          <span className="mp-demo-kicker">IN THE PAYER PORTAL</span>
          <strong>Bring the case details along.</strong>
        </div>
        <div className="mp-field">
          <span>Provider name</span>
          <span className="mp-field-line" />
          <Check size={15} />
        </div>
        <div className="mp-field">
          <span>NPI</span>
          <span className="mp-field-line mp-field-line-short" />
          <Check size={15} />
        </div>
        <div className="mp-review-note">
          <span className="mp-review-dot" /> Filled fields ready for human review
        </div>
      </div>
      <div className="mp-visual-caption">
        Case context <span /> Portal work
      </div>
    </div>
  );
}

function Customers() {
  return (
    <section className="mp-customers" aria-label="Customers">
      <div className="mp-container mp-customers-inner">
        <div className="mp-customer-logos">
          <div className="mp-customer-logo mp-customer-logo-best">
            <img src="/customers/best-physical-therapy.png" alt="Best Physical Therapy" />
          </div>
          <div className="mp-customer-logo mp-customer-logo-physio">
            <img src="/customers/physio.png" alt="Fitness Physio" />
          </div>
          <div className="mp-customer-logo mp-customer-logo-renew">
            <img src="/customers/renew-physiotherapy.png" alt="Renew Physiotherapy" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  return (
    <section className="mp-workflow mp-section" aria-labelledby="mp-workflow-title">
      <div className="mp-container">
        <div className="mp-center-intro">
          <div className="mp-eyebrow">How our team works</div>
          <h2 id="mp-workflow-title">The service behind every next step.</h2>
          <p>
            We keep provider details, payer cases, portal tasks, and follow-ups connected so each
            piece of work has a clear next action.
          </p>
        </div>
        <div className="mp-flow" aria-label="Dashboard to Workbench to review workflow">
          <div className="mp-flow-card">
            <div className="mp-flow-num">01</div>
            <div className="mp-flow-icon">
              <LayoutDashboard size={25} />
            </div>
            <h3>Organize the case</h3>
            <p>We keep the provider, payer, status, and next action together.</p>
          </div>
          <div className="mp-flow-arrow">
            <ArrowRight size={22} />
          </div>
          <div className="mp-flow-card">
            <div className="mp-flow-num">02</div>
            <div className="mp-flow-icon">
              <PanelRight size={25} />
            </div>
            <h3>Work in the portal</h3>
            <p>Our team carries case context into supported payer portals with Workbench.</p>
          </div>
          <div className="mp-flow-arrow">
            <ArrowRight size={22} />
          </div>
          <div className="mp-flow-card">
            <div className="mp-flow-num">03</div>
            <div className="mp-flow-icon">
              <FileCheck2 size={25} />
            </div>
            <h3>Review and follow up</h3>
            <p>A person reviews the form, submits it, and records the next step.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardSection() {
  return (
    <section
      id="dashboard"
      className="mp-feature mp-feature-dashboard mp-section"
      aria-labelledby="mp-dashboard-title"
    >
      <div className="mp-container mp-feature-grid">
        <div className="mp-feature-copy">
          <div className="mp-eyebrow">
            <LayoutDashboard size={16} /> Behind the service / Dashboard
          </div>
          <h2 id="mp-dashboard-title">We keep every case in view.</h2>
          <p className="mp-lead">
            Our team uses Dashboard to track credentialing cases across providers, payers, and
            states, with tasks and activity beside each status.
          </p>
          <ul className="mp-feature-list">
            <li>
              <Check size={18} /> Prioritize payer and state cases in a work queue
            </li>
            <li>
              <Check size={18} /> Keep provider, group, and facility context close
            </li>
            <li>
              <Check size={18} /> Record tasks, touches, and submission history on the case
            </li>
          </ul>
          <Link to="/contact" className="mp-text-link mp-feature-link">
            Discuss your credentialing needs <ArrowRight size={18} />
          </Link>
        </div>
        <DashboardDiagram />
      </div>
    </section>
  );
}

function DashboardDiagram() {
  return (
    <div
      className="mp-feature-visual mp-dashboard-visual"
      role="img"
      aria-label="Illustration of a case dashboard with provider, payer, and status columns"
    >
      <div className="mp-diagram-label">A SHARED VIEW OF THE WORK</div>
      <div className="mp-app-frame">
        <div className="mp-app-sidebar">
          <span className="mp-app-mini-logo">m</span>
          <span className="mp-app-side-active">
            <LayoutDashboard size={17} />
          </span>
          <span>
            <ClipboardList size={17} />
          </span>
          <span>
            <FileCheck2 size={17} />
          </span>
        </div>
        <div className="mp-app-main">
          <div className="mp-app-header">
            <div>
              <small>WORKSPACE</small>
              <strong>Credentialing cases</strong>
            </div>
            <span className="mp-app-avatar" />
          </div>
          <div className="mp-app-tabs">
            <b>All cases</b>
            <span>Needs attention</span>
            <span>In progress</span>
          </div>
          <div className="mp-app-table">
            <div className="mp-app-table-head">
              <span>PROVIDER</span>
              <span>PAYER</span>
              <span>STATUS</span>
            </div>
            <div className="mp-app-table-row">
              <span>
                <i className="mp-avatar-circle" /> Provider record
              </span>
              <span>Enrollment</span>
              <span>
                <em>Next action</em>
              </span>
            </div>
            <div className="mp-app-table-row">
              <span>
                <i className="mp-avatar-circle mp-avatar-alt" /> Provider record
              </span>
              <span>Follow up</span>
              <span>
                <em className="mp-status-progress">In progress</em>
              </span>
            </div>
            <div className="mp-app-table-row">
              <span>
                <i className="mp-avatar-circle mp-avatar-third" /> Provider record
              </span>
              <span>Contracting</span>
              <span>
                <em className="mp-status-review">Under review</em>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mp-diagram-float">
        <span>
          <ClipboardList size={18} />
        </span>
        <div>
          <b>Next action, visible</b>
          <small>Our team knows where to pick up</small>
        </div>
        <ArrowUpRight size={17} />
      </div>
    </div>
  );
}

function WorkbenchSection() {
  return (
    <section
      id="workbench"
      className="mp-feature mp-feature-workbench mp-section"
      aria-labelledby="mp-workbench-title"
    >
      <div className="mp-container mp-feature-grid">
        <WorkbenchDiagram />
        <div className="mp-feature-copy">
          <div className="mp-eyebrow">
            <PanelRight size={16} /> Behind the service / Workbench
          </div>
          <h2 id="mp-workbench-title">Our team works where payer applications happen.</h2>
          <p className="mp-lead">
            Workbench opens beside supported payer portals with the selected case and provider
            details. It helps our team fill available fields before a person reviews and submits.
          </p>
          <ul className="mp-feature-list">
            <li>
              <Check size={18} /> Carry provider details into supported portal fields
            </li>
            <li>
              <Check size={18} /> Identify filled, skipped, and manual fields for review
            </li>
            <li>
              <Check size={18} /> Log the fill and human submission on the case
            </li>
          </ul>
          <a
            className="mp-button mp-button-dark mp-download"
            href={EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the Chrome extension <ArrowUpRight size={18} />
          </a>
          <p className="mp-fine-print">
            Workbench helps with fields; a person reviews and submits portal forms.
          </p>
        </div>
      </div>
    </section>
  );
}

function WorkbenchDiagram() {
  return (
    <div
      className="mp-feature-visual mp-workbench-visual"
      role="img"
      aria-label="Illustration of Workbench beside a payer portal form"
    >
      <div className="mp-diagram-label">CONTEXT FOR OUR PORTAL WORK</div>
      <div className="mp-portal-frame">
        <div className="mp-portal-bar">
          <span className="mp-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>payer portal</span>
        </div>
        <div className="mp-portal-body">
          <small>ENROLLMENT FORM</small>
          <strong>Provider information</strong>
          <div className="mp-portal-input">
            <span>Name</span>
            <b>Filled from Minted Panel</b>
            <Check size={15} />
          </div>
          <div className="mp-portal-input">
            <span>NPI</span>
            <b>Filled from Minted Panel</b>
            <Check size={15} />
          </div>
          <div className="mp-portal-input">
            <span>Practice address</span>
            <b>Review before submitting</b>
            <Check size={15} />
          </div>
        </div>
      </div>
      <div className="mp-extension-frame">
        <div className="mp-extension-head">
          <span className="mp-app-mini-logo">m</span>
          <span>
            <b>Workbench</b>
            <small>Provider context</small>
          </span>
          <PanelRight size={17} />
        </div>
        <div className="mp-extension-body">
          <div className="mp-extension-pill">
            <span className="mp-review-dot" /> Connected to case
          </div>
          <strong>Ready to fill</strong>
          <p>Bring provider details into the open portal form.</p>
          <div className="mp-extension-action">
            Fill available fields <ArrowRight size={16} />
          </div>
          <div className="mp-extension-footer">
            <ShieldCheck size={15} /> Review before submitting
          </div>
        </div>
      </div>
    </div>
  );
}

function Capabilities() {
  return (
    <section className="mp-capabilities mp-section" aria-labelledby="mp-capabilities-title">
      <div className="mp-container">
        <div className="mp-capabilities-heading">
          <div>
            <div className="mp-eyebrow">What supports our service</div>
            <h2 id="mp-capabilities-title">The details our team keeps connected.</h2>
          </div>
          <p>
            We use provider records, case history, roster workflows, and portal context to keep the
            work moving and make progress easier to follow.
          </p>
        </div>
        <div className="mp-capabilities-grid">
          <article>
            <span>01 / PROVIDERS</span>
            <h3>Provider and location records</h3>
            <p>
              We keep provider details connected to groups and facilities, so the right location
              context is available for payer work.
            </p>
          </article>
          <article>
            <span>02 / CASES</span>
            <h3>Payer work by state</h3>
            <p>
              We track each case through its status, tasks, latest activity, and payer reference
              details.
            </p>
          </article>
          <article>
            <span>03 / REPORTING</span>
            <h3>Rosters and reports</h3>
            <p>
              Roster workflows and reporting views help us understand enrollment work across your
              organization.
            </p>
          </article>
          <article>
            <span>04 / PORTALS</span>
            <h3>Case-aware portal work</h3>
            <p>
              We carry provider, payer, and location context from a case into Workbench when working
              in supported portals.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="mp-steps mp-section" aria-labelledby="mp-steps-title">
      <div className="mp-container mp-steps-grid">
        <div>
          <div className="mp-eyebrow">Working with Minted Panel</div>
          <h2 id="mp-steps-title">Credentialing support built around your workload.</h2>
          <p>
            We learn what your organization needs, organize the cases, and work through the next
            actions with human review. The work stays connected to its case history.
          </p>
          <Link to="/contact" className="mp-text-link">
            Talk to us about your workload <ArrowRight size={18} />
          </Link>
        </div>
        <div className="mp-step-list">
          <div>
            <span>01</span>
            <div>
              <h3>Understand the workload</h3>
              <p>
                We discuss your providers, payers, current process, and where support is needed.
              </p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <h3>Work the cases</h3>
              <p>Our team uses case context and Workbench to support work in payer portals.</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <h3>Keep the record current</h3>
              <p>We review submissions, record completed work, and track what needs follow-up.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Questions() {
  return (
    <section className="mp-questions mp-section" aria-labelledby="mp-questions-title">
      <div className="mp-container mp-questions-grid">
        <div>
          <div className="mp-eyebrow">Working with Minted Panel</div>
          <h2 id="mp-questions-title">What to expect, from day one.</h2>
          <p>How we get started, support your providers, and keep your practice informed.</p>
        </div>
        <div className="mp-question-list">
          <details open>
            <summary>
              How does this make credentialing easier for our practice?<span>+</span>
            </summary>
            <p>
              Our team takes on the case organization, payer portal work, and follow-ups within your
              agreed scope. We keep provider details, application status, and next steps together,
              so your staff has less administrative work to coordinate and a clearer view of what
              still needs their attention.
            </p>
          </details>
          <details>
            <summary>
              What happens during onboarding?<span>+</span>
            </summary>
            <p>
              We start with your practice details, locations, provider roster, and the payers you
              want to work with. Together, we review existing applications and missing information,
              confirm the work you need help with, and organize the cases and next steps. We also
              agree on who to contact at your practice and how you’ll receive updates.
            </p>
          </details>
          <details>
            <summary>
              How do we get a provider started?<span>+</span>
            </summary>
            <p>
              Start with your existing provider roster, or add one provider at a time. We organize
              details such as their NPI, specialty, licenses, practice locations, and payer needs,
              then identify any gaps. Your practice and providers help supply missing information
              and complete any required reviews or attestations as the case progresses.
            </p>
          </details>
          <details>
            <summary>
              What visibility do practice managers get?<span>+</span>
            </summary>
            <p>
              We track work by provider and payer, including case status, recorded activity,
              outstanding items, and next actions. That record helps explain what has been done,
              what is waiting on a payer, and where your team needs to respond. During onboarding,
              we’ll confirm the reporting and access available to your practice and how those
              updates will be shared.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="mp-final" aria-labelledby="mp-final-title">
      <div className="mp-container mp-final-inner">
        <div className="mp-eyebrow">Let's talk about your workload</div>
        <h2 id="mp-final-title">Get support for the credentialing work on your plate.</h2>
        <p>
          Tell us about your providers, payers, and current process. We’ll talk through where our
          team can help and how we keep the work moving.
        </p>
        <div className="mp-final-actions">
          <Link to="/contact" className="mp-button mp-button-light">
            Get in touch <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mp-footer">
      <div className="mp-container mp-footer-main">
        <div>
          <Brand light />
          <p>Credentialing service, supported by practical tools.</p>
        </div>
        <div className="mp-footer-links">
          <div>
            <strong>Our tools</strong>
            <a href="#dashboard">Dashboard</a>
            <a href="#workbench">Workbench</a>
          </div>
          <div>
            <strong>Company</strong>
            <Link to="/contact">Contact</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
          <div>
            <strong>Account</strong>
            <Link to="/login">Log in</Link>
            <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer">
              Download extension
            </a>
          </div>
        </div>
      </div>
      <div className="mp-container mp-footer-bottom">
        <span>© {new Date().getFullYear()} Minted Panel</span>
        <span>Human-led provider credentialing.</span>
      </div>
    </footer>
  );
}
