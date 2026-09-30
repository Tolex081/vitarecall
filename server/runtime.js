import path from "node:path";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createMemoryService } from "./memory.js";
import { createChatService } from "./llm.js";

// Create one reusable app/pool per process, never a SQLite database in /tmp.
// Migrations are an explicit deployment step, not a cold-start side effect.
export async function createRuntime(config = loadConfig(), dependencies = {}) {
  let store;
  if (config.databaseUrl) {
    const createPostgresStore = dependencies.createPostgresStore || (await import("./postgres-store.js")).createPostgresStore;
    store = await createPostgresStore({ connectionString: config.databaseUrl, ca: config.databaseCaCert });
  } else {
    if (config.vercel) throw new Error("DATABASE_URL is required on Vercel. SQLite is only available for local or persistent-server use.");
    const createStore = dependencies.createStore || (await import("./store.js")).createStore;
    store = await createStore(path.join(config.dataDir, "vitarecall.sqlite"));
  }
  try {
    if (config.vercel) {
      const attach = dependencies.attachDatabasePool || (await import("@vercel/functions")).attachDatabasePool;
      attach(store.pool);
    }
    const memory = (dependencies.createMemoryService || createMemoryService)(config);
    const chat = (dependencies.createChatService || createChatService)(config);
    const app = (dependencies.createApp || createApp)({ config, store, memory, chat });
    return { app, config, store };
  } catch (error) {
    await store.close();
    throw error;
  }
}

export function createRuntimeLoader(create = createRuntime) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(create).catch(error => {
      pending = undefined; // Allow recovery after a transient cold-start connection failure.
      throw error;
    });
    return pending;
  };
}

export const getRuntime = createRuntimeLoader();

export function createFunctionHandler(load = getRuntime) {
  return async function handler(req, res) {
    try {
      const { app } = await load();
      // Express may complete asynchronously. Keep the function alive until it responds.
      await new Promise((resolve, reject) => {
        const completed = () => { res.off("finish", completed); res.off("close", completed); resolve(); };
        res.once("finish", completed);
        res.once("close", completed);
        try { app(req, res); } catch (error) {
          res.off("finish", completed);
          res.off("close", completed);
          reject(error);
        }
      });
    } catch {
      // Configuration, connection strings, database errors and patient data stay private.
      console.error("VitaRecall API initialization or dispatch failed. Check server configuration and database availability.");
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(JSON.stringify({ error: "The server is temporarily unavailable. Please try again shortly.", code: "SERVICE_UNAVAILABLE" }));
      } else if (!res.writableEnded) res.end();
    }
  };
}
