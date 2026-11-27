# Studios: one hub per client, on any provider

Status: ready to build. Nothing is open. Collaboration slice 7 (email sign-in) waits until this plan has shipped, and is then built on studio people.

Read before building: `AGENTS.md` (root and `packages/design-hub/`), and in `collaboration.md` sections 10 to 13, which record how the gate, the session, the store and the build boundary work today. This plan changes those; it does not repeat them.

## 1. Goal

Today one project is one Vercel project, one store, one address and one people list. After this plan:

| Must be true | Proved by |
| --- | --- |
| A client signs in once and sees every project they have with the studio | Deployed walkthrough: one link, the client's hub lists their projects, each opens |
| No client reaches another client's anything | Service and gate tests: a session for client A, on client B's host or naming B's ids, gets the same 404 or `not_found` as an unknown id, on every op; A's token never verifies on B's host |
| Two studios share nothing | Two deployed studios have no secret, store, account or env var in common |
| Any apex domain works | Setup passes on Vercel DNS (wildcard), Cloudflare DNS (API), and any other provider (a record printed for a person to add) |
| A studio picks its database | One conformance suite over `KV` passes for every adapter; the gate and service suites run on each |
| A new client takes one command | `design-hub client add` makes the client, its address and DNS record, and prints the first sign-in link |

## 2. Rules

| # | Rule |
| --- | --- |
| S1 | A **studio** is the tenant: one hosting account, one database, one file store, one `GATE_SECRET`, one apex domain. Studios share nothing. |
| S2 | A studio has **clients**; a client has **projects**. A Client person belongs to one client and sees every project of it. A Studio person sees every client. |
| S3 | A client's address is `<client>.<apex>`; a project is `/<project>/` below it. Studio people use `studio.<apex>`. Never one address or sign-in per project. |
| S4 | No account across studios. A person in two studios is two records. A machine keeps a local list of its studios. |
| S5 | The client boundary is code: the client is in every store key, signed into the session, and checked against the request's host on every request, in the gate and again in every function. No function trusts a header the gate set. |
| S6 | One **studio site** per studio serves everything: the gate, the review API, each client's hub, the studio hub and every project's files. A project stays its own repo and publishes its build into the studio. |
| S7 | Providers sit behind four ports: database (`KV`), files (`Files`), host, DNS. First adapters: Upstash; Vercel Blob (private); Vercel host; Vercel DNS, Cloudflare DNS, manual. Then Postgres (Neon, Supabase, any Postgres). |
| S8 | One database and one file store per studio, never per project. |
| S9 | With per-host DNS a client's subdomain is public (certificate logs). `client add` says so and takes `--host <codename>`. A wildcard logs only `*.<apex>`. |
| S10 | A host that is not a known client gets the same 404 as an unknown path. A client host never serves anything that lists other clients. A signed-out page on a client host is today's sign-in page, word for word, with no client name on it. |
| S11 | Start clean. No migration code. `carbon-signal-design` and `hub-e2e` keep no links, sign-ins, people or comments; Carbon Signal is shared again into the Suits & Sandals studio and its people added again. |
| S12 | Studio is the only deployed mode once slice 5 ships. `bootstrap --vercel` and `--review` are removed, not kept beside it. `design-hub dev` stays as it is: no gate, the local store. |
| S13 | Default access length resolves person, then client, then studio, then `3m`. |
| S14 | A studio runs on free plans: Vercel Hobby, Upstash free, Vercel Blob free. No feature may need a paid plan. Design Hub is a free tool, and a client only comes in to comment. |

## 3. Settled designs

These were the open questions. Build them as written.

**How a build reaches the studio (was Q1).** `share` builds the project with base `/<project>/` and uploads `dist/` to the studio's file store under `c/<client>/<project>/<build>/…`, where `<build>` is a new id per share. When every file is up, it writes `<build>` on the project's record. The studio site reads that pointer and serves the file through the `Files` port. So a share is atomic, a half-finished upload is never served, and the last 3 builds are kept and older ones deleted. No project has a deployment of its own.

