import { FeedParseError } from "../lib/errors";
import type { FeedEntry } from "../lib/schemas";
import { sanitiseHtml } from "./sanitize";
import sax from "sax";

type PartialEntry = {
  authorLogin?: string;
  date?: string;
  link?: string;
  summary?: string;
  title?: string;
};

type EntryContext = {
  current: PartialEntry | null;
  insideAuthor: boolean;
};

type EntryParserOptions<T> = {
  onEntryStart?: () => void;
  onOpenTag?: (
    node: { name: string; attributes: Record<string, string> },
    context: EntryContext,
  ) => void;
  onValue: (name: string, value: string, context: EntryContext) => void;
  onEntry: (entry: PartialEntry) => T | null;
};

const normalizeText = (value: string | undefined): string => value?.trim() ?? "";

const parseDate = (value: string, url: string): Date => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new FeedParseError({
      url,
      cause: new Error(`Invalid date: ${value}`),
    });
  }

  return date;
};

const parseEntries = <T>(xml: string, url: string, options: EntryParserOptions<T>): T[] => {
  const parser = sax.parser(true, { lowercase: true, trim: false });
  const entries: T[] = [];
  const context: EntryContext = {
    current: null,
    insideAuthor: false,
  };
  let currentText = "";

  parser.onopentag = (node) => {
    currentText = "";

    if (node.name === "entry") {
      context.current = {};
      context.insideAuthor = false;
      options.onEntryStart?.();
      return;
    }

    if (!context.current) {
      return;
    }

    if (node.name === "author") {
      context.insideAuthor = true;
      return;
    }

    options.onOpenTag?.(node, context);
  };

  parser.ontext = (text) => {
    currentText += text;
  };

  parser.oncdata = (text) => {
    currentText += text;
  };

  parser.onclosetag = (name) => {
    if (!context.current) {
      return;
    }

    const value = normalizeText(currentText);

    if (name === "author") {
      context.insideAuthor = false;
    } else {
      options.onValue(name, value, context);
    }

    if (name === "entry") {
      const entry = options.onEntry(context.current);

      if (entry) {
        entries.push(entry);
      }

      context.current = null;
      context.insideAuthor = false;
    }

    currentText = "";
  };

  parser.onerror = (error) => {
    throw new FeedParseError({ url, cause: error });
  };

  parser.write(xml).close();

  return entries;
};

export const parseGitHubReleaseAtom = async (
  xml: string,
  repo: string,
  url: string,
): Promise<FeedEntry[]> => {
  const entries = parseEntries(xml, url, {
    onOpenTag(node, context) {
      if (
        node.name === "link" &&
        node.attributes.rel === "alternate" &&
        typeof node.attributes.href === "string" &&
        context.current
      ) {
        context.current.link = node.attributes.href;
      }
    },
    onValue(name, value, context) {
      if (!context.current) {
        return;
      }

      if (context.insideAuthor && name === "name") {
        context.current.authorLogin = value;
      } else if (name === "title") {
        context.current.title = value;
      } else if (name === "updated") {
        context.current.date = value;
      } else if (name === "content") {
        context.current.summary = value;
      }
    },
    onEntry(entry) {
      if (!entry.link || !entry.title || !entry.date || !entry.authorLogin) {
        return null;
      }

      return {
        id: entry.link,
        link: entry.link,
        title: entry.title,
        summary: entry.summary ? entry.summary : "",
        date: parseDate(entry.date, url),
        authorLogin: entry.authorLogin,
        repo,
        entryType: "release" as const,
      };
    },
  });

  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      summary: await sanitiseHtml(entry.summary),
    })),
  );
};

export const parseCachedFeed = (xml: string, url: string): FeedEntry[] => {
  let entryType: FeedEntry["entryType"] = "release";

  return parseEntries(xml, url, {
    onEntryStart() {
      entryType = "release";
    },
    onOpenTag(node, context) {
      if (node.name === "link" && typeof node.attributes.href === "string" && context.current) {
        context.current.link = node.attributes.href;
      }
    },
    onValue(name, value, context) {
      if (!context.current) {
        return;
      }

      if (context.insideAuthor && name === "name") {
        context.current.authorLogin = value;
      } else if (name === "title") {
        context.current.title = value;
        if (value.includes("PR:")) {
          entryType = "pull_request";
        } else if (value.includes("Issue:")) {
          entryType = "issue";
        }
      } else if (name === "updated") {
        context.current.date = value;
      } else if (name === "summary" || name === "content") {
        context.current.summary = value;
      }
    },
    onEntry(entry) {
      if (!entry.link || !entry.title || !entry.date || !entry.authorLogin) {
        return null;
      }

      const repoMatch = entry.title.match(/^\[([^\]]+)\]/u);

      return {
        id: entry.link,
        link: entry.link,
        title: entry.title.replace(/^\[[^\]]+\]\s+(Release|PR|Issue):\s*/u, ""),
        summary: entry.summary ? entry.summary : "",
        date: parseDate(entry.date, url),
        authorLogin: entry.authorLogin,
        repo: repoMatch ? repoMatch[1] : "unknown/unknown",
        entryType,
      };
    },
  });
};
