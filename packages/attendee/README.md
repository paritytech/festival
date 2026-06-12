# Attendee SPA

The mobile-first app a festival-goer uses on the day: register, build a
schedule, navigate the venue, host and join unconference sessions, collect
attendance badges, and read announcements. It is a Nuxt 3 / Vue 3 (Composition
API) SPA prototype that runs inside the Polkadot Host and is pinned to a single festival.

A single `VITE_FESTIVAL_ADDRESS` is baked at build time; the app reads only that
contract and its sessions. The router runs in hash mode and SSR is disabled;
the build is a static SPA (`nuxt generate`).

---

## Architecture in one paragraph

The attendee app prototype is a read-heavy view over one `Festival` contract plus its
`FestivalSession` children. On boot it hydrates from cache for an instant first
paint, then does a small number of Multicall3 rounds to pull festival details,
the attendee roster, session list, and the user's POAPs, followed by off-chain
Bulletin Chain fetches for the human-facing metadata (festival content, session
details, badge art, announcements). All of that lands in the shared
`festival-state` store, and a chain-head watcher keeps it live. The only writes
an attendee makes are `register()` on the festival or a session, `createSession()`
to host their own, and `flag()` to report a session. Everything else is metadata read off the Bulletin Chain.

---

## Pages at a glance

| Route                                 | Purpose                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| `/`                                   | Home: check-in status, next-up reminder, badges, "my list"     |
| `/onboarding`                         | First-run welcome + registration                               |
| `/program` , `/program/[id]`          | Official schedule + session detail (bookmark, locate on map)   |
| `/map`                                | Interactive venue map (floors, zones, markers, session strips) |
| `/sessions/create` , `/sessions/host` | Host a community session (unconference)                        |
| `/my/manage/[address]/…`              | Host view of a session: dashboard, edit, peer check-in         |
| `/my/badges` , `/my/badge/[tokenId]`  | Earned POAP collection + badge detail                          |
| `/my/notifications`                   | Festival announcement channel                                  |

---

## Boot & cold load

`app.vue` calls `bootApp()` (host detect + PAPI clients). It shows a gate when
the app isn't running inside an allowed host environment or when
`VITE_FESTIVAL_ADDRESS` is unset (dev mode bypasses the host gate).

Once a wallet address is available, `useBootLoad()` runs a staged cold load
designed to stay under the host's RPC rate limiter:

1. **Round 1** — festival details, attendees, session addresses, the user's
   POAP balances (one Multicall3 batch).
2. **Round 2** — per-session details, attendees, and POAP token lists.
3. **Round 3** — POAP token metadata (only if session POAPs exist).

Bulletin Chain metadata fetches run alongside, non-blocking. `hydrateFromCache()`
paints last-known state first; `persistToCache()` saves after the load. On tab
resume the load re-runs at `finalized` to catch anything missed while
backgrounded. After the initial load completes, `useFestivalWatcher` subscribes
to `chainHead_v1_follow` for live updates (including announcement-channel
changes).

The app accepts both SS58 and H160 addresses and normalises to H160 for reads.

---

## Registration & check-in

Registration is self-service from the home/onboarding flow: `register()` mints
the attendee's non-transferable festival ticket. Actual attendance (the festival POAP)
is minted when a volunteer checks the attendee in from the **admin** SPA: the
attendee side just reflects `registered` vs `checked-in` status, derived from
the attendee array or the festival POAP balance (`useRegistration`).
On the admin side, registration can be bypassed by using `manualCheckIn` if so desired.

---

## Schedule

Two distinct timelines:

- **Program** (`/program`) — the official, admin-published schedule together with community built sessons. Attendees
  can bookmark entries on to their list; each entry can link to a venue marker so
  the detail page can locate it on the map.
- **Personal schedule** — bookmarked program entries plus
  community sessions the user has favorited. Bookmarks are local
  (`useBookmarks` / `useSavedItems`) and can raise schedule reminders via host
  notifications.

---

## Sessions (unconference)

Attendees host their own sessions, which deploy real `FestivalSession`
contracts via the parent festival.

