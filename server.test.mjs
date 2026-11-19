import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAppServer } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function triage(input, { raw = false } = {}) {
  const reply = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? input : JSON.stringify(input),
  });
  return { code: reply.status, body: await reply.json() };
}

test("valid input returns an allowed topic and nonempty draft", async () => {
  assert.deepEqual(await triage({ text: "Уточните стоимость услуги" }), {
    code: 200,
    body: {
      status: "ready",
      topic: "pricing",
      draft: "Спасибо за обращение. Уточним детали заявки.",
    },
  });
  assert.equal((await triage({ text: "Где моя доставка?" })).body.topic, "delivery");
  assert.equal((await triage({ text: "Обычный вопрос" })).body.topic, "other");
});

test("missing, blank, non-string and malformed JSON return 400", async () => {
  const invalid = [
    {}, { text: "" }, { text: "  \n \t " }, { text: 0 },
    { text: null }, { text: [] }, null, [],
  ];
  for (const input of invalid) {
    assert.deepEqual(await triage(input), {
      code: 400,
      body: { status: "invalid_input" },
    });
  }
  assert.deepEqual(await triage('{"text":', { raw: true }), {
    code: 400,
    body: { status: "invalid_input" },
  });
});

test("provider errors and invalid output require manual review", async () => {
  const fallback = {
    code: 200,
    body: { status: "manual_review", topic: null, draft: null },
  };
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    assert.deepEqual(await triage({ text: marker }), fallback, marker);
  }
});

test("provider timeout is bounded to 300 ms and later requests recover", async () => {
  const start = performance.now();
  assert.deepEqual(await triage({ text: "[timeout]" }), {
    code: 200,
    body: { status: "manual_review", topic: null, draft: null },
  });
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 270 && elapsed < 900, `timeout took ${elapsed.toFixed(1)} ms`);
  assert.equal((await triage({ text: "доставка" })).body.status, "ready");
});

test("index page remains accessible", async () => {
  const reply = await fetch(baseUrl);
  assert.equal(reply.status, 200);
  assert.match(await reply.text(), /Ручн|ручн|Черновик ответа/);
});
