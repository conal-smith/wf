/**
 * V8 heap snapshots, taken over CDP and summed by constructor, so two can be
 * compared without opening DevTools: what grew between them, by count and by
 * retained-size-free self size (the "Comparison" view's columns).
 */
import { writeFile } from "node:fs/promises";

/** Take a snapshot after a full GC; optionally keep the raw file. */
export async function takeSnapshot(session, keepPath) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  session.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await session.send("HeapProfiler.enable");
  await session.send("HeapProfiler.collectGarbage");
  await session.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
    captureNumericValue: false,
  });
  session.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  const text = chunks.join("");
  if (keepPath) await writeFile(keepPath, text);
  return summariseSnapshot(JSON.parse(text));
}

const GROUP = {
  array: "(array)",
  string: "(string)",
  "concatenated string": "(string)",
  "sliced string": "(string)",
  code: "(compiled code)",
  hidden: "(system)",
  number: "(number)",
  bigint: "(bigint)",
  "object shape": "(object shape)",
};

export function summariseSnapshot(snapshot) {
  const { node_fields: fields, node_types: types } = snapshot.snapshot.meta;
  const typeNames = types[0];
  const width = fields.length;
  const at = {
    type: fields.indexOf("type"),
    name: fields.indexOf("name"),
    size: fields.indexOf("self_size"),
  };
  const nodes = snapshot.nodes;
  const strings = snapshot.strings;
  const groups = new Map();
  let total = 0;
  let count = 0;
  for (let i = 0; i < nodes.length; i += width) {
    const type = typeNames[nodes[i + at.type]];
    if (type === "synthetic") continue;
    const size = nodes[i + at.size];
    let key = GROUP[type];
    if (!key) {
      key = strings[nodes[i + at.name]] || `(${type})`;
      // Closures and objects by name; a long anonymous name is cut down.
      if (key.length > 80) key = `${key.slice(0, 77)}...`;
      if (type === "closure") key = `${key}()`;
    }
    const g = groups.get(key) ?? { count: 0, size: 0 };
    g.count++;
    g.size += size;
    groups.set(key, g);
    total += size;
    count++;
  }
  return {
    totalBytes: total,
    nodes: count,
    groups: Object.fromEntries(groups),
  };
}

/** What grew from `a` to `b`: the largest gains by self size. */
export function compareSnapshots(a, b, top = 20) {
  const keys = new Set([...Object.keys(a.groups), ...Object.keys(b.groups)]);
  const rows = [...keys].map((key) => {
    const before = a.groups[key] ?? { count: 0, size: 0 };
    const after = b.groups[key] ?? { count: 0, size: 0 };
    return {
      name: key,
      countBefore: before.count,
      countAfter: after.count,
      countDelta: after.count - before.count,
      bytesDelta: after.size - before.size,
    };
  });
  rows.sort((x, y) => y.bytesDelta - x.bytesDelta);
  return {
    totalBefore: a.totalBytes,
    totalAfter: b.totalBytes,
    totalDelta: b.totalBytes - a.totalBytes,
    nodesDelta: b.nodes - a.nodes,
    grew: rows.slice(0, top),
    shrank: rows.slice(-5).reverse(),
  };
}
