import {
  ASSISTANT_INTENTS,
  type AssistantIntent,
  type FeedTtl,
  type ModelDecision,
  type ModelDraftPatch,
} from "../../contracts";
import type { TopicCandidate, TurnCandidates } from "./candidates";
import { GENERIC_OPTIONS_INTENT, NO_USERNAME, namesTopicId, removesTopicId } from "./questions";
import { FREQUENCY_LABELS, type JevTurn } from "./state";
import type { AssistantRequiredDecision, ChoiceAnswer, JevAnswer } from "./types";

// A Noul is the probability of "yes", so 0.5 is its decision boundary. Jev's
// answers move by about ±0.05 between identical requests; a higher cut-off put
// clear statements on a knife-edge. Applying a field is recoverable (the person
// sees the draft), and answers in 0.5–0.7 are the ones a later phase confirms.
export const STATED_THRESHOLD = 0.5;
// Repository actions replace or complete a selection and can take the turn
// straight to a generated URL, so they need an unmistakable request. On the
// evaluation set genuine requests score 0.92 or more and ambiguous ones 0.54 or less.
export const ACTION_THRESHOLD = 0.7;
export const CHOICE_CONFIDENCE_THRESHOLD = 0.5;
// Discarding a message costs the person a rephrase, while a missed injection
// is inert (the model cannot produce URLs, copy, or fields), so only a clear
// attempt discards the turn.
export const INJECTION_THRESHOLD = 0.7;
const MAX_TOPICS = 5;
const MAX_REPOSITORIES = 25;

// The only workflow rule outside the planner: an unqualified "what are my
// options?" is about whatever the application just asked for.
const GENERIC_OPTIONS_BY_DECISION: Readonly<Record<AssistantRequiredDecision, AssistantIntent>> = {
  "feed-source": "explain-capabilities",
  "topic-selection": "list-topics",
  "github-username": "explain-capabilities",
  "repository-selection": "list-repositories",
  "feed-settings": "list-settings",
  recovery: "explain-capabilities",
  "complete-feed": "explain-capabilities",
};

const TTL_BY_LABEL = new Map<string, FeedTtl>(
  Object.entries(FREQUENCY_LABELS).map(([ttl, label]) => [label, Number(ttl) as FeedTtl]),
);

export type ComposedDecision = {
  decision: ModelDecision;
  // The least certain judgment consumed; one wrong field spoils the turn.
  confidence: number;
};

export class JevCompositionError extends Error {
  override name = "JevCompositionError";
}

const isIntent = (value: string): value is AssistantIntent =>
  ASSISTANT_INTENTS.some((intent) => intent === value);

const noulOf = (answers: Readonly<Record<string, JevAnswer>>, id: string): number => {
  const answer = answers[id];

  return answer?.type === "noul" ? answer.noul : 0;
};

const choiceOf = (
  answers: Readonly<Record<string, JevAnswer>>,
  id: string,
): ChoiceAnswer | null => {
  const answer = answers[id];

  return answer?.type === "choice" ? answer : null;
};

const isWithin = (inner: TopicCandidate, outer: TopicCandidate): boolean =>
  inner.span !== null &&
  outer.span !== null &&
  inner !== outer &&
  outer.span[0] <= inner.span[0] &&
  inner.span[1] <= outer.span[1];

const resolveIntent = (
  answer: ChoiceAnswer | null,
  requiredDecision: AssistantRequiredDecision,
): AssistantIntent => {
  if (answer === null) {
    throw new JevCompositionError("missing-intent");
  }

  if (answer.choice === GENERIC_OPTIONS_INTENT) {
    return GENERIC_OPTIONS_BY_DECISION[requiredDecision];
  }

  if (!isIntent(answer.choice)) {
    throw new JevCompositionError("unknown-intent");
  }

  return answer.choice;
};

