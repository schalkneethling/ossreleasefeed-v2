import { Schema } from "effect";

const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const GithubUsernameSchema = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/, {
    message: () => "Invalid GitHub username",
  }),
);

export const TopicSlugSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9-]*$/, {
    message: () => "Invalid GitHub topic slug",
  }),
  Schema.maxLength(35),
);

export const UrlStringSchema = Schema.String.pipe(
  Schema.nonEmptyString(),
  Schema.filter((value) => isUrl(value), {
    message: () => "Expected a valid URL",
  }),
);

export const RepoFullNameSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, {
    message: () => "Expected an owner/repo value",
  }),
);

export const FeedConfigSchema = Schema.Union(
  Schema.Struct({
    source: Schema.Literal("topics"),
    topics: Schema.Array(TopicSlugSchema).pipe(Schema.minItems(1), Schema.maxItems(5)),
    topicOperator: Schema.optionalWith(Schema.Literal("and", "or"), {
      default: () => "or" as const,
    }),
    activityType: Schema.Literal("releases", "all"),
    ttl: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(3600)),
    format: Schema.optionalWith(Schema.Literal("atom", "json"), {
      default: () => "atom" as const,
    }),
  }),
  Schema.Struct({
    source: Schema.Literal("starred"),
    username: GithubUsernameSchema,
    repos: Schema.optionalWith(
      Schema.NullOr(Schema.Array(RepoFullNameSchema).pipe(Schema.maxItems(25))),
      {
        default: () => null,
      },
    ),
    activityType: Schema.Literal("releases", "all"),
    ttl: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(3600)),
    format: Schema.optionalWith(Schema.Literal("atom", "json"), {
      default: () => "atom" as const,
    }),
  }),
);

export type FeedConfig = Schema.Schema.Type<typeof FeedConfigSchema>;

export const FeedEntrySchema = Schema.Struct({
  id: UrlStringSchema,
  link: UrlStringSchema,
  title: Schema.NonEmptyString,
  summary: Schema.String,
  date: Schema.Date,
  authorLogin: Schema.NonEmptyString,
  repo: RepoFullNameSchema,
  entryType: Schema.Literal("release", "issue", "pull_request"),
});

export type FeedEntry = Schema.Schema.Type<typeof FeedEntrySchema>;

export const TopicSchema = Schema.Struct({
  name: TopicSlugSchema,
  display_name: Schema.NullOr(Schema.String),
  short_description: Schema.NullOr(Schema.String),
});

export const TopicSearchResponseSchema = Schema.Struct({
  items: Schema.Array(TopicSchema),
});

export type Topic = Schema.Schema.Type<typeof TopicSchema>;

export const RepoSchema = Schema.Struct({
  full_name: RepoFullNameSchema,
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  stargazers_count: Schema.Number.pipe(Schema.int()),
  owner: Schema.Struct({
    login: Schema.NonEmptyString,
  }),
});

export type Repo = Schema.Schema.Type<typeof RepoSchema>;

export const RepoSearchResponseSchema = Schema.Struct({
  items: Schema.Array(RepoSchema),
});

export const UserSchema = Schema.Struct({
  login: Schema.NonEmptyString,
});

export const IssueSchema = Schema.Struct({
  html_url: UrlStringSchema,
  title: Schema.NonEmptyString,
  body: Schema.NullOr(Schema.String),
  updated_at: Schema.String,
  user: UserSchema,
  pull_request: Schema.optional(Schema.Unknown),
});

export type Issue = Schema.Schema.Type<typeof IssueSchema>;
