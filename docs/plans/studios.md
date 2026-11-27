# Studios: one hub per client, on any provider

Status: proposed. Starts once slice 5 of `collaboration.md` is released, and builds on what that slice decided (its section 12). Collaboration slice 6 (dials) is independent of this plan. Collaboration slice 7 (email sign-in) waits for it, so it is built once, on studio people. Four points stay open (section 8).

## 1. Problem and success

Today one prototype project is one Vercel project, one site, one Upstash store and one address.

- A client with three projects gets three links, three sign-ins and three people lists. A hub should show a client all their work in one place.
- A store per project hits the Upstash free plan's limit of 1 database at the second project. Pay as you go has 10 free, then $0.50 a month each.
- Setup, deploy, the gate and the store all assume Vercel. A studio on Cloudflare, or with Neon or Supabase as its database, cannot use Design Hub.
- Nothing separates two studios except remembering `--team`. Suits & Sandals work and personal side-project work need separate accounts, domains and data.

| It is working when | Measured by |
| --- | --- |
| A client signs in once and sees every project they have with the studio | Walkthrough: one link, then the client's hub lists their projects and each one opens |
| No client reaches another client's anything | Service and gate tests: a session for client A, on client B's address or naming B's ids, gets the same 404 or `not_found` as an unknown id, on every op; A's token on B's address never verifies |
| Two studios share nothing | Suits & Sandals on `suits-sandals.com` and a personal studio on `milesroxas.com` have no secret, store, account or env var in common |
| Any apex domain works | Setup passes on a domain on Vercel DNS, one on Cloudflare, and one on any other provider (manual record) |
| A studio picks its database | One conformance suite over the `KV` port passes for every adapter, and the gate and service suites run on each |
| A new client takes one command | `design-hub client add` makes the client, its address and its DNS record, and prints the first sign-in link |

## 2. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| S1 | A **studio** is the tenant: one hosting account, one database, one `GATE_SECRET`, one apex domain. Studios share nothing. | The hard boundary sits at the account. A personal studio can live on a different Vercel account than Suits & Sandals. |
| S2 | Inside a studio are **clients**, and each client has **projects**. A Client person belongs to one client and sees every project of that client. Studio people see every client. | A hub shows a client all their work. Studio runs every engagement. |
| S3 | Each client's address is `<client>.<apex>`; a project is `/<project>/` below it. Studio people use `studio.<apex>`. | One address per client reads better to the client than a path under a shared address, and the browser keeps each client's cookie on its own host. |
| S4 | No central account across studios. A person in two studios is two records. Studio people keep a local list of the studios they belong to. | A central identity service would be a hosted product to run. Clients only ever hold links. |
| S5 | The boundary between clients is enforced in code: the client is in every key, signed into the session, and checked against the request's host on every request. | One database holds every client of a studio. |
| S6 | One **studio site** sits in front: the gate, the review API, each client's hub and the studio hub. Projects stay separate repos and publish their build to the studio. | One sign-in per client host, and one review API over one store. |
| S7 | Providers sit behind three ports: database (`KV`), host (deploy and setup) and DNS. First adapters: Upstash; Vercel host; Vercel DNS, Cloudflare DNS and manual. Postgres comes next and covers Neon, Supabase and any Postgres. | A studio can choose its own providers. Building one adapter at a time keeps every release testable. |
| S8 | One database per studio, not per project. | About $0 a month for a studio, whatever its number of clients. |
| S9 | A client's subdomain is public when the DNS is per host: each certificate is logged in public certificate logs. Setup says so and offers a codename. A wildcard (Vercel DNS) logs only `*.<apex>`. | Confidential clients must not be listed by the setup itself. |
| S10 | A client host never serves a hub path that lists other clients. A host that is not a known client gets the same 404 as an unknown path. | A guessed subdomain confirms nothing. |
| S11 | Start clean, as D20 did: Carbon Signal (`carbon-signal-design`) and the test site `hub-e2e` keep none of their links, sign-ins, people or comments. Carbon Signal is shared again into the Suits & Sandals studio and its people are added again. | Miles: no need for either to survive the move. No migration code to write or test. |

## 3. Architecture

```
<client>.<apex>                         studio.<apex>
      │                                       │
      ▼                                       ▼
 Studio site: gate (host → client, session, audience) ── review API ── KV port ── Upstash | Postgres
      │
      ├─ /                       the client's hub: their projects
      ├─ /invite/<token>         sign-in, as today
      ├─ /api/review             scoped to this client
      └─ /<project>/…            that project's built files (slice 5 layout, under a base path)
```

