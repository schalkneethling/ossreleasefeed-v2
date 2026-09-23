import { describe, expect, it } from "vitest";
import {
  BARE_REPOSITORY_INCLUDE_THRESHOLD,
  bareRepositoryMatches,
  bareRepositoryQuestionId,
  bareTokens,
  buildBareRepositoryRequest,
  MAX_BARE_REPOSITORY_CANDIDATES,
  MAX_BARE_REPOSITORY_JUDGMENTS,
  resolveBareRepositories,
  selectJudgedRepositories,
  type BareRepositoryMatch,
} from "../../worker/src/assistant/interpreter/jev/bare-repos";
import type { JevAnswer } from "../../worker/src/assistant/interpreter/jev/types";

const STARRED = [
  "facebook/react",
  "vitejs/vite",
  "vitest-dev/vitest",
  "remix-run/react-router",
  "vercel/next.js",
  "socketio/socket.io",
  "golang/go",
  "octocat/Hello-World",
];

const noul = (probability: number): JevAnswer => ({ type: "noul", noul: probability });

describe("bareTokens", () => {
  it("lowercases and keeps hyphens, dots, and underscores inside a word", () => {
    expect(bareTokens("Just React-Router, next.js and my_lib!")).toEqual([
      "just",
      "react-router",
      "next.js",
      "and",
      "my_lib",
    ]);
  });

  it("drops trailing separators and possessives", () => {
    expect(bareTokens("the vitest's one, react.")).toEqual(["the", "vitest", "s", "one", "react"]);
  });

  it("removes explicit owner/repo names before tokenising", () => {
    expect(bareTokens("facebook/react and vite")).toEqual(["and", "vite"]);
  });
});

describe("bareRepositoryMatches", () => {
  it("matches exact repository names in document order", () => {
    expect(bareRepositoryMatches("just vitest and vite", STARRED)).toEqual([
      { repo: "vitest-dev/vitest", token: "vitest", exact: true },
      { repo: "vitejs/vite", token: "vite", exact: true },
    ]);
  });

  it("ignores stop words even when a repository is named after one", () => {
    expect(bareRepositoryMatches("the one and only, go with all of them", STARRED)).toEqual([]);
  });

  it("matches a name with its separators removed as a near match", () => {
    expect(bareRepositoryMatches("reactrouter please", STARRED)).toEqual([
      { repo: "remix-run/react-router", token: "reactrouter", exact: false },
    ]);
  });

  it("matches a separated part of a name as a near match", () => {
    expect(bareRepositoryMatches("react", STARRED)).toEqual([
      { repo: "facebook/react", token: "react", exact: true },
      { repo: "remix-run/react-router", token: "react", exact: false },
    ]);
    expect(bareRepositoryMatches("hello", STARRED)).toEqual([
      { repo: "octocat/Hello-World", token: "hello", exact: false },
    ]);
  });

  it("never matches the js part of a dotted name", () => {
    expect(bareRepositoryMatches("js", STARRED)).toEqual([]);
  });

  it("joins adjacent words so 'react router' reaches react-router", () => {
    expect(bareRepositoryMatches("react router", STARRED)).toEqual([
      { repo: "facebook/react", token: "react", exact: true },
      { repo: "remix-run/react-router", token: "react", exact: false },
    ]);
    expect(bareRepositoryMatches("hello world", STARRED)).toEqual([
      { repo: "octocat/Hello-World", token: "hello", exact: false },
    ]);
    expect(bareRepositoryMatches("socket io", STARRED)).toEqual([
      { repo: "socketio/socket.io", token: "socket", exact: false },
    ]);
  });

  it("matches a name with its .js suffix dropped", () => {
    expect(bareRepositoryMatches("next and socketio", STARRED)).toEqual([
      { repo: "vercel/next.js", token: "next", exact: false },
      { repo: "socketio/socket.io", token: "socketio", exact: false },
    ]);
  });

  it("treats the full dotted name as exact", () => {
    expect(bareRepositoryMatches("only next.js", STARRED)).toEqual([
      { repo: "vercel/next.js", token: "next.js", exact: true },
    ]);
  });

  it("matches an owner as a near match", () => {
    expect(bareRepositoryMatches("everything from vercel", STARRED)).toEqual([
      { repo: "vercel/next.js", token: "vercel", exact: false },
    ]);
  });

  it("is case-insensitive against the starred list", () => {
    expect(bareRepositoryMatches("hello-world", STARRED)).toEqual([
      { repo: "octocat/Hello-World", token: "hello-world", exact: true },
    ]);
  });

  it("never counts a repository named explicitly as owner/repo", () => {
    expect(bareRepositoryMatches("facebook/react and vite", STARRED)).toEqual([
      { repo: "vitejs/vite", token: "vite", exact: true },
    ]);
  });

  it("never treats the feed's username as a repository mention", () => {
    expect(bareRepositoryMatches("octocat", STARRED, { username: "octocat" })).toEqual([]);
    expect(bareRepositoryMatches("octocat", STARRED)).toEqual([
      { repo: "octocat/Hello-World", token: "octocat", exact: false },
    ]);
  });

  it("lists every repository a token fits, once each", () => {
    const starred = [...STARRED, "someone/next"];

    expect(bareRepositoryMatches("next next", starred)).toEqual([
      { repo: "vercel/next.js", token: "next", exact: false },
      { repo: "someone/next", token: "next", exact: true },
    ]);
  });

  it("ignores bare numbers and malformed starred entries", () => {
    expect(bareRepositoryMatches("the first 10", ["10", "/x", "y/", "vitejs/vite"])).toEqual([]);
  });

  it("caps the candidates by document order", () => {
    const starred = Array.from({ length: 60 }, (_, index) => `owner/repo${index}`);
    const message = starred.map((name) => name.slice("owner/".length)).join(" ");
    const matches = bareRepositoryMatches(message, starred);

    expect(matches).toHaveLength(MAX_BARE_REPOSITORY_CANDIDATES);
    expect(matches[0]?.repo).toBe("owner/repo0");
    expect(matches.at(-1)?.repo).toBe(`owner/repo${MAX_BARE_REPOSITORY_CANDIDATES - 1}`);
  });
});

