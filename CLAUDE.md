# mail-plugin — Claude Code Instructions

## Project identity

External UrsaMU plugin: in-game mail system with drafts, folders,
attachments, quotas, and expiry. Targets ursamu **^2.3.0**.

- **Ecosystem skill**: load `/ursamu-dev` before working here.
- **API reference**: `/Users/kumakun/.claude/skills/ursamu-dev/references/api-reference.md`
  is authoritative for every type, method, import path, and event payload.
  Read it before writing code. Never guess signatures.

---

## Commands

```bash
deno task check    # type-check entry (index.ts)
deno task lint     # must be clean
deno task test     # full suite
```

## Pre-commit checklist (all must pass)

```bash
deno check --unstable-kv index.ts
deno lint
deno test --allow-all --unstable-kv --no-check tests/
```

---

## Repo layout

```
index.ts                Plugin entry (Phase 1 import + IPlugin export)
commands.ts             addCmd registrations
mailInboxActions.ts     List/read/trash/save/restore — format-hook aware
mailComposeActions.ts   Draft/append/send/reply/forward
mailHelpers.ts          getMyMail, resolveNames, expiry sweep
mailDbo.ts              DBO("mail.messages") + IMail interface
routes.ts               REST handlers for /api/v1/mail
tests/                  Deno test files
ursamu.plugin.json      Plugin manifest consumed by ursamu loader
```

---

## Imports

```typescript
import {
  addCmd, dbojs, DBO, gameHooks, send, wsService,
  registerPluginRoute,
  resolveFormat, type FormatSlot,
  registerFormatHandler, unregisterFormatHandler,
} from "jsr:@ursamu/ursamu";
import type { ICmd, IPlugin, IDBObj, IUrsamuSDK, SessionEvent } from "jsr:@ursamu/ursamu";
```

DBO namespace rule: collection names prefixed with `mail.` (e.g. `mail.messages`).

---

## addCmd skeleton — `@mail`

The plugin uses one catch-all switch pattern: `/^@?mail(?:\/(\S+))?\s*(.*)/i`.
Sub-commands live inside the main `exec` switch, never as separate `addCmd`s
(catch-all gotcha — see ursamu CLAUDE.md).

```typescript
addCmd({
  name: "@mail",
  pattern: /^@?mail(?:\/(\S+))?\s*(.*)/i,
  lock: "connected",
  category: "Communication",
  help: `@mail[/<switch>] [<args>]  — In-game mail.`,
  exec: async (u) => {
    const sw      = (u.cmd.args[0] ?? "").toLowerCase().trim();
    const subArgs = (u.cmd.args[1] ?? "").trim();
    // ...
  },
});
```

### Lock levels — same as core

`""`, `"connected"`, `"connected builder+"`, `"connected admin+"`,
`"connected wizard"`.

---

## Format hooks (v2.3+)

The inbox/trash listing supports two slots resolved via `resolveFormat`:

| Slot | `%0` value | Effect |
|------|------------|--------|
| `MAILFORMAT` | Default rendered block | Full inbox/trash override |
| `MAILROWFORMAT` | Default rendered row | Per-message row override |

Two-tier lookup (mirrors WHO/PS): `#0` (game-wide) → enactor (`u.me`) →
plugin handler → built-in default.

Helper (in `mailInboxActions.ts`):

```typescript
async function resolveGlobalFormat(u, slot, defaultArg) {
  const root = await dbojs.queryOne({ id: "0" });
  if (root) {
    const onRoot = await resolveFormat(u, root as IDBObj, slot as FormatSlot, defaultArg);
    if (onRoot != null) return onRoot;
  }
  return await resolveFormat(u, u.me, slot as FormatSlot, defaultArg);
}
```

Cast unknown slot names as `slot as FormatSlot` — plugin-defined slot names
are not in the core union but `resolveFormat` accepts any string at runtime.

---

## Key SDK idioms

```typescript
// Strip MUSH codes BEFORE DB ops or length checks (always)
const clean = u.util.stripSubs(u.cmd.args[0]).trim();

// DB writes — op must be "$set" | "$inc" | "$unset" only
await mailDb.modify({ id: m.id }, "$set", { read: true } as Partial<IMail>);

// Target resolution — always guard
const target = await u.util.target(u.me, raw, true);
if (!target) { u.send("Not found."); return; }
```

---

## MUSH color codes

| Code | Effect | Code | Effect |
|------|--------|------|--------|
| `%ch` | Bold | `%cn` | Reset (close every open code) |
| `%cr` | Red | `%cg` | Green |
| `%cb` | Blue | `%cy` | Yellow |
| `%cw` | White | `%cc` | Cyan |
| `%r`  | Newline | `%t` | Tab |

---

## Plugin lifecycle (three phases — non-negotiable)

```
Phase 1 — module load   import "./commands.ts" → addCmd() fires at load time
Phase 2 — init()        register routes, attach gameHooks listeners → return true
Phase 3 — remove()      detach hooks with the SAME named function reference
```

Pair every `gameHooks.on(evt, fn)` in `init()` with `gameHooks.off(evt, fn)`
in `remove()` using the same named reference.

---

## Test patterns

Required boilerplate for tests that touch service layer:

```typescript
const OPTS = { sanitizeResources: false, sanitizeOps: false };
Deno.test("desc", OPTS, async () => { /* ... */ });
```

Format-hook integration tests follow ursamu's
`tests/look_formats_integration.test.ts` — real `softcodeService` + `dbojs`,
numeric ids so softcode dbref resolution works. Required cases:

- no attrs → default rendering preserved
- `@mailformat` set → block override wins
- `@mailrowformat` set → per-row override
- two-tier: `#0` attr wins over enactor attr
- plugin handler runs when no attr is set

Close DB in the last test: `await DBO.close()`.

---

## Code style (non-negotiable)

- Early return over nested conditions.
- No function longer than 50 lines.
- No file longer than 200 lines.
- No bare `catch` — always `catch (e: unknown)`.
- Library-first.
- Max nesting depth 3.

---

## Audit checklist

- [ ] `u.util.stripSubs()` on user strings before DB ops or length checks
- [ ] DB writes use `$set` / `$inc` / `$unset`
- [ ] `u.util.target()` results null-checked
- [ ] All `%c*` codes closed with `%cn`
- [ ] Every `addCmd` has `help:` with syntax + ≥2 examples
- [ ] `gameHooks.on()` paired with matching `gameHooks.off()`
- [ ] DBO namespace prefixed (`mail.*`)
- [ ] REST handlers return 401 before any work when `userId` is null
- [ ] `init()` returns `true`
- [ ] Format-hook calls use `resolveGlobalFormat` two-tier helper

---

## PRs and commits

- No Claude/AI attribution in PR titles, commit messages, or code comments.
- Squash-merge feature PRs.
- Tag versions after merge: `git tag v<version> && git push --tags`.