| Component | Today | After |
| --- | --- | --- |
| `core/review/store.ts` | Flat `hub3:` keys, one store per site | `hub4:` keys from a scope: studio (`studio:people`, `studio:settings`, `clients`), client (`c:<client>:people`, `c:<client>:links`), project (`c:<client>:p:<project>:audiences`, `…:comments:<prototype>`, `…:counters`) |
| `core/review/model.ts` | `Person` without a client | `Person.client: string \| null` (null is Studio); new `Client` and `Project` |
| `core/review/policy.ts` | Rules by kind, ownership and audience | A scope check before the table: a Client whose client is not the request's gets `not_found` on everything |
| `core/review/service.ts` | One service per site | Every method takes a `Scope`; the API builds it from the host and the project |
| `server/session.ts` | `p4` token signed to the store URL | `p5` signed to the store URL and the client (or `studio`); the cookie stays host-only (`__Host-`). New: a one-time handoff, studio host to client host, that lasts 60 seconds |
| `vercel/proxy.ts` | Vercel middleware (`next()` from `@vercel/functions`), first segment is a slug | A provider-neutral `gate(request, ctx)` in the package core, with thin adapters per host. `prototypeOfPath` becomes `routeOf(host, path)`: client, project, prototype |
| `server/upstash.ts` | The only store | `server/stores/{upstash,postgres}.ts`, one conformance suite over `KV` |
| `shell/` | Assumes it is served from `/` (`API = '/api/review'` in `shell/review/client.ts`, `/_p/` in `core/prototype.ts`, base `/` in `vite/registry.ts`) | Served under `/<project>/`, every path relative to the base. New client hub page that lists projects |
| `scripts/` | `bootstrap` per project, Vercel CLI throughout | `studio create` once, `client add`, `project link`; `share` publishes into the studio; host and DNS adapters |
| Local registry | none | `~/.design-hub/studios.json`: each studio's slug, apex, providers and the account to use |

How a project's built files reach the studio site is open (Q1).

## 4. Program design

Only where rework is costly: stored shapes, the scope rule, sign-in and the ports.

```ts
// core/review/model.ts
type Client = { slug: string; name: string; createdAt: string; archivedAt: string | null };
type Project = { slug: string; client: string; name: string; createdAt: string };
type Person = { /* as today */ client: string | null };    // null: Studio, every client
type Scope = { client: string; project?: string };

// core/review/policy.ts
function inScope(actor: Person, scope: Scope): boolean;     // Studio, or actor.client === scope.client
// can() calls inScope first; out of scope reads as not_found, the same as an unknown id

// server/session.ts
type Gate = { secret: string; site: string; client: string | 'studio' };
// p5.<id>.<epoch>.<kind>.<client>.<expires>.<checkedAt>.<sig>, client signed

// the three ports
interface KV { /* as today: hget, hset, hdel, hgetall, hincrby, sadd, smembers */ }
interface Host { link; setSecret; deploy; addDomain; provisionDatabase }   // scripts only
interface Dns { mode: 'wildcard' | 'per-host' | 'manual'; ensure(host: string): Promise<'added' | 'exists' | { record: string }> }
function gate(request: Request, ctx: GateContext): Promise<Response | 'pass'>;
```

Call trees:

