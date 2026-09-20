/**
 * The community's HTTP surface, mounted at /api/community by createApp, which
 * also gives the subtree its CORS, optionalAuth and error handling. Reading
 * is public; every write needs a session. The routes live in handlers/, one
 * file per kind of thing a caller does.
 */
import { Hono } from "hono";
import type { CommunityDeps, Env } from "./handlers/context.js";
import { readRoutes } from "./handlers/read.js";
import { uploadRoutes } from "./handlers/uploads.js";
import { writeRoutes } from "./handlers/write.js";
import { blockSuspended } from "../../site/api/router.js";

export type { CommunityDeps };

export function createCommunityRouter(deps: CommunityDeps) {
  const r = new Hono<Env>();
  r.use("*", blockSuspended(deps.people.users));
  readRoutes(r, deps);
  writeRoutes(r, deps);
  uploadRoutes(r, deps);
  return r;
}
