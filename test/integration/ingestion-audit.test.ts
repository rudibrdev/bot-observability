import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createDbClient, type DbClient } from "@/lib/db";
import { POST } from "@/app/api/bot-hit/route";

const url = process.env.TEST_DATABASE_URL;
const project = "__vitest_ingestion_audit__";
const token = "audit-test-credential-".repeat(2);
const originalEnv = { ...process.env };
let db: DbClient;
let sql: ReturnType<typeof postgres>;
vi.mock("@/lib/request-db", () => ({ getRequestDb: () => db }));

function post(body: unknown, authenticated = true) {
  return POST(new Request("https://collector.example/api/bot-hit", {
    method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
}

describe.skipIf(!url)("authenticated ingestion audit with PostgreSQL", () => {
  beforeAll(async () => {
    process.env = { ...originalEnv, DATABASE_URL: url!, BOT_IP_HASH_SECRET: "audit-hash-secret-".repeat(3),
      BOT_INGEST_TOKENS: JSON.stringify({ [project]: token }), BOT_LOG_TOKEN: "", BOT_ACCEPT_LEGACY_INGEST: "false",
      BOT_INCLUDE_NON_PRODUCTION: "false", BOT_EVENT_RPM: "3" };
    db = createDbClient(url!); sql = postgres(url!, { max: 1 });
    await sql`DELETE FROM bot_rejections WHERE project_name = ${project}`;
  });
  afterAll(async () => {
    for (const table of ["bot_rejections", "bot_hits", "bot_hits_daily", "project_receipts"]) {
      await sql.unsafe(`DELETE FROM ${table} WHERE project_name = $1`, [project]);
    }
    await sql`DELETE FROM bot_first_seen WHERE bot_name = 'AuditSenderBot'`;
    await db.close(); await sql.end(); process.env = { ...originalEnv };
  });

  it("counts refusals, records divergence, preserves weighted idempotent hits and accepts isolated probes", async () => {
    expect((await post({ probe: "connection" }, false)).status).toBe(401);
    for (let i = 0; i < 2; i++) {
      expect(await (await post({ user_agent: "Mozilla/5.0", project: "spoof" })).json()).toEqual({ stored: false, reason: "not_bot" });
    }
    expect(await (await post({ user_agent: "GPTBot/1.0", environment: "development" })).json()).toEqual({ stored: false, reason: "non_production" });
    const hit = { event_id: "audit-event-1", bot_name: "AuditSenderBot", bot_category: "generic", user_agent: "Mozilla/5.0", sample_rate: 0.25 };
    expect((await post(hit)).status).toBe(201);
    expect(await (await post(hit)).json()).toEqual({ stored: false, reason: "duplicate" });
    expect((await post({ user_agent: "GPTBot/1.0", event_id: "bad id" })).status).toBe(400);
    expect((await post({ user_agent: "GPTBot/1.0" })).status).toBe(429);
    const probe = await post({ probe: "connection", environment: "development", url: "http://localhost:3000" });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ received: true, project });
    expect(process.env.BOT_INCLUDE_NON_PRODUCTION).toBe("false");
    expect(await db.projectDelivery(project)).toMatchObject({ delivered: true });
    const hits = await sql`SELECT bot_name, collector_bot_name, classification_source, classification_mismatch FROM bot_hits WHERE project_name = ${project}`;
    expect([...hits]).toEqual([{ bot_name: "AuditSenderBot", collector_bot_name: null, classification_source: "sender", classification_mismatch: true }]);
    expect((await sql`SELECT hits FROM bot_hits_daily WHERE project_name = ${project}`)[0].hits).toBe(4);
    const from = new Date(); from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from); to.setUTCDate(to.getUTCDate() + 1);
    expect((await db.dailyRejections(from, to, project)).map(({ reason, count }) => ({ reason, count }))).toEqual([
      { reason: "duplicate", count: 1 }, { reason: "invalid_event_id", count: 1 },
      { reason: "non_production", count: 1 }, { reason: "not_bot", count: 2 }, { reason: "project_quota_exceeded", count: 1 },
    ]);
    const [repeated] = await sql`SELECT count::int, ua_fingerprint, first_seen_at, last_seen_at FROM bot_rejections WHERE project_name = ${project} AND reason = 'not_bot'`;
    expect(repeated.count).toBe(2); expect(repeated.ua_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.last_seen_at >= repeated.first_seen_at).toBe(true);
    expect(await db.dailyRejections(from, to, "other-project")).toEqual([]);
    expect(await db.dailyRejections(from, new Date(from.getTime() + 12 * 60 * 60_000), project)).toHaveLength(5);
    expect(await db.dailyRejections(new Date(from.getTime() - 86_400_000), from, project)).toEqual([]);
  });
  it("bounds audit cardinality despite changing UAs and atomically counts every refusal", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => db.recordRejection({
      project_name: project, reason: "invalid_payload", ua_fingerprint: `fingerprint-${i}`,
      bot_name: `Bot-${i}`, bot_category: "generic",
    })));
    const rows = await sql`SELECT count::int FROM bot_rejections WHERE project_name = ${project} AND reason = 'invalid_payload'`;
    expect([...rows]).toEqual([{ count: 12 }]);
  });

});
