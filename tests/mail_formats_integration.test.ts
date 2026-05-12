/**
 * Integration test: @mailformat / @mailrowformat hooks on the mailList output.
 *
 * Uses real `dbojs` from jsr:@ursamu/ursamu and the plugin-handler registry
 * (registerFormatHandler) — both are publicly exported from the JSR package.
 * The softcode-attribute path is exercised through a mocked `u.attr.get`
 * supplied on the test SDK (resolveFormat falls back to plugin handlers when
 * `u.attr` is missing).
 *
 * %0 is the default rendered string (block or row) produced by mailList.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  dbojs,
  DBO,
  registerFormatHandler,
  unregisterFormatHandler,
  type FormatHandler,
  type FormatSlot,
  type IDBObj,
  type IUrsamuSDK,
} from "@ursamu/ursamu";
import { mailDb, type IMail } from "../mailDbo.ts";
import { mailList } from "../mailInboxActions.ts";

const OPTS = { sanitizeResources: false, sanitizeOps: false };
const SLOW = { timeout: 15000 };

// Numeric ids so dbref-style lookups work.
const ROOT  = "0";        // game-wide skin
const ACTOR = "910001";
const SENDER = "910002";

async function cleanup() {
  for (const id of [ROOT, ACTOR, SENDER]) {
    await dbojs.delete({ id }).catch(() => {});
  }
  const all = await mailDb.find({});
  for (const m of all) {
    if (m.from === `#${SENDER}` || (m.to ?? []).includes(`#${ACTOR}`)) {
      await mailDb.delete({ id: m.id }).catch(() => {});
    }
  }
}

async function seed(opts: { messages?: number; rootAttrs?: Record<string, string> } = {}) {
  await cleanup();
  const attributes = Object.entries(opts.rootAttrs ?? {}).map(([name, value]) => ({
    name, value, setter: ACTOR, type: "attribute",
  }));
  await dbojs.create({
    id: ROOT,
    flags: "room",
    data: { name: "Root", attributes },
  });
  await dbojs.create({
    id: SENDER,
    flags: "player",
    data: { name: "Sender" },
  });
  await dbojs.create({
    id: ACTOR,
    flags: "player connected",
    data: { name: "Alice" },
  });

  const count = opts.messages ?? 2;
  for (let i = 0; i < count; i++) {
    await mailDb.create({
      id: `mail-test-${i}`,
      from: `#${SENDER}`,
      to: [`#${ACTOR}`],
      subject: `Test Subject ${i}`,
      message: `Body ${i}`,
      date: 1700000000000 + i,
      read: false,
    } as IMail).catch(() => {});
  }
}

/** Build a minimal IUrsamuSDK suitable for mailList. */
function mockU(opts: { actorId?: string; attrGet?: (id: string, name: string) => string | null } = {}): IUrsamuSDK & { _sent: string[] } {
  const sent: string[] = [];
  const me = {
    id: opts.actorId ?? ACTOR,
    name: "Alice",
    flags: new Set(["player", "connected"]),
    state: { name: "Alice" },
    location: "",
    contents: [],
  } as unknown as IDBObj;

  const u = {
    me,
    socketId: "mail-fmt-sock",
    send: (m: string) => { sent.push(m); },
    util: {
      target: async (_me: IDBObj, ref: string) => {
        const obj = await dbojs.queryOne({ id: ref.replace("#", "") }).catch(() => null);
        if (!obj) return null;
        return { ...obj, name: (obj as { data?: { name?: string } }).data?.name ?? "Unknown" } as unknown as IDBObj;
      },
      stripSubs: (s: string) => s,
      displayName: (o: IDBObj) => o.name ?? "Unknown",
      center: (s: string) => s,
      ljust: (s: string, w: number) => s.padEnd(w),
      rjust: (s: string, w: number) => s.padStart(w),
    },
    attr: opts.attrGet
      ? { get: (id: string, name: string) => Promise.resolve(opts.attrGet!(id, name)) }
      : undefined,
  } as unknown as IUrsamuSDK & { _sent: string[] };

  (u as unknown as { _sent: string[] })._sent = sent;
  return u;
}

