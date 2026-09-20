import { REPO_FULL_NAME_PATTERN } from "../lib/schemas";

export const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,34}$/u;
export const USERNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/u;

const REPO_FULL_NAME_CANDIDATE_PATTERN =
  /(?:^|[^A-Za-z0-9_./-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?=$|[^A-Za-z0-9_./-])/gu;

export const extractExplicitRepositoryNames = (message: string): string[] => {
  const candidates = [...message.matchAll(REPO_FULL_NAME_CANDIDATE_PATTERN)].map(
    (match) => match[1],
  );

  return [
    ...new Set(
      candidates.filter(
        (candidate): candidate is string =>
          candidate !== undefined && REPO_FULL_NAME_PATTERN.test(candidate),
      ),
    ),
  ];
};
