#!/usr/bin/env python3
"""Convert the AION 2 Pet Atlas page's embedded DATA into public/data/pets/atlas.json.

Usage:
    curl -sSo /tmp/atlas.html https://pristine-zone-6q93xmk.shipstatic.com/
    python3 scripts/import_pet_atlas.py /tmp/atlas.html

The source stores spawn y as image-space (top-down). This map uses Leaflet
CRS.Simple with y measured bottom-up (see GameMarker / GameMapBorders), so y is
flipped here: y' = mapSize - y.
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "pets" / "atlas.json"


def main(src: str) -> None:
    html = Path(src).read_text(encoding="utf-8")
    start = html.index("const DATA=") + len("const DATA=")
    data, _ = json.JSONDecoder().raw_decode(html, start)

    meta = data["meta"]
    zones = [
        {"id": z["id"], "name": z["name"], "short": z["short"], "map": z["mapCode"], "size": z["mapSize"]}
        for z in meta["zones"]
    ]
    pets = [
        {
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "kind": p["sourceKind"],
            "zones": p["zones"],
            "spawnCounts": p["spawnCounts"],
            "sources": p["sources"],
        }
        for p in data["pets"]
    ]
    monsters = [
        {"name": m["name"], "level": m["level"], "rank": m["rank"], "zone": m["zone"]}
        for m in data["monsters"]
    ]
    # [zoneIndex, petIndex, x, y, monsterIndex]
    spawns = [
        [z, p, round(x, 1), round(zones[z]["size"] - y, 1), m]
        for z, p, x, y, m in data["spawns"]
    ]

    out = {
        "meta": {
            "schema": "aion2-pet-atlas-repo-v1",
            "client": meta.get("client", {}).get("label", ""),
            "source": "https://pristine-zone-6q93xmk.shipstatic.com/",
            "categories": meta["categories"],
            "zones": zones,
        },
        "pets": pets,
        "monsters": monsters,
        "spawns": spawns,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(pets)} pets, {len(monsters)} monsters, {len(spawns)} spawns)")


if __name__ == "__main__":
    main(sys.argv[1])
