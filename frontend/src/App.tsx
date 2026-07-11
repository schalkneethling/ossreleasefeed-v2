import { useState } from "react";
import { Builder } from "./components/Builder";
import { Hero } from "./components/Hero";
import { trackEvent } from "./lib/analytics";

const FeedMark = () => (
  <svg aria-hidden="true" className="site-header__mark" viewBox="0 0 24 24">
    <path d="M4 4a16 16 0 0 1 16 16h-3A13 13 0 0 0 4 7V4z" fill="currentColor" />
    <path d="M4 10.5A9.5 9.5 0 0 1 13.5 20h-3A6.5 6.5 0 0 0 4 13.5v-3z" fill="currentColor" />
    <circle cx="6" cy="18" fill="currentColor" r="2" />
  </svg>
);

export function App() {
  const [builderStarted, setBuilderStarted] = useState(false);

  return (
    <>
      <div className="beta-banner">
        <div className="beta-banner__inner">
          <p className="beta-banner__text">
            Public beta — under heavy load, some feeds may briefly return an error while we're on
            shared infrastructure limits.
          </p>
        </div>
      </div>
      <header className="site-header">
        <div className="site-header__inner">
          <span className="site-header__wordmark">
            <FeedMark />
            OSSReleaseFeed
          </span>
        </div>
      </header>
      <main className="page">
        <Hero
          builderStarted={builderStarted}
          onCreateFeed={() => {
            trackEvent("Feed builder started");
            setBuilderStarted(true);
          }}
        />
        {builderStarted ? <Builder /> : null}
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <p className="site-footer__note">
            Feeds are generated from public GitHub activity. Nothing is stored and no account is
            required.
          </p>
          <a
            className="site-footer__link"
            href="https://github.com/schalkneethling/ossreleasefeed-v2/issues"
            rel="noreferrer"
            target="_blank"
          >
            Report an issue
          </a>
        </div>
      </footer>
    </>
  );
}
