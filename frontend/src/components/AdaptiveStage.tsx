import { createElement, useEffect, useId, useState, type ComponentType } from "react";
import { fetchStarredRepos, type Repo } from "../lib/api";
import { useDebounce } from "../hooks/useDebounce";
import type { AdaptiveState, FeedDraft, FeedTtl } from "../lib/assistant";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import { FeedRecipe } from "./FeedRecipe";
import { RepoPicker } from "./RepoPicker";
import { TopicEditor } from "./TopicEditor";

type RegistryProps = {
  active: boolean;
  draft: FeedDraft;
  feedUrl: string | null;
  issues: string[];
  ttlSelected: boolean;
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onGenerate: () => void;
  onGuidedFallback: (disabled: boolean) => void;
  onRepoSelectionChange: (repoSelection: FeedDraft["repoSelection"]) => void;
  onSourceChange: (source: FeedDraft["source"]) => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
  onUsernameChange: (username: string) => void;
};

type RegisteredComponent =
  | "feed-types"
  | "username-choices"
  | "repo-choices"
  | "recipe"
  | "topic-choices"
  | "settings"
  | "validation-issues"
  | "generated-url";

const FeedTypeChoices = ({ onSourceChange }: RegistryProps) => (
  <section aria-labelledby="ask-source-title" className="adaptive-stage">
    <h3 className="adaptive-stage__title" id="ask-source-title">
      Choose a feed source
    </h3>
    <div className="adaptive-stage__source-options">
      <button
        className="adaptive-stage__source"
        onClick={() => onSourceChange("topics")}
        type="button"
      >
        <span className="adaptive-stage__source-title">GitHub topics</span>
        <span className="adaptive-stage__source-detail">Build here with text and controls</span>
      </button>
      <button
        className="adaptive-stage__source"
        onClick={() => onSourceChange("starred")}
        type="button"
      >
        <span className="adaptive-stage__source-title">Starred repositories</span>
        <span className="adaptive-stage__source-detail">
          Follow releases from a user&rsquo;s stars
        </span>
      </button>
    </div>
  </section>
);

const UsernameChoices = ({ draft, onUsernameChange }: RegistryProps) => {
  const inputId = useId();

  return (
    <section aria-labelledby="ask-username-title" className="adaptive-stage">
      <h3 className="adaptive-stage__title" id="ask-username-title">
        GitHub username
      </h3>
      <div className="username-input">
        <label className="username-input__label" htmlFor={inputId}>
          GitHub username
        </label>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className="username-input__field"
          id={inputId}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="e.g. octocat"
          spellCheck={false}
          type="text"
          value={draft.username ?? ""}
        />
      </div>
    </section>
  );
};

const USERNAME_DEBOUNCE_MS = 450;

