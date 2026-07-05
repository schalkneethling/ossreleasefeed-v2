import "../styles/mode-selection.css";

export type FeedMode = "topics" | "starred";

type ModeSelectionProps = {
  mode: FeedMode | null;
  onSelect: (mode: FeedMode) => void;
};

const modes = [
  {
    id: "topics",
    title: "Feed by topic",
    description:
      "Follow releases across every repository tagged with the GitHub topics you choose.",
    sample: "topic:web-components",
  },
  {
    id: "starred",
    title: "Feed by stars",
    description: "Follow releases from the repositories a GitHub user has starred.",
    sample: "octocat → starred",
  },
] as const;

export function ModeSelection({ mode, onSelect }: ModeSelectionProps) {
  return (
    <div className="mode-selection">
      {modes.map((option) => (
        <button
          aria-pressed={mode === option.id}
          className={mode === option.id ? "mode-card mode-card--selected" : "mode-card"}
          key={option.id}
          onClick={() => onSelect(option.id)}
          type="button"
        >
          <span className="mode-card__title">{option.title}</span>
          <span className="mode-card__description">{option.description}</span>
          <span aria-hidden="true" className="mode-card__sample">
            {option.sample}
          </span>
        </button>
      ))}
    </div>
  );
}
