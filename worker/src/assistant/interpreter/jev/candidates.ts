import { FEED_TTLS, type FeedTtl } from "../../contracts";
import { extractExplicitRepositoryNames, TOPIC_SLUG, USERNAME_PATTERN } from "../../entities";

// Jev selects among values; it never generates them. Everything here errs
// toward over-finding so the intended value is always among the candidates.

const MAX_TOPIC_CANDIDATES = 40;
const MAX_USERNAME_CANDIDATES = 60;
const MAX_TOPIC_NGRAM = 3;

const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "of",
  "from",
  "in",
  "on",
  "to",
  "for",
  "with",
  "by",
  "at",
  "as",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "them",
  "they",
  "i",
  "im",
  "me",
  "my",
  "mine",
  "we",
  "our",
  "you",
  "your",
  "is",
  "are",
  "was",
  "be",
  "do",
  "does",
  "can",
  "could",
  "would",
  "should",
  "will",
  "what",
  "which",
  "who",
  "how",
  "when",
  "where",
  "why",
  "no",
  "not",
  "yes",
  "just",
  "only",
  "also",
  "too",
  "else",
  "all",
  "any",
  "some",
  "each",
  "every",
  "please",
  "thanks",
  "actually",
  "instead",
  "now",
  "then",
  "so",
  "about",
  "into",
  "mean",
]);

const TOPIC_STOP_WORDS = new Set([
  ...FUNCTION_WORDS,
  "feed",
  "feeds",
  "topic",
  "topics",
  "create",
  "make",
  "build",
  "use",
  "using",
  "want",
  "need",
  "like",
  "follow",
  "include",
  "add",
  "remove",
  "drop",
  "replace",
  "change",
  "switch",
  "update",
  "updates",
  "refresh",
  "refreshes",
  "once",
  "twice",
  "hour",
  "hours",
  "hourly",
  "day",
  "days",
  "daily",
  "week",
  "weeks",
  "weekly",
  "minute",
  "minutes",
  "month",
  "months",
  "starred",
  "stars",
  "star",
  "repository",
  "repositories",
  "repo",
  "repos",
  "username",
  "user",
  "show",
  "hide",
  "close",
  "open",
  "select",
  "first",
  "available",
  "options",
  "mentioned",
  "previously",
  // The product's own activity vocabulary is never a topic to follow.
  "activity",
  "release",
  "releases",
  "issue",
  "issues",
  "pull",
  "request",
  "requests",
  "pr",
  "prs",
  "commits",
]);

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  "twenty-four": 24,
  "twenty-five": 25,
  thirty: 30,
  "forty-eight": 48,
};

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  minute: 60,
  min: 60,
  hour: 3_600,
  hr: 3_600,
  day: 86_400,
  week: 604_800,
  wk: 604_800,
  month: 2_592_000,
};

const NUMBER_PATTERN = `\\d{1,4}(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")}`;
const UNIT_PATTERN = "minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?";
const QUANTIFIED_DURATION = new RegExp(
  `(?:^|[^a-z0-9])(${NUMBER_PATTERN})[\\s-]*(${UNIT_PATTERN})(?![a-z])`,
  "iu",
);
const EVERY_UNIT = new RegExp(`(?:^|[^a-z])(?:every|each|per)\\s+(${UNIT_PATTERN})(?![a-z])`, "iu");
const ADVERB_SECONDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/(?:^|[^a-z])hourly(?![a-z])/iu, 3_600],
  [/(?:^|[^a-z])daily(?![a-z])/iu, 86_400],
  [/(?:^|[^a-z])weekly(?![a-z])/iu, 604_800],
  [/(?:^|[^a-z])monthly(?![a-z])/iu, 2_592_000],
];
const TWICE = /(?:^|[^a-z])twice(?![a-z])/iu;
const FIRST_COUNT = new RegExp(
  `(?:^|[^a-z])(?:first|top)\\s+(${NUMBER_PATTERN})(?![a-z0-9])`,
  "iu",
);

export type ParsedFrequency = { kind: "supported"; ttl: FeedTtl } | { kind: "unsupported" };

export type TopicCandidate = {
  slug: string;
  // Inclusive token span in the message; existing draft topics that the
  // message does not mention have no span.
  span: readonly [number, number] | null;
};

export type TurnCandidates = {
  topics: TopicCandidate[];
  usernames: string[];
  repositories: string[];
  firstCount: number | null;
  frequency: ParsedFrequency | null;
};

const isTtl = (value: number): value is FeedTtl => FEED_TTLS.some((ttl) => ttl === value);

