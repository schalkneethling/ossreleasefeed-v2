import { createElement, type ComponentType } from "react";
import type { AdaptiveState, FeedDraft, FeedTtl } from "../lib/assistant";
import { FeedConfigPanel, GeneratedFeedUrl } from "./FeedConfigPanel";
import { FeedRecipe } from "./FeedRecipe";
import { TopicEditor } from "./TopicEditor";

type RegistryProps = {
  active: boolean;
  draft: FeedDraft;
  feedUrl: string | null;
  issues: string[];
  onActivityChange: (activityType: FeedDraft["activityType"]) => void;
  onGenerate: () => void;
  onGuidedFallback: (disabled: boolean) => void;
  onSourceChange: (source: FeedDraft["source"]) => void;
  onTopicsChange: (topics: string[]) => void;
  onTtlChange: (ttl: FeedTtl) => void;
};

type RegisteredComponent =
  | "feed-types"
  | "recipe"
  | "topic-choices"
  | "settings"
  | "validation-issues"
  | "generated-url";

const FeedTypeChoices = ({ onGuidedFallback, onSourceChange }: RegistryProps) => (
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
        onClick={() => {
          onSourceChange("starred");
          onGuidedFallback(false);
        }}
        type="button"
      >
        <span className="adaptive-stage__source-title">Starred repositories</span>
        <span className="adaptive-stage__source-detail">Continue in Guide me for this phase</span>
      </button>
    </div>
  </section>
);

const Recipe = ({ draft }: RegistryProps) => <FeedRecipe draft={draft} />;

const TopicChoices = ({ active, draft, onTopicsChange }: RegistryProps) => (
  <section aria-labelledby="ask-topics-title" className="adaptive-stage">
    <h3 className="adaptive-stage__title" id="ask-topics-title">
      Topics
    </h3>
    <TopicEditor active={active} onTopicsChange={onTopicsChange} selectedTopics={draft.topics} />
  </section>
);

const Settings = ({ draft, onActivityChange, onGenerate, onTtlChange }: RegistryProps) => (
  <FeedConfigPanel
    activityType={draft.activityType}
    onActivityChange={onActivityChange}
    onGenerate={onGenerate}
    onTtlChange={onTtlChange}
    ttl={draft.ttl}
  />
);

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
  recipe: Recipe,
  "topic-choices": TopicChoices,
  settings: Settings,
  "validation-issues": ValidationIssues,
  "generated-url": GeneratedUrl,
};

const componentsForState = (
  state: AdaptiveState,
  issues: readonly string[],
): RegisteredComponent[] => {
  if (state === "choose-source") {
    return ["feed-types"];
  }

  if (state === "enter-username" || state === "choose-repos") {
    return ["feed-types", ...(issues.length > 0 ? (["validation-issues"] as const) : [])];
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

  const components = componentsForState(state, props.issues);

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