**The studio site** is a thin folder, like a project: one-line entry files that import from the package, a `vercel.json`, a `studio.json` (slug, apex, providers; no secrets) and a gitignored env file. `studio create --dir <path>` scaffolds it from `templates/studio/` and deploys it. Its hub pages (client hub, studio hub) are built from `shell/`. A package upgrade reaches it by `design-hub studio deploy`.

**A project knows its place** from `.design-hub/studio.json` (studio slug, client, project), written by `project link` and committed. The machine finds the studio folder, and so its credentials, through `~/.design-hub/studios.json`.

**Cost per request.** The host-to-client lookup is cached in memory for 60 seconds per instance, so archiving a client takes effect within 60 seconds. The session check stays at one store read per 5 minutes. A file is served with an `ETag` and `private, no-cache`, so a repeat load is a 304.

**Before sign-in (was Q5).** Nothing beyond today's page (S10).

**Personal studio's account (was Q3).** Miles's own paid Vercel account, separate from `sas-team`. Nothing to buy.

**Names that are never a slug.** Client: `studio`, `www`, `api`. Project and prototype: every first path segment the gate answers (`invite`, `api`, `_gate`, `_p`, `assets`, `guide`, `index.html`, `favicon.svg`).

## 4. Contracts

```ts
// core/review/model.ts
type Client  = { slug: string; host: string; name: string; access: Access | null; createdAt: string; archivedAt: string | null };
type Project = { slug: string; client: string; name: string; build: string | null; createdAt: string };
type Person  = { /* as today */ client: string | null };      // null: Studio, every client
type Scope   = { client: string; project?: string };

// core/review/policy.ts
function inScope(actor: Person, scope: Scope): boolean;       // Studio, or actor.client === scope.client
// can() calls inScope first. Out of scope answers not_found, the same as an unknown id, never forbidden.

// core/review/store.ts: prefix hub4:, every key built from a scope by one function
//   studio:  studio:people, studio:revoked, studio:epochs, studio:links, studio:settings, clients, hosts
//   client:  c:<client>:people, :revoked, :epochs, :links, :projects
//   project: c:<client>:p:<project>:audiences, :counters, :comments:<prototype>, :controls:<prototype>
// Field shapes inside each key do not change (dial:<id>, variant:<name>, <prototype>:internal).

// core/review/service.ts: every method takes a Scope. The API builds it from the host and the `project` parameter.

// server/session.ts
type Gate = { secret: string; site: string; client: string | 'studio' };
// p5.<id>.<epoch>.<kind>.<client>.<expires>.<checkedAt>.<sig>, client signed. Cookie stays __Host-, host-only.
// p4 and older never verify (S11).

// ports
interface KV    { /* as today: hget, hset, hdel, hgetall, hincrby, sadd, smembers */ }
interface Files { put(path, body, type): Promise<void>; get(path): Promise<{ body; type; etag } | null>; list(prefix): Promise<string[]>; remove(paths): Promise<void> }
interface Dns   { mode: 'wildcard' | 'per-host' | 'manual'; ensure(host: string): Promise<'added' | 'exists' | { record: string }> }
interface Host  { link; setSecret; deploy; addDomain; provisionDatabase; provisionFiles }   // scripts only

// core/prototype.ts: the one place a path is read
function routeOf(host: string, pathname: string): Route;      // replaces prototypeOfPath; keeps its fail-closed path rules
```

Request flows:

- **`acme.<apex>/rebrand/x`.** Host names client `acme`; unknown or archived is the plain 404. Session: the token must be signed to `acme`, or be Studio's. Stale token: the store check as today, which also compares `person.client`. `routeOf`: project `rebrand` must belong to `acme`; the prototype audience is checked as today. Then the file is read from `c/acme/rebrand/<build>/…`.
- **Studio opens a client.** `studio.<apex>` writes a one-time handoff record (one client, 60 seconds) and redirects to `<client>.<apex>/_gate/handoff/<token>`. The client host claims it with `hdel`, as a link is claimed, and sets its own Studio cookie.
- **Any API op.** `actorFrom`, then `Scope` from host and `project`, then the service, where `inScope` and `can` decide.