Deno.test("mail: no attrs, no handler — default rendering", { ...OPTS, ...SLOW }, async () => {
  await seed({ messages: 2 });
  const u = mockU();
  await mailList(u);
  const out = u._sent.join("\n");
  assertStringIncludes(out, "MAIL: Inbox");
  assertStringIncludes(out, "Test Subject 0");
  assertStringIncludes(out, "Test Subject 1");
  assertStringIncludes(out, "2/100 messages.");
  await cleanup();
});

Deno.test("mail: MAILFORMAT plugin handler replaces the whole block", { ...OPTS, ...SLOW }, async () => {
  await seed({ messages: 2 });
  const handler: FormatHandler = (_u, _t, defaultBlock) => `<<BLOCK>>\n${defaultBlock}\n<</BLOCK>>`;
  registerFormatHandler("MAILFORMAT" as FormatSlot, handler);
  try {
    const u = mockU();
    await mailList(u);
    const out = u._sent.join("\n");
    assertStringIncludes(out, "<<BLOCK>>");
    assertStringIncludes(out, "<</BLOCK>>");
    // Per-line sends are suppressed when block override fires; exactly one send.
    assertEquals(u._sent.length, 1);
  } finally {
    unregisterFormatHandler("MAILFORMAT" as FormatSlot, handler);
    await cleanup();
  }
});

Deno.test("mail: MAILROWFORMAT plugin handler replaces each row", { ...OPTS, ...SLOW }, async () => {
  await seed({ messages: 2 });
  const handler: FormatHandler = (_u, _t, row) => `ROW>${row}<ROW`;
  registerFormatHandler("MAILROWFORMAT" as FormatSlot, handler);
  try {
    const u = mockU();
    await mailList(u);
    const out = u._sent.join("\n");
    // Both rows wrapped.
    const matches = out.match(/ROW>/g) ?? [];
    assertEquals(matches.length, 2);
    assertStringIncludes(out, "Test Subject 0");
    assertStringIncludes(out, "Test Subject 1");
  } finally {
    unregisterFormatHandler("MAILROWFORMAT" as FormatSlot, handler);
    await cleanup();
  }
});

Deno.test("mail: two-tier — #0 attr wins over enactor attr", { ...OPTS, ...SLOW }, async () => {
  await seed({ messages: 1 });

  // Force the softcode-attr path to throw so resolveFormat falls through to
  // the plugin-handler chain — that's the only public surface we can use to
  // observe the order in which targets are consulted. (resolveFormat catches
  // softcode failures and routes to handlers; see ursamu's resolveFormat.ts.)
  const u = mockU({
    attrGet: () => { throw new Error("force fall-through"); },
  });

  const seen: string[] = [];
  const handler: FormatHandler = (_u, target, _arg) => { seen.push(target.id); return null; };
  registerFormatHandler("MAILFORMAT" as FormatSlot, handler);
  try {
    await mailList(u);
    assertEquals(seen[0], ROOT, "should consult #0 first");
    assertEquals(seen[1], ACTOR, "then fall through to enactor");
  } finally {
    unregisterFormatHandler("MAILFORMAT" as FormatSlot, handler);
    await cleanup();
  }
});

Deno.test("mail: plugin handler fallback runs when no attr is set", { ...OPTS, ...SLOW }, async () => {
  await seed({ messages: 1 });
  const handler: FormatHandler = (_u, _t, defaultBlock) => `HANDLER:${defaultBlock.split("\n")[0]}`;
  registerFormatHandler("MAILFORMAT" as FormatSlot, handler);
  try {
    const u = mockU();  // no attr.get → handler is the only override path
    await mailList(u);
    const out = u._sent.join("\n");
    assertStringIncludes(out, "HANDLER:");
  } finally {
    unregisterFormatHandler("MAILFORMAT" as FormatSlot, handler);
    await cleanup();
    await DBO.close();
  }
});
