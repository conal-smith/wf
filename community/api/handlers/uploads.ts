/**
 * Photos. The marketplace's presign flow, issuing keys under the community's
 * own prefix: the browser asks for a link, PUTs the bytes straight to storage
 * and sends the key back with the message. With the local driver the signed
 * link points at the marketplace's upload routes, which take any key this API
 * signed.
 */
import {
  jsonBody,
  readJson,
  UPLOAD_PREFIX,
  type CommunityDeps,
  type Router,
} from "./context.js";
import { requireAuth } from "../../../market/api/src/auth.js";
import { presignRequestSchema } from "../../../market/shared/validate.js";

export function uploadRoutes(r: Router, { storage }: CommunityDeps) {
  r.post("/uploads", requireAuth, jsonBody, async (c) => {
    const { contentType } = presignRequestSchema.parse(await readJson(c));
    const key = storage.keyFor(c.var.userId!, contentType, UPLOAD_PREFIX);
    return c.json(await storage.presign(key, contentType));
  });
}
