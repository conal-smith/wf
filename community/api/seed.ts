/**
 * The categories, the ten channels and their tags, as migrations/0001_init.sql
 * inserts them. The memory repo starts from this, and repo.test.ts holds the
 * Postgres repo to the same list, so the two cannot drift apart unnoticed.
 * Adding a channel is a migration plus a line here; there is no screen for it.
 */
import { createHash } from "node:crypto";
import type { Category, Channel, PostPolicy, Tag } from "../shared/types.js";

/** The migration's substr(md5(...), 1, 16): hex, so inside the id alphabet. */
const seedId = (kind: string, key: string) =>
  createHash("md5")
    .update(`community_${kind}:${key}`)
    .digest("hex")
    .slice(0, 16);

const GEAR_TAGS = ["Question", "Review", "Sizing", "Repair", "New release"];
const AREA_TAGS = ["Dublin", "East", "South", "West", "North"];

const SEED: {
  key: string;
  name: string;
  channels: {
    slug: string;
    name: string;
    description: string;
    postPolicy?: PostPolicy;
    tags?: string[];
  }[];
}[] = [
  {
    key: "community",
    name: "Community",
    channels: [
      {
        slug: "announcements",
        name: "Announcements",
        description: "News about the site, from the people who run it.",
        postPolicy: "staff",
      },
      {
        slug: "general",
        name: "General",
        description: "Anything wingfoiling that has no better home.",
      },
    ],
  },
  {
    key: "gear",
    name: "Gear",
    channels: [
      {
        slug: "wings",
        name: "Wings",
        description: "Sizes, reviews, repairs and what is new.",
        tags: GEAR_TAGS,
      },
      {
        slug: "boards",
        name: "Boards",
        description: "Volume, shapes, reviews and repairs.",
        tags: GEAR_TAGS,
      },
      {
        slug: "foils",
        name: "Foils",
        description:
          "Front wings, masts, stabilisers and how they go together.",
        tags: GEAR_TAGS,
      },
    ],
  },
  {
    key: "riding",
    name: "Riding",
    channels: [
      {
        slug: "spots-and-conditions",
        name: "Spots and conditions",
        description: "Where to launch, what to watch for and how it is today.",
        tags: [
          "Question",
          "Conditions",
          "Access",
          "Hazard",
          "Leinster",
          "Munster",
          "Connacht",
          "Ulster",
        ],
      },
      {
        slug: "sessions",
        name: "Sessions",
        description: "Who is going out, where and when.",
        tags: AREA_TAGS,
      },
      {
        slug: "technique",
        name: "Technique",
        description: "Getting up, staying up, gybes, tacks and the rest.",
        tags: [
          "Question",
          "Beginner",
          "Gybes and tacks",
          "Jumps",
          "Waves",
          "Light wind",
        ],
      },
    ],
  },
  {
    key: "social",
    name: "Social",
    channels: [
      {
        slug: "meetups",
        name: "Meetups",
        description: "Days out, demo days and getting together off the water.",
        tags: AREA_TAGS,
      },
      {
        slug: "off-topic",
        name: "Off-topic",
        description: "Everything else.",
      },
    ],
  },
];

export const SEED_CATEGORIES: Category[] = SEED.map((c, position) => ({
  id: seedId("category", c.key),
  name: c.name,
  position,
}));

/** Every channel as a fresh database holds it: no threads, no followers. */
export const SEED_CHANNELS: Channel[] = SEED.flatMap((category) =>
  category.channels.map((c, position) => {
    const id = seedId("channel", c.slug);
    return {
      id,
      slug: c.slug,
      categoryId: seedId("category", category.key),
      name: c.name,
      description: c.description,
      postPolicy: c.postPolicy ?? "everyone",
      status: "active" as const,
      position,
      threadCount: 0,
      followerCount: 0,
      lastMessageAt: null,
      tags: (c.tags ?? []).map((label, tagPosition): Tag => ({
        id: seedId("tag", `${c.slug}:${label}`),
        channelId: id,
        label,
        position: tagPosition,
      })),
    };
  }),
);
