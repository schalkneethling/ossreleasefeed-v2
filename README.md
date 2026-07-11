# OSSReleaseFeed

A lightweight, zero-authentication tool for building personalised Atom feeds from GitHub open source activity.

Provide a GitHub username or a set of topics, configure your preferences, and get a single permanent feed URL you can drop into any feed reader. No account, no OAuth, no email — just a URL that works.

## What it does

- **Topic feeds** — follow all releases across repositories tagged with one or more GitHub topics
- **Starred repo feeds** — follow releases from everything you've starred on GitHub
- **Atom & JSON Feed** — output in whichever format your feed reader prefers

## Status

In public beta. Things may still change, and you may hit rough edges — please
[report an issue](https://github.com/schalkneethling/ossreleasefeed-v2/issues)
if you do (there's also a link in the app's footer).

## Tech

- **Frontend:** React 19, Vite, standard CSS — hosted on Cloudflare Pages
- **Backend:** Cloudflare Worker, Hono, Effect, TypeScript

## Contributing

Beta is out, but there's no formal contribution process yet — code PRs
aren't being accepted for now. Bug reports and feedback via
[issues](https://github.com/schalkneethling/ossreleasefeed-v2/issues) are
very welcome.

## License

[MIT License](LICENSE)