- **A request on `acme.<apex>/rebrand/x`.** Gate: the host names client `acme`; a client that is not in `clients` gets the plain 404. Then the session: the token must be signed to `acme` (or be Studio's), then the 5-minute store check as today, which also checks `person.client`. Then `routeOf`: project `rebrand` must belong to `acme`, and the prototype audience is checked as in slice 5. Then pass.
- **Studio opens a client.** `studio.<apex>` makes a one-time handoff token for that client and redirects to `<client>.<apex>/_gate/handoff/<token>`. The client host uses it up and sets its own Studio cookie.
- **Any API op.** `actorFrom`, then `Scope` from the host and the `project` parameter, then the service, where `inScope` and `can` decide.

The `KV` port stays Redis-shaped. A Postgres table `(key, field, value)` covers every op atomically (`hincrby` as `UPDATE … RETURNING`, `hdel` returning its count), so the service never changes per database. Plain Cloudflare KV cannot claim a link atomically, so it is not an adapter. Cloudflare D1 can be one.

## 5. Structure outline

Each slice works end to end and ships as its own release, as in `collaboration.md`. Test deployments go in `sas-team`.

| # | Delivers | Deterministic check | Files |
| --- | --- | --- | --- |
| 1 | Learning tests, output kept: how a project's build reaches the studio site (Q1, both options); a wildcard domain on a Vercel DNS apex; a per-host domain on Cloudflare through its API. | None; the findings settle Q1 and are recorded here | scratch projects in `sas-team` |
| 2 | The scoped store and rules: `hub4:` keys, `Scope` on every service method, `Person.client`, `inScope`, the `p5` token signed to the client. One client and one project per site still, so nothing else changes yet. | `policy` table with the scope row; `service.test.ts`: every op from a client-A actor on a client-B scope answers like an unknown id; `session.test.ts`: A's token fails on B; a `KV` conformance suite | `core/review/*`, `server/{api,session,local}.ts` |
| 3 | The studio site: the gate by host, each client's hub listing their projects, projects served under `/<project>/`, the review API scoped by host. One studio on `sas-team` with a test client. | `proxy.test.ts`: unknown host is 404, a cross-client cookie is the sign-in page, a project of another client is 404; a build under a base path passes slice 5's build checks | `vercel/*`, `core/prototype.ts`, `shell/*`, `vite/*` |
| 4 | Studio setup and the CLI: `studio create`, `client add`, `project link`, `share` into a studio, the local studio registry, the DNS adapters (Vercel wildcard, Cloudflare, manual). Carbon Signal is shared again into the Suits & Sandals studio, starting clean (S11). | `bootstrap.test.ts`-style tests per command with a fake host and DNS; `release-check` | `scripts/*`, `scripts/lib/*`, `skills/miles-deploy`, `template/`, `docs/guide/sharing.md` |
| 5 | The studio hub on `studio.<apex>`: every client, their people and projects, and the handoff to a client host. The People tab per client. | `proxy.test.ts`: a handoff works once and only for its client host; a Client cookie on `studio.<apex>` is the sign-in page | `shell/*`, `vercel/*`, `server/session.ts` |
| 6 | The ports opened: `gate` split from `@vercel/functions`, the host port in `scripts/`, the Postgres adapter (Neon, Supabase). The personal studio on `milesroxas.com` proves two studios share nothing. | The `KV` conformance, gate and service suites pass on Postgres; the success row "two studios share nothing" checked by listing both studios' env vars | `server/stores/*`, `vercel/*`, `scripts/lib/*` |

Then collaboration slice 7 (email sign-in), on studio people.

## 6. Review

| Slice | A person reads |
| --- | --- |
| 1 | The learning test output, and the Q1 choice |
| 2 | All of `policy.ts` and every service read path, for a missed scope |
| 3 | All of the gate's host and path handling: this is the new client boundary |
| 4 | The commands' JSON, and Carbon Signal working in the studio |
| 5 | The handoff in `session.ts` and the gate |
| 6 | The Postgres adapter against the conformance suite |

Slices 2, 3 and 5 are security slices: each gets a second read by a different model from the builder, at high effort, as in `collaboration.md` section 7.

## 7. What slice 5 means for this plan

Read from slice 5's build, before it is released:

- **One seam for paths.** `prototypeOfPath` in `core/prototype.ts` is the only place the gate reads a path. In this plan it becomes `routeOf(host, path)` with a project segment. Keep every path decision there.
- **The hub assumes `/`.** `API = '/api/review'` (`shell/review/client.ts`), `/_p/` in `core/prototype.ts` and the registry's base `/` all need to become relative to a base path before projects can sit under `/<project>/`.
- **The token's `site` is the store URL.** That separates sites today because each site has its own store. With one store per studio it no longer separates clients, so `p5` signs the client too (slice 2).
- **`hub3:audiences` is per site.** It moves under the project scope. So does `_p/all.js`, Studio's list of slugs, which stays one file per project.
- **`invite` is not reserved** (in slice 5's backlog). At a client host, project slugs share the first path segment with `invite`, `api`, `_gate` and `assets`, so the reserved list must cover every gate route before slice 3.
- **Store reads per request.** A Client's prototype page already costs one store read per file (slice 5's backlog). The host-to-client lookup adds one more unless the client list is cached briefly; budget it in slice 3.
- **Deleted things keep their marks.** A deleted prototype's client-facing mark stays in the store (slice 5's backlog). The same goes for a deleted project or client, so archiving one must remove its keys.

## 8. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | How does a project's build reach the studio site? (A) Each project keeps a deployment, locked by the host, and the studio site proxies to it with a secret. (B) `share` uploads the build to the studio's private object storage and the studio site serves it. | Decide from slice 1. Leaning B: one deployment per studio, and it works the same on any host. |
| Q3 | Which Vercel account and plan does the personal studio use? Hobby is for non-commercial use only. | A Pro team for paid side-project clients. Miles decides. |
| Q4 | Is a client's default access length set per studio or per client? | A studio default with a per-client override, and per-person as today. |
| Q5 | Does a client's hub show anything before sign-in beyond "open the link you were sent"? | No, the same page as today, so a guessed client host confirms nothing. |
