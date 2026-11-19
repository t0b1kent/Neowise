import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const allowedTopics = new Set(["delivery", "pricing", "other"]);
const manualReview = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readInput(request) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_000_000) return null;
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return input !== null && typeof input === "object" && !Array.isArray(input) &&
      typeof input.text === "string" && input.text.trim()
      ? input.text.trim()
      : null;
  } catch {
    return null;
  }
}

async function classifyWithTimeout(text) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      classify(text, { signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Model timeout"));
        }, 300);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function handleTriage(request, response) {
  const text = await readInput(request);
  if (text === null) return json(response, 400, { status: "invalid_input" });

  try {
    const result = JSON.parse(await classifyWithTimeout(text));
    if (result === null || typeof result !== "object" || Array.isArray(result) ||
        !allowedTopics.has(result.topic) || typeof result.draft !== "string" ||
        !result.draft.trim()) {
      return json(response, 200, manualReview);
    }
    return json(response, 200, {
      status: "ready",
      topic: result.topic,
      draft: result.draft.trim(),
    });
  } catch {
    return json(response, 200, manualReview);
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      if (!response.headersSent) json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
  }