export const composeDecision = (
  turn: JevTurn,
  candidates: TurnCandidates,
  answers: Readonly<Record<string, JevAnswer>>,
): ComposedDecision => {
  const intentAnswer = choiceOf(answers, "intent");
  const intent = resolveIntent(intentAnswer, turn.requiredDecision);
  const consumed: number[] = [intentAnswer?.confidence ?? 0];

  const injection = noulOf(answers, "injection_attempt");

  // Any injection attempt discards the whole message, valid parts included.
  if (injection >= INJECTION_THRESHOLD) {
    return {
      decision: { intent: "unsupported", draftPatch: {}, unsupportedReason: "request" },
      confidence: Math.min(...consumed, injection),
    };
  }

  // Field answers are read only for mutating intents, so an informational
  // turn cannot change the feed.
  if (intent !== "create-or-update-feed" && intent !== "unsupported") {
    return { decision: { intent, draftPatch: {} }, confidence: Math.min(...consumed) };
  }

  if (intent === "unsupported") {
    return {
      decision: { intent, draftPatch: {}, unsupportedReason: "request" },
      confidence: Math.min(...consumed),
    };
  }

  const patch: ModelDraftPatch = {};
  const { draft } = turn;

  // Topics: a longer candidate that is named wins over the words inside it.
  const named = candidates.topics.filter((candidate, index) => {
    const probability = noulOf(answers, namesTopicId(index));

    if (candidate.span === null || probability < STATED_THRESHOLD) {
      return false;
    }

    consumed.push(probability);

    return true;
  });
  const namedTopics = named
    .filter((candidate) => !named.some((other) => isWithin(candidate, other)))
    .map((candidate) => candidate.slug);
  const removedTopics = draft.topics.filter((_, index) => {
    const probability = noulOf(answers, removesTopicId(index));

    if (probability < STATED_THRESHOLD) {
      return false;
    }

    consumed.push(probability);

    return true;
  });

  // Starred-repository signals.
  const usernameAnswer = choiceOf(answers, "username");
  const username =
    noulOf(answers, "username_stated") >= STATED_THRESHOLD &&
    usernameAnswer !== null &&
    usernameAnswer.choice !== NO_USERNAME &&
    usernameAnswer.confidence >= CHOICE_CONFIDENCE_THRESHOLD &&
    candidates.usernames.includes(usernameAnswer.choice)
      ? usernameAnswer.choice
      : null;
  const explicitRepositories = candidates.repositories.slice(0, MAX_REPOSITORIES);
  // "Just the two I mentioned" refers back to a selection; it is never a
  // request for every repository, however the word "all" was read.
  const refersToExisting = noulOf(answers, "refers_to_existing_selection") >= ACTION_THRESHOLD;
  const wantsAll = noulOf(answers, "wants_all_starred") >= ACTION_THRESHOLD && !refersToExisting;
  const asksFirst =
    noulOf(answers, "asks_first_n") >= ACTION_THRESHOLD && candidates.firstCount !== null;

  // Source: stated outright, or implied by what was supplied.
  const sourceStated = noulOf(answers, "source_stated") >= STATED_THRESHOLD;
  const sourceAnswer = choiceOf(answers, "source_value");
  const statedSource =
    sourceStated &&
    sourceAnswer !== null &&
    sourceAnswer.confidence >= CHOICE_CONFIDENCE_THRESHOLD &&
    (sourceAnswer.choice === "topics" || sourceAnswer.choice === "starred")
      ? sourceAnswer.choice
      : null;
  const impliedSource =
    explicitRepositories.length > 0 || username !== null
      ? "starred"
      : namedTopics.length > 0
        ? "topics"
        : null;
  const source = statedSource ?? impliedSource ?? draft.source;

  if (statedSource !== null && sourceAnswer !== null) {
    consumed.push(noulOf(answers, "source_stated"), sourceAnswer.confidence);
  }

  if (source !== null && source !== draft.source) {
    patch.source = source;
  }

  if (source !== "starred" && (namedTopics.length > 0 || removedTopics.length > 0)) {
    const existing = source === draft.source ? draft.topics : [];
    // Naming a topic while removing another is a substitution, whatever the
    // edit-mode reading: the topics that were not removed stay.
    const replaces =
      removedTopics.length === 0 && choiceOf(answers, "topic_edit_mode")?.choice === "replace_list";
    const kept = replaces ? [] : existing.filter((topic) => !removedTopics.includes(topic));
    const topics = [...new Set([...kept, ...namedTopics])].slice(0, MAX_TOPICS);

    if (topics.length > 0) {
      patch.topics = topics;
    }
  }

  let repoSelectionAction: ModelDecision["repoSelectionAction"];

  if (source === "starred") {
    if (username !== null && usernameAnswer !== null && username !== draft.username) {
      patch.username = username;
      consumed.push(noulOf(answers, "username_stated"), usernameAnswer.confidence);
    }

    if (explicitRepositories.length > 0) {
      patch.repoSelection = { kind: "subset", repos: explicitRepositories };

      if (
        draft.repoSelection?.kind === "subset" &&
        noulOf(answers, "replaces_selection") >= ACTION_THRESHOLD
      ) {
        repoSelectionAction = { kind: "replace" };
        consumed.push(noulOf(answers, "replaces_selection"));
      }
    } else if (asksFirst && candidates.firstCount !== null) {
      repoSelectionAction = { kind: "first", count: candidates.firstCount };
      consumed.push(noulOf(answers, "asks_first_n"));
    } else if (wantsAll) {
      repoSelectionAction = { kind: "all" };
      consumed.push(noulOf(answers, "wants_all_starred"));
    }
  }

  if (noulOf(answers, "activity_stated") >= STATED_THRESHOLD) {
    const activity = choiceOf(answers, "activity_value");

    if (
      activity !== null &&
      activity.confidence >= CHOICE_CONFIDENCE_THRESHOLD &&
      (activity.choice === "releases" || activity.choice === "all") &&
      activity.choice !== draft.activityType
    ) {
      patch.activityType = activity.choice;
      consumed.push(noulOf(answers, "activity_stated"), activity.confidence);
    }
  }

  let unsupportedInterval = false;

  if (noulOf(answers, "frequency_stated") >= STATED_THRESHOLD) {
    consumed.push(noulOf(answers, "frequency_stated"));

    // A duration parsed in code beats the model's reading of a number.
    if (candidates.frequency?.kind === "supported") {
      patch.ttl = candidates.frequency.ttl;
    } else if (candidates.frequency?.kind === "unsupported") {
      unsupportedInterval = true;
    } else {
      const frequency = choiceOf(answers, "frequency_value");
      const ttl = frequency === null ? undefined : TTL_BY_LABEL.get(frequency.choice);

      if (frequency !== null && frequency.confidence >= CHOICE_CONFIDENCE_THRESHOLD) {
        consumed.push(frequency.confidence);

        if (ttl !== undefined) {
          patch.ttl = ttl;
        } else {
          unsupportedInterval = true;
        }
      }
    }
  }

  const confidence = Math.min(...consumed);

  if (unsupportedInterval) {
    return {
      decision: { intent: "unsupported", draftPatch: patch, unsupportedReason: "interval" },
      confidence,
    };
  }

  return {
    decision: {
      intent,
      draftPatch: patch,
      ...(repoSelectionAction === undefined ? {} : { repoSelectionAction }),
    },
    confidence,
  };
};
