/**
 * The community's HTTP surface, mounted at /api/community by createApp, which
 * also gives the subtree its CORS, optionalAuth and error handling. Reading
 * is public; every write needs a session. The routes live in handlers/, one
 * file per kind of thing a caller does.
 */
import { Hono } from "hono";
import { memoryHub } from "./hub.js";
import type { CommunityDeps, Env } from "./handlers/context.js";
import { eventRoutes } from "./handlers/events.js";
import { followRoutes } from "./handlers/follow.js";
import { notificationRoutes } from "./handlers/notifications.js";
import { readRoutes } from "./handlers/read.js";
import { uploadRoutes } from "./handlers/uploads.js";
import { writeRoutes } from "./handlers/write.js";
import { blockSuspended } from "../../site/api/router.js";

export type { CommunityDeps };

export function createCommunityRouter(deps: CommunityDeps) {
  const r = new Hono<Env>();
  r.use("*", blockSuspended(deps.people.users));
  const live = { ...deps, hub: deps.hub ?? memoryHub() };
  readRoutes(r, deps);
  writeRoutes(r, live);
  followRoutes(r, deps);
  notificationRoutes(r, deps);
  uploadRoutes(r, deps);
  eventRoutes(r, live);
  return r;
}
