import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "page must include its controller script");

function setup(fetchMock) {
  const elements = new Map();
  for (const selector of ["form", "#message", "#status", "#output", "#topic", "#draft"]) {
    elements.set(selector, {
      textContent: "",
      value: "",
      hidden: selector === "#output",
      addEventListener(name, handler) { this[name] = handler; },
    });
  }
  const document = { querySelector: (selector) => elements.get(selector) };
  runInNewContext(script, { document, fetch: fetchMock, AbortController });
  const get = (selector) => elements.get(selector);
  const submit = async (text) => {
    get("#message").value = text;
    await get("form").submit({ preventDefault() {} });
  };
  return { get, submit };
}

function reply(body, ok = true) {
  return { ok, json: async () => body };
}

test("manual review and blank input clear a previous successful draft", async () => {
  const responses = [
    reply({ status: "ready", topic: "delivery", draft: "Ответ клиенту" }),
    reply({ status: "manual_review", topic: null, draft: null }),
  ];
  const { get, submit } = setup(async () => responses.shift());
  await submit("Где доставка?");
  assert.equal(get("#output").hidden, false);
  assert.equal(get("#draft").textContent, "Ответ клиенту");

  await submit("[bad-json]");
  assert.equal(get("#output").hidden, true);
  assert.equal(get("#topic").textContent, "");
  assert.equal(get("#draft").textContent, "");
  assert.match(get("#status").textContent, /вручную/);

  await submit("   ");
  assert.equal(get("#draft").textContent, "");
  assert.match(get("#status").textContent, /Введите текст/);
});

test("older response cannot overwrite the newest result", async () => {
  const pending = [];
  const { get, submit } = setup(() => new Promise((resolve) => pending.push(resolve)));

  const first = submit("Первый вопрос");
  const second = submit("Сколько стоит?");
  pending[1](reply({ status: "ready", topic: "pricing", draft: "Новый ответ" }));
  await second;
  pending[0](reply({ status: "ready", topic: "other", draft: "Устаревший ответ" }));
  await first;

  assert.equal(get("#topic").textContent, "Стоимость");
  assert.equal(get("#draft").textContent, "Новый ответ");
});