describe("resolveBareRepositories", () => {
  it("returns null without matches", () => {
    expect(resolveBareRepositories([])).toBeNull();
  });

  it("settles exact, one-to-one matches in code", () => {
    expect(resolveBareRepositories(bareRepositoryMatches("just vitest and vite", STARRED))).toEqual(
      { kind: "resolved", repos: ["vitest-dev/vitest", "vitejs/vite"] },
    );
  });

  it("is ambiguous when a token is also part of another starred name", () => {
    const matches = bareRepositoryMatches("just react and vite", STARRED);

    expect(resolveBareRepositories(matches)).toEqual({ kind: "ambiguous", candidates: matches });
  });

  it("is ambiguous when a token fits several repositories", () => {
    const matches: BareRepositoryMatch[] = [
      { repo: "facebook/react", token: "react", exact: true },
      { repo: "other/react", token: "react", exact: true },
    ];

    expect(resolveBareRepositories(matches)).toEqual({ kind: "ambiguous", candidates: matches });
  });

  it("is ambiguous when any match is not exact", () => {
    const matches = bareRepositoryMatches("vite and next", STARRED);

    expect(resolveBareRepositories(matches)).toEqual({ kind: "ambiguous", candidates: matches });
  });
});

describe("buildBareRepositoryRequest", () => {
  const candidates: BareRepositoryMatch[] = [
    { repo: "facebook/react", token: "react", exact: true },
    { repo: "remix-run/react-router", token: "react", exact: false },
  ];

  it("carries only the message and the candidates, with one Noul per candidate", () => {
    const request = buildBareRepositoryRequest("only react", candidates);

    expect(request.state).toEqual({
      user_message: { text: "only react" },
      starred_candidates: [
        { id: 0, full_name: "facebook/react" },
        { id: 1, full_name: "remix-run/react-router" },
      ],
    });
    expect(Object.keys(request.questions)).toEqual([
      bareRepositoryQuestionId(0),
      bareRepositoryQuestionId(1),
    ]);

    const question = request.questions[bareRepositoryQuestionId(1)];

    expect(question?.type).toBe("noul");
    expect(question?.instructions).toContain("`starred_candidates[1].full_name`");
    expect(question?.instructions).toContain("`remix-run/react-router`");
    expect(question?.instructions).toContain("`user_message.text`");
    expect(question?.criteria.true).toContain("remix-run/react-router");
    expect(question?.criteria.false).toContain("remix-run/react-router");
  });

  it("caps the judged candidates", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      repo: `owner/repo${index}`,
      token: `repo${index}`,
      exact: true,
    }));
    const request = buildBareRepositoryRequest("message", many);

    expect(request.state.starred_candidates).toHaveLength(MAX_BARE_REPOSITORY_JUDGMENTS);
    expect(Object.keys(request.questions)).toHaveLength(MAX_BARE_REPOSITORY_JUDGMENTS);
  });
});

describe("selectJudgedRepositories", () => {
  const candidates: BareRepositoryMatch[] = [
    { repo: "facebook/react", token: "react", exact: true },
    { repo: "remix-run/react-router", token: "react", exact: false },
    { repo: "vitejs/vite", token: "vite", exact: true },
  ];

  it("keeps candidates at or above the threshold and drops the rest", () => {
    expect(
      selectJudgedRepositories(candidates, {
        [bareRepositoryQuestionId(0)]: noul(BARE_REPOSITORY_INCLUDE_THRESHOLD),
        [bareRepositoryQuestionId(1)]: noul(BARE_REPOSITORY_INCLUDE_THRESHOLD - 0.01),
        [bareRepositoryQuestionId(2)]: noul(0.99),
      }),
    ).toEqual(["facebook/react", "vitejs/vite"]);
  });

  it("treats a missing or non-Noul answer as no", () => {
    expect(
      selectJudgedRepositories(candidates, {
        [bareRepositoryQuestionId(0)]: {
          type: "choice",
          choice: "yes",
          confidence: 1,
          probabilities: {},
        },
      }),
    ).toEqual([]);
  });
});
