import "../styles/hero.css";

type HeroProps = {
  builderStarted: boolean;
  onCreateFeed: () => void;
};

export function Hero({ builderStarted, onCreateFeed }: HeroProps) {
  return (
    <section aria-labelledby="hero-title" className="hero">
      <p aria-hidden="true" className="hero__eyebrow">
        &lt;link rel=&quot;alternate&quot; type=&quot;application/atom+xml&quot;&gt;
      </p>
      <h1 className="hero__title" id="hero-title">
        Follow open source releases in your feed reader
      </h1>
      <p className="hero__summary">
        Pick GitHub topics or start from the repositories you have starred, choose the activity you
        care about, and get one permanent feed URL. No account, no email — just a URL that works in
        any reader.
      </p>
      {builderStarted ? null : (
        <button className="hero__cta" onClick={onCreateFeed} type="button">
          Create feed
        </button>
      )}
    </section>
  );
}