const parseNumber = (raw: string): number | null => {
  const normalized = raw.toLowerCase();
  const value = normalized in NUMBER_WORDS ? NUMBER_WORDS[normalized] : Number(normalized);

  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
};

const unitSeconds = (raw: string): number | null => {
  const unit = raw.toLowerCase().replace(/s$/u, "");

  return UNIT_SECONDS[unit] ?? null;
};

const toFrequency = (seconds: number): ParsedFrequency =>
  isTtl(seconds) ? { kind: "supported", ttl: seconds } : { kind: "unsupported" };

// Arithmetic stays in code: Jev is unreliable at numeric conversion. The
// composer consumes this only when Jev judges that a frequency was stated.
export const parseFrequency = (message: string): ParsedFrequency | null => {
  const quantified = QUANTIFIED_DURATION.exec(message);

  if (quantified?.[1] !== undefined && quantified[2] !== undefined) {
    const count = parseNumber(quantified[1]);
    const seconds = unitSeconds(quantified[2]);

    if (count !== null && seconds !== null) {
      const interval = TWICE.test(message) ? (count * seconds) / 2 : count * seconds;

      return toFrequency(interval);
    }
  }

  const every = EVERY_UNIT.exec(message);

  if (every?.[1] !== undefined) {
    const seconds = unitSeconds(every[1]);

    if (seconds !== null) {
      return toFrequency(seconds);
    }
  }

  for (const [pattern, seconds] of ADVERB_SECONDS) {
    if (pattern.test(message)) {
      return toFrequency(seconds);
    }
  }

  return null;
};

export const parseFirstCount = (message: string): number | null => {
  const match = FIRST_COUNT.exec(message);

  if (match?.[1] === undefined) {
    return null;
  }

  const count = parseNumber(match[1]);

  return count !== null && Number.isInteger(count) && count >= 1 && count <= 25 ? count : null;
};

const withoutRepositories = (message: string, repositories: readonly string[]): string =>
  repositories.reduce((text, repository) => text.replaceAll(repository, " "), message);

const topicTokens = (message: string): string[] =>
  (message.toLowerCase().match(/[a-z0-9][a-z0-9-]*/gu) ?? []).map((token) =>
    token.replace(/-+$/u, ""),
  );

export const topicCandidates = (
  message: string,
  existingTopics: readonly string[],
  repositories: readonly string[],
): TopicCandidate[] => {
  const tokens = topicTokens(withoutRepositories(message, repositories));
  const bySlug = new Map<string, TopicCandidate>();

  for (let start = 0; start < tokens.length; start += 1) {
    for (
      let length = 1;
      length <= MAX_TOPIC_NGRAM && start + length <= tokens.length;
      length += 1
    ) {
      const words = tokens.slice(start, start + length);

      if (words.some((word) => TOPIC_STOP_WORDS.has(word) || /^\d+$/u.test(word))) {
        break;
      }

      const slug = words.join("-");

      if (TOPIC_SLUG.test(slug) && !bySlug.has(slug)) {
        bySlug.set(slug, { slug, span: [start, start + length - 1] });
      }
    }
  }

  const fromMessage = [...bySlug.values()].slice(0, MAX_TOPIC_CANDIDATES);
  const unmentioned = existingTopics
    .filter((slug) => !bySlug.has(slug))
    .map((slug): TopicCandidate => ({ slug, span: null }));

  return [...fromMessage, ...unmentioned];
};

export const usernameCandidates = (message: string, repositories: readonly string[]): string[] => {
  const words = withoutRepositories(message, repositories).split(/\s+/u);
  const candidates = new Set<string>();

  for (const word of words) {
    const token = word
      .replace(/^[^A-Za-z0-9]+/u, "")
      .replace(/['’]s$/iu, "")
      .replace(/[^A-Za-z0-9]+$/u, "");

    if (
      token.length > 0 &&
      USERNAME_PATTERN.test(token) &&
      !FUNCTION_WORDS.has(token.toLowerCase())
    ) {
      candidates.add(token);
    }
  }

  return [...candidates].slice(0, MAX_USERNAME_CANDIDATES);
};

export const candidatesFor = (
  message: string,
  existingTopics: readonly string[],
): TurnCandidates => {
  const repositories = extractExplicitRepositoryNames(message);

  return {
    topics: topicCandidates(message, existingTopics, repositories),
    usernames: usernameCandidates(message, repositories),
    repositories,
    firstCount: parseFirstCount(message),
    frequency: parseFrequency(message),
  };
};
