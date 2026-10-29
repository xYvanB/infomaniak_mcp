/**
 * Approval before destructive and sensitive calls — through the real
 * protocol: the SDK's in-memory transport links a real Client to the real
 * server, the client answers the server's elicitation as a person would, and
 * whatever goes out speaks HTTP to a replay of the API, so each test can
 * count what reached it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import { createMcpServer, ServerOptions } from "./server.js";
import { confirmationMessage, describeInput } from "./confirm.js";
import { ReplayServer } from "./test-support/replay-server.js";

const ok = { status: 200, body: { result: "success", data: true } };
const replay = new ReplayServer()
  .on("DELETE", "/1/domain/example.com/dns/record/42", ok)
  .on("GET", "/1/domain/example.com/dns/record", { status: 200, body: { result: "success", data: [] } })
  .on("POST", "/1/web/7/ftp", { status: 201, body: { result: "success", data: { id: 1 } } })
  .on("POST", "/2/drive/3/files/9/favorite", ok)
  .on("DELETE", "/2/drive/3/files/9/favorite", ok);

let api: InfomaniakClient;
beforeAll(async () => {
  api = new InfomaniakClient({ token: "test-token", baseUrl: await replay.start(), maxAttempts: 1 });
});
afterAll(() => replay.stop());
beforeEach(() => replay.requests.splice(0));

type Person = (message: string) => ElicitResult | Promise<ElicitResult>;

/** A client that can ask the person (when `person` is given) and what it was asked. */
async function connect(person: Person | null, options: ServerOptions = {}): Promise<{ client: Client; asked: string[] }> {
  const server = createMcpServer(api, null, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" }, { capabilities: person ? { elicitation: {} } : {} });
  const asked: string[] = [];
  if (person) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      asked.push(request.params.message);
      return person(request.params.message);
    });
  }
  await client.connect(clientTransport);
  return { client, asked };
}

const text = (result: unknown) => ((result as { content: { text: string }[] }).content).map((c) => c.text).join("");
const deleteRecord = { name: "infomaniak_delete_dns_record", arguments: { domain: "example.com", record_id: 42 } };

describe("a destructive call", () => {
  it("runs once the person ticks and accepts, and they saw what would run", async () => {
    const { client, asked } = await connect(() => ({ action: "accept", content: { confirm: true } }));
    const result = await client.callTool(deleteRecord);
    expect(result.isError).toBeFalsy();
    expect(replay.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /1/domain/example.com/dns/record/42"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("infomaniak_delete_dns_record");
    expect(asked[0]).toContain('"record_id": 42');
    expect(asked[0]).toContain("no undo");
    await client.close();
  });

  it.each([
    ["declined", { action: "decline" } as ElicitResult, /declined/],
    ["cancelled", { action: "cancel" } as ElicitResult, /cancelled/],
    ["accepted with the box left unticked", { action: "accept", content: { confirm: false } } as ElicitResult, /unticked/],
  ])("is refused when %s, and nothing reaches the API", async (_case, answer, why) => {
    const { client } = await connect(() => answer);
    const result = await client.callTool(deleteRecord);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Refused: /);
    expect(text(result)).toMatch(why);
    expect(replay.requests).toHaveLength(0);
    await client.close();
  });

  it("is refused when the client cannot ask the person, and says how to rely on the client instead", async () => {
    const { client } = await connect(null);
    const result = await client.callTool(deleteRecord);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Refused: .*elicitation/);
    expect(text(result)).toContain("INFOMANIAK_CONFIRM=client");
    expect(replay.requests).toHaveLength(0);
    await client.close();
  });

  it("is refused when the person does not answer in time", async () => {
    const { client } = await connect(() => new Promise<ElicitResult>(() => {}), { confirmTimeoutMs: 50 });
    const result = await client.callTool(deleteRecord);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Refused: .*not approved/);
    expect(replay.requests).toHaveLength(0);
    await client.close();
  });

  it("is validated before the person is asked: they never approve a call that cannot run", async () => {
    const { client, asked } = await connect(() => ({ action: "accept", content: { confirm: true } }));
    const result = await client.callTool({ name: "infomaniak_delete_dns_record", arguments: { domain: "x.com/../../2/drive/1/trash", record_id: 42 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Error: Validation error: domain/);
    expect(asked).toHaveLength(0);
    expect(replay.requests).toHaveLength(0);
    await client.close();
  });

  it("is left to the client's own prompt with INFOMANIAK_CONFIRM=client", async () => {
    const { client, asked } = await connect(null, { confirm: "client" });
    const result = await client.callTool(deleteRecord);
    expect(result.isError).toBeFalsy();
    expect(asked).toHaveLength(0);
    expect(replay.requests).toHaveLength(1);
    await client.close();
  });
});

describe("calls that do not ask", () => {
  it("a read runs without a question, even when the client could ask", async () => {
    const { client, asked } = await connect(() => ({ action: "decline" }));
    const result = await client.callTool({ name: "infomaniak_list_dns_records", arguments: { domain: "example.com" } });
    expect(result.isError).toBeFalsy();
    expect(asked).toHaveLength(0);
    await client.close();
  });

  it("an additive call that reaches nothing outside runs without a question; a trivial removal too", async () => {
    const { client, asked } = await connect(null);
    for (const name of ["infomaniak_add_kdrive_favorite", "infomaniak_remove_kdrive_favorite"]) {
      const result = await client.callTool({ name, arguments: { drive_id: 3, file_id: 9 } });
      expect(result.isError, name).toBeFalsy();
    }
    expect(asked).toHaveLength(0);
    await client.close();
  });
});

describe("a sensitive additive call", () => {
  it("asks, and never shows a password to the person's screen", async () => {
    const { client, asked } = await connect(() => ({ action: "accept", content: { confirm: true } }));
    const result = await client.callTool({
      name: "infomaniak_create_ftp_account",
      arguments: { hosting_id: 7, login: "deploy", password: "s3cret-passw0rd" },
    });
    expect(result.isError).toBeFalsy();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("credentials");
    expect(asked[0]).not.toContain("s3cret-passw0rd");
    expect(asked[0]).toContain("(hidden)");
    // What reaches the API is what the person approved, password included.
    expect(replay.requests[0].body).toEqual({ login: "deploy", password: "s3cret-passw0rd" });
    await client.close();
  });
});

describe("the confirmation text", () => {
  it("cuts long values and leaves out absent ones", () => {
    const shown = describeInput({ content_text: "x".repeat(5000), conflict: "rename", directory_id: undefined }) as Record<string, string>;
    expect(shown.content_text).toMatch(/… \(3000 more characters\)$/);
    expect(shown).not.toHaveProperty("directory_id");
    expect(confirmationMessage("infomaniak_x", "Because.", { a: 1 })).toContain('"a": 1');
  });
});