- **Create** (`/sessions/create`) — a multi-step flow (overview → time +
  location → badge pixel art) gated by festival-POAP ownership and the
  contract's per-creator-per-day limit. Time slots are constrained to legal
  windows by `@festival/shared/sessions` (illegal times are omitted, not
  greyed out); location is picked on the venue map.
- **Discover** (`/program`, `/program/[address]`) — browse and list
  others' sessions; `useSubEvents` derives per-user registration/check-in
  status. Sessions can be reported with `useFlagSession` (requires a festival
  POAP, to deter abuse) and hidden locally with `useHiddenSessions`.
- **Manage** (`/my/manage/[address]/…`) — the host's dashboard, edit form, and
  peer check-in page for their own session (`useSubEventManage`,
  `useSubEventRoles`).

---

## Venue map

`VenueMap.vue` wraps the shared MapLibre engine
(`@festival/shared/venue/map-engine-ml`). The map renders GeoJSON floors with
zones and category-tiered markers, an outdoor/indoor toggle (`FloorControl`),
and a bottom session strip showing what's happening at a tapped marker.
`useAttendeeMap` holds map state and matches a session's stored location string
(`{x},{y},{floorId}`) to a marker or zone via the engine's hit-testing.
`blockOutOfBounds` is opt-in per consumer (defaults to on): the session location
picker keeps it on so session pins can't land in `#forbidden` areas, while the
top-level Map page turns it off so attendees can drop a "meet me here" pin
anywhere. See `packages/shared/venue/README.md` for the floor-plan pipeline.

---

## Badges (POAPs)

`/my/badges` is the attendee's collection of attendance POAPs — the festival
badge plus one per checked-in session. `usePoaps` hydrates token metadata and
badge images (Bulletin / IPFS, cached as data URLs) and separates collectible
badges from auto-minted ones. Badge art is 16×16 pixel art encoded in session
metadata and rendered by `BadgeCanvas.vue`; an earned-badge celebration overlay
fires on a fresh check-in.

---

## Announcements

`/my/notifications` is the read side of the festival's broadcast channel. The
channel CID lives on the festival contract; `useAnnouncements` resolves it,
fetches announcement bodies off-chain (batched), paginates newest-first, and
tracks unread state locally. When the admin publishes (the
`ChannelMetadataUpdated` event), the watcher triggers a reload. This is a
one-way admin → attendee channel — there is no peer-to-peer chat.

---

## Environment

Copy `.env.example` (or a network-specific `.env.<network>.example`) to `.env`:

| Variable                                                 | Purpose                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `VITE_NETWORK`                                           | Network key from the registry (`paseo`, `paseo-next-v2`, …)          |
| `VITE_FESTIVAL_ADDRESS`                                  | The festival this build is pinned to                                 |
| `VITE_FESTIVAL_POAP_ADDRESS`                             | Festival-level attendance POAP                                       |
| `VITE_SUB_EVENT_POAP_ADDRESS`                            | Session-level POAP                                                   |
| `VITE_MULTICALL_ADDRESS`                                 | Multicall3 for batched reads                                         |
| `VITE_DOTNS_ID`                                          | DotNS domain id (host / registration wiring)                         |
| `VITE_CHAIN_GENESIS_HASH` / `VITE_BULLETIN_GENESIS_HASH` | Genesis overrides (only chains without a built-in genesis)           |
| `VITE_VITE_DEV_SEED`                                     | [Local development only] User seed for development purposes          |
| `VITE_BULLETIN_SIGNER_SEED`                              | [Local development only] Mnemonic for the Bulletin Chain app account |

The app expects to run inside the Polkadot Host (Desktop / Web / Mobile); a
standalone-browser boot falls through to an "Open in Polkadot Host" screen.

---

## Dev / build / test

```bash
# from repo root
npm run dev:attendee                 # nuxt dev
npm run dev:attendee:paseo-next-v2   # dev against a specific network's .env
npm run build:attendee               # static SPA (nuxt generate) → packages/attendee/out

# e2e
npm run test:e2e:attendee            # playwright (e2e/, host simulated via host-api-test-sdk)
```

Per the repo convention, UI changes here must keep the Playwright specs in
`e2e/` (navigation, home, map, program, session creation, report flow) in sync.