const RepoChoices = ({ active, draft, onRepoSelectionChange }: RegistryProps) => {
  const titleId = useId();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const username = draft.username;
  const debouncedUsername = useDebounce(username, USERNAME_DEBOUNCE_MS);

  useEffect(() => {
    if (!active || debouncedUsername === null) {
      setRepos([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");

    fetchStarredRepos(debouncedUsername, controller.signal)
      .then((fetched) => {
        setRepos(fetched);
        setStatus("loaded");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, [active, debouncedUsername]);

  if (draft.repoSelection?.kind === "all") {
    return (
      <section aria-labelledby={titleId} className="adaptive-stage">
        <h3 className="adaptive-stage__title" id={titleId}>
          Starred repositories
        </h3>
        <p className="adaptive-stage__note">
          Including all of @{username}&rsquo;s starred repositories.
        </p>
        <button className="btn-secondary" onClick={() => onRepoSelectionChange(null)} type="button">
          Choose specific repositories
        </button>
      </section>
    );
  }

  const selectedRepos =
    draft.repoSelection?.kind === "subset" ? new Set(draft.repoSelection.repos) : new Set<string>();

  return (
    <section aria-labelledby={titleId} className="adaptive-stage">
      <h3 className="adaptive-stage__title" id={titleId}>
        Starred repositories
      </h3>
      {status === "loading" ? (
        <p className="adaptive-stage__note">Loading starred repositories&hellip;</p>
      ) : status === "error" ? (
        <p className="adaptive-stage__note">
          Could not load starred repositories. Check your connection and try again.
        </p>
      ) : (
        <RepoPicker
          key={username ?? "none"}
          onSelectionChange={(next) => onRepoSelectionChange({ kind: "subset", repos: [...next] })}
          repos={repos}
          selectedRepos={selectedRepos}
        />
      )}
      <p className="adaptive-stage__note">Prefer every starred repository instead?</p>
      <button
        className="btn-secondary"
        onClick={() => onRepoSelectionChange({ kind: "all" })}
        type="button"
      >
        Include all starred repositories
      </button>
    </section>
  );
};

const Recipe = ({ draft }: RegistryProps) => <FeedRecipe draft={draft} />;

const TopicChoices = ({ active, draft, onTopicsChange }: RegistryProps) => (
  <section aria-labelledby="ask-topics-title" className="adaptive-stage">
    <h3 className="adaptive-stage__title" id="ask-topics-title">
      Topics
    </h3>
    <TopicEditor active={active} onTopicsChange={onTopicsChange} selectedTopics={draft.topics} />
  </section>
);

const Settings = ({
  draft,
  onActivityChange,
  onGenerate,
  onTtlChange,
  ttlSelected,
}: RegistryProps) => {
  const selectionMissing =
    draft.source === "starred" &&
    (draft.repoSelection === null ||
      (draft.repoSelection.kind === "subset" && draft.repoSelection.repos.length === 0));

  return (
    <FeedConfigPanel
      activityType={draft.activityType}
      disabled={selectionMissing}
      onActivityChange={onActivityChange}
      onGenerate={onGenerate}
      onTtlChange={onTtlChange}
      ttl={draft.ttl}
      ttlSelected={ttlSelected}
    />
  );
};

const ValidationIssues = ({ issues }: RegistryProps) => (
  <section
    aria-labelledby="validation-issues-title"
    className="adaptive-stage adaptive-stage--issues"
  >
    <h3 className="adaptive-stage__title" id="validation-issues-title">
      Needs attention
    </h3>
    <ul className="ask-feed__issues">
      {issues.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  </section>
);

const GeneratedUrl = ({ feedUrl }: RegistryProps) =>
  feedUrl ? <GeneratedFeedUrl url={feedUrl} /> : null;

const COMPONENT_REGISTRY: Record<RegisteredComponent, ComponentType<RegistryProps>> = {
  "feed-types": FeedTypeChoices,
  "username-choices": UsernameChoices,
  "repo-choices": RepoChoices,
  recipe: Recipe,
  "topic-choices": TopicChoices,
  settings: Settings,
  "validation-issues": ValidationIssues,
  "generated-url": GeneratedUrl,
};

const componentsForState = (
  state: AdaptiveState,
  draft: FeedDraft,
  issues: readonly string[],
): RegisteredComponent[] => {
  if (state === "choose-source") {
    return ["feed-types"];
  }

  if (state === "enter-username") {
    return ["username-choices", ...(issues.length > 0 ? (["validation-issues"] as const) : [])];
  }

  if (state === "choose-repos") {
    const starredComponents: RegisteredComponent[] = ["repo-choices"];

    if (draft.repoSelection !== null) {
      starredComponents.push("settings");
    }

    if (issues.length > 0) {
      starredComponents.push("validation-issues");
    }

    return starredComponents;
  }

  const topicComponents: RegisteredComponent[] = [];

  if (state === "edit-topics") {
    topicComponents.push("topic-choices");
  }

  if (state === "edit-settings") {
    topicComponents.push("settings");
  }

  if (issues.length > 0) {
    topicComponents.push("validation-issues");
  }

  if (state === "ready") {
    topicComponents.push("recipe");
    topicComponents.push("generated-url");
  }

  return topicComponents;
};

export function AdaptiveStage({ state, ...props }: RegistryProps & { state: AdaptiveState }) {
  if (state === "idle") {
    return null;
  }

  const components = componentsForState(state, props.draft, props.issues);

  if (components.length === 0) {
    return null;
  }

  return (
    <div className="adaptive-stage-registry">
      {components.map((componentName) =>
        createElement(COMPONENT_REGISTRY[componentName], {
          ...props,
          key: componentName,
        }),
      )}
    </div>
  );
}