The `KV` port stays Redis-shaped. Postgres is one table `(key, field, value)`: `hincrby` is `UPDATE … RETURNING`, `hdel` returns its row count. Cloudflare KV cannot claim a link atomically, so it is never an adapter.

Archiving a client or deleting a project removes its keys and its files, so a slug used again starts clean.

## 5. Slices

Each slice works end to end and leaves `pnpm check`, `pnpm test` and `pnpm quality` green. One commit per package, on main. A slice over 3,000 changed lines is split before it is built. Test deployments go in `sas-team` only, never `o-linn-team`.

Releases: slices 2 to 4 are committed but not published, since each alone would sign every deployed person out for no gain. Publish after slice 5 (the first release a project can use), after 6, and after 7. Both packages publish at one version.

| # | Delivers | Checks that must pass | Files |
| --- | --- | --- | --- |
| 1 | Learning tests, output kept in `docs/plans/studios-findings.md`: (a) a private Vercel Blob store read and streamed by a function behind middleware, with timings; (b) a wildcard domain on a Vercel DNS apex; (c) a per-host domain on Cloudflare through its API. | (a) passes if the store is unreadable without the token and a 200 KB file's median first byte is under 400 ms. Every test also records whether it worked on a Hobby account (S14). If (a) fails, or anything needs a paid plan, stop and ask Miles (section 7). | scratch projects in `sas-team` |
| 2 | The scoped store and rules: `hub4:` keys, `Scope` on every service method, `Person.client`, `inScope`, the `p5` token, the reserved names. A site still runs as one fixed client and project. | `policy` table with the scope row; `service.test.ts`: every op from a client-A actor on a client-B scope answers like an unknown id; `session.test.ts`: A's token fails on B; a `KV` conformance suite on the memory store and the fake Upstash; `design-hub new invite` is refused | `core/review/*`, `core/prototype.ts`, `server/{api,session,local}.ts` |
| 3 | The hub under a base path: the API path, `/_p/`, the registry base and every `href="/"` in `shell/` become relative to the build's base. | The build tests (`REFUSED`, `LEAKS`, `BUILDS`) pass with base `/x/`; a base of `/` builds byte for byte as before | `shell/*`, `vite/*`, `core/prototype.ts` |
| 4 | The studio site: `templates/studio/`, the gate by host, `routeOf`, the `Files` port with the Vercel Blob adapter and an in-memory one, files served by build pointer, the client hub listing projects, the API scoped by host. One test studio in `sas-team` with two clients, set up by hand with scripts the findings file records. | `proxy.test.ts`: unknown host is 404; a cross-client cookie is the sign-in page; another client's project is 404; a file of a build that is not the pointer's is 404; the files function alone, without the gate in front, refuses the same requests | `vercel/*`, `server/*`, `core/*`, `shell/*`, `templates/studio/` |
| 5 | The commands: `studio create | deploy | link`, `client add | archive | access`, `project link`, `share` into a studio, the studio list, the DNS adapters, `bootstrap`'s deploy flags removed. Carbon Signal moved into the Suits & Sandals studio (S11). Docs and skills follow. **Publish.** | One test per command with a fake host, DNS and file store; `share` keeps 3 builds; `release-check`; the deployed walkthrough in section 1 | `scripts/*`, `scripts/lib/*`, `skills/miles-deploy`, `template/`, `SCRIPTS` in `scripts/skills.ts`, `docs/guide/sharing.md` |
| 6 | The studio hub on `studio.<apex>`: every client, their people and projects, the People tab per client, the handoff. **Publish.** | `proxy.test.ts`: a handoff works once, only on its client host, and not after 60 seconds; a Client cookie on `studio.<apex>` is the sign-in page | `shell/*`, `vercel/*`, `server/session.ts` |
| 7 | The ports opened: the gate free of `@vercel/functions` behind a thin Vercel adapter, the host port in `scripts/`, the Postgres adapter. A second studio on `milesroxas.com` on its own account. **Publish.** | The `KV` conformance, gate and service suites pass on Postgres; listing both studios' env vars shows nothing in common | `server/stores/*`, `vercel/*`, `scripts/lib/*` |

