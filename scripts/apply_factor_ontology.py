#!/usr/bin/env python3
"""Merge the factor pack into src/data/graph.json (source of truth in this repo).

12_ontology/ontology.yaml is not in the hub checkout, so the graph JSON plus
src/data/ontology_factors.json is the pipeline. Idempotent: re-running replaces
pack nodes and skips duplicate edges. Does not invent figures.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "src" / "data" / "graph.json"
PACK = ROOT / "src" / "data" / "ontology_factors.json"
I18N = ROOT / "src" / "data" / "ontology_i18n.json"


def main() -> None:
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    pack = json.loads(PACK.read_text(encoding="utf-8"))
    ids = {n.get("id") for n in graph["nodes"]}
    missing = []
    for e in pack["edges"]:
        for end in (e["from"], e["to"]):
            if end not in ids and end not in {n["id"] for n in pack["nodes"]}:
                missing.append(end)
    if missing:
        raise SystemExit(f"factor pack cites unknown ids: {sorted(set(missing))}")

    rel_ids = {r["id"] for r in graph.get("relation_types") or []}
    for rel in pack["relation_types"]:
        if rel["id"] not in rel_ids:
            graph["relation_types"].append(rel)
            rel_ids.add(rel["id"])

    by_id = {n["id"]: n for n in graph["nodes"]}
    added_nodes = 0
    for node in pack["nodes"]:
        if node["id"] in by_id:
            by_id[node["id"]].update(node)
        else:
            graph["nodes"].append(node)
            by_id[node["id"]] = node
            added_nodes += 1

    seen_edges = {(e["from"], e["to"], e["predicate"]) for e in graph["edges"]}
    added_edges = 0
    for e in pack["edges"]:
        key = (e["from"], e["to"], e["predicate"])
        if key in seen_edges:
            continue
        if e["from"] not in by_id or e["to"] not in by_id:
            raise SystemExit(f"dangling edge {key}")
        graph["edges"].append({"from": e["from"], "to": e["to"], "predicate": e["predicate"]})
        seen_edges.add(key)
        added_edges += 1

    graph["version"] = "1.5"
    graph["updated"] = "2026-11-02"
    GRAPH.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if I18N.is_file():
        i18n = json.loads(I18N.read_text(encoding="utf-8"))
        for node in pack["nodes"]:
            i18n[node["id"]] = {
                "label_en": node.get("label_en") or node.get("label"),
                "summary_en": node.get("summary_en") or node.get("summary") or "",
            }
        I18N.write_text(json.dumps(i18n, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"factor_pack nodes_new={added_nodes} edges_new={added_edges} "
        f"graph_nodes={len(graph['nodes'])} graph_edges={len(graph['edges'])}"
    )


if __name__ == "__main__":
    main()
