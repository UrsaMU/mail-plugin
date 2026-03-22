# Mail Plugin

> In-game mail system with drafts, folders, attachments, per-player quota, and message expiry.

## Commands

| Command | Syntax | Lock | Description |
|---------|--------|------|-------------|
| `@mail` | `@mail` | connected | List your inbox |
| `@mail` | `@mail <number>` | connected | Read message by number |
| `@mail` | `@mail <player>=<subject>` | connected | Start a new draft |
| `-` | `-<text>` | connected | Append a line to the active draft |
| `@mail/subject` | `@mail/subject <text>` | connected | Set draft subject |
| `@mail/cc` | `@mail/cc <player>` | connected | Add CC recipient |
| `@mail/bcc` | `@mail/bcc <player>` | connected | Add BCC recipient |
| `@mail/attach` | `@mail/attach <object>` | connected | Attach a game object to draft |
| `@mail/proof` | `@mail/proof` | connected | Preview draft |
| `@mail/send` | `@mail/send` | connected | Send the draft |
| `@mail/abort` | `@mail/abort` | connected | Discard the draft |
| `@mail/reply` | `@mail/reply <number>` | connected | Reply to a message |
| `@mail/replyall` | `@mail/replyall <number>` | connected | Reply to all recipients |
| `@mail/forward` | `@mail/forward <num>=<target>` | connected | Forward a message |
| `@mail/save` | `@mail/save <number>` | connected | Protect message from deletion |
| `@mail/unsave` | `@mail/unsave <number>` | connected | Remove deletion protection |
| `@mail/delete` | `@mail/delete <number>` | connected | Move to trash |
| `@mail/trash` | `@mail/trash` | connected | List trash folder |
| `@mail/restore` | `@mail/restore <number>` | connected | Restore from trash |
| `@mail/purge` | `@mail/purge` | connected | Permanently delete all trash |
| `@mailstat` | `@mailstat` | admin+ | Mail system statistics |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `mail:received` | `{ recipientId, mailId, subject, senderName }` | Fired for each recipient when a message is delivered |
| `player:login` | `{ actorId }` | Plugin hooks this to notify unread count and draft warning |

## Storage

| Collection | Schema | Purpose |
|------------|--------|---------|
| `mail.messages` | `IMail` | All mail messages |

### IMail schema

```typescript
interface IMail {
  id: string;
  from: string;          // "#<id>" of sender
  to: string[];          // ["#<id>", ...] primary recipients
  cc?: string[];
  bcc?: string[];
  subject: string;
  message: string;
  date: number;          // unix ms
  read: boolean;
  replied?: boolean;
  forwarded?: boolean;
  starred?: boolean;     // protected from /delete
  folder?: "inbox" | "trash";   // undefined = inbox
  expiresAt?: number;    // unix ms — auto-purged when past
  attachments?: string[]; // ["#<id>", ...] of attached objects
}
```

## REST Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/mail` | Bearer | List inbox (`?folder=trash` for trash) |
| `GET` | `/api/v1/mail/sent` | Bearer | Messages sent by caller |
| `GET` | `/api/v1/mail/:id` | Bearer | Single message (marks as read) |
| `POST` | `/api/v1/mail` | Bearer | Send a message immediately |
| `PATCH` | `/api/v1/mail/:id` | Bearer | Update `folder` or `starred` |
| `DELETE` | `/api/v1/mail/:id` | Bearer | Soft-delete (trash); hard-delete if already trashed |

### POST /api/v1/mail body

```json
{
  "to": ["#5", "#12"],
  "subject": "Hello",
  "message": "This is the body.",
  "cc": [],
  "bcc": []
}
```

## Quota

Players are limited to **100** inbox messages (configurable via `MAIL_QUOTA` in `mailDbo.ts`).
Delivery is skipped for recipients whose inbox is at capacity. Trash messages do not count against quota.

## Expiry

Set `expiresAt` (unix ms) on any message to have it auto-purged. The plugin runs an expiry sweep
every hour and once on startup. Messages without `expiresAt` never expire.

## Migration note

This plugin replaces the core `server.mail` DBO. Existing messages stored in `server.mail`
are **not** migrated automatically. Export and re-import if you need to preserve old mail.

## Install

Place in `src/plugins/mail/` — auto-discovered on next restart.

> **Note:** REST route `/api/v1/mail` persists until server restart after `remove()`.