Shipped: slice 1. All three tests passed on paid teams; the record is `studios-findings.md`, to be read before slices 4, 5 and 7. Decided in the build: test (b) ran one level below the apex, as `*.dh-test.milesroxas.com` on the personal account, because `sas-team` holds no apex on Vercel DNS; nothing ran on a free account, since none exists, so every S14 answer is from Vercel's docs; Miles decided S14 stands although Vercel's free plan is for "personal or non-commercial use". Found, and not yet in this plan's contracts: no function receives `If-None-Match` on a GET, so the gate must relay it and the files function must answer the 304 itself from an etag built from the path, compared weakly; a 304 drops the gate's headers and its reissued cookie; a build id must never recur for the life of the store; a signed-in request can pin a deployment up to 12 hours old, so `studio deploy` must put older ones out of reach; on a free plan about 45 shares and about 9,000 full project views a month.

## 6. How it is built

One orchestrator (Fable 5.2, medium) runs one slice at a time and writes no product code itself.

1. **Build.** Spawn one builder (Opus 5.5, high) with: this file, the slice's row, and the sections of `collaboration.md` it changes. The builder runs the three checks and reports what it built and what it could not.
2. **Review.** Spawn one reviewer (Fable 5.2, high) in fresh context with the slice's diff and this file, not the builder's report. It hunts for the slice's risk below and reports findings ranked by harm, each with a failing input.
3. **Fix.** For each real finding, spawn a fixer (Opus 5.5) with that finding alone. Each fix adds a test that failed before it.
4. **Review again** until a round finds nothing that crosses a boundary. Slices 2, 4 and 6 need two clean rounds. Then commit.

**UI work.** Slices 4 and 6 build new screens (the client hub, the studio hub, the People tab per client), and slice 3 touches the hub's links. Any builder or fixer that adds or changes UI loads Emil's skills before writing it (`emil-design-foundations`, `emil-component-design`, `emil-ui-polish`, and whichever others fit), and the reviewer runs `emil-ui-review` on the result beside its security hunt. An agent unsure which skill fits loads `emil-ask-emil`, which routes to the right one. The orchestrator says this in every brief for a slice with UI. New screens are built on `kit/ui` and the hub's own system look, as `shell/` is today.

| Slice | The reviewer hunts for |
| --- | --- |
| 2 | A service read or write path that skips the scope; a key built outside the one key function |
| 3 | A path left absolute; a changed byte in a base `/` build |
| 4 | Any way a host, path, cookie or direct function call reaches another client's project, file or comment |
| 5 | A command that touches the wrong studio or team; a secret printed or committed |
| 6 | A handoff used twice, late, or on another host; a Client reaching the studio host |
| 7 | An op that is atomic on Upstash and not on Postgres |

## 7. Working with Miles

- Every question to Miles goes through the question UI, never as prose. At most two per stop, the recommended option first.
- Write each question for someone who does not know the code: say what he will notice and what it costs, in one or two short sentences. No file names, function names or product plumbing words.
- Never ask Miles to read code, a diff or a long report. A report to him is three lines: is it done, is it safe, what is needed from him.
- Make engineering choices without asking. Ask only for: spending money, creating or deleting anything on an account, a domain or DNS change, publishing a release, and anything that changes what a client or Miles sees on screen.
- A secret or login only Miles has (the Cloudflare token for `suits-sandals.com`, an npm publish confirmation) is asked for through the secret prompt, at the slice that needs it.
- Anything found that is outside the current slice goes to the backlog with the `design-hub-capture` skill, then work continues. One line reports it.
- No dates in anything written.
