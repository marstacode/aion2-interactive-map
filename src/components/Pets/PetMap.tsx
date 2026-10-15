// src/components/Pets/PetMap.tsx
import React, {useEffect, useMemo, useRef} from "react";
import {MapContainer, useMap} from "react-leaflet";
import L from "leaflet";
import GameMapTiles from "@/components/Map/GameMapTiles.tsx";
import type {GameMapMeta} from "@/types/game.ts";
import {PET_CATEGORY_COLORS, type PetAtlasData, type PetZone} from "@/types/pets.ts";

type PinsProps = {
  data: PetAtlasData;
  spawnIndexes: number[];
  selectedPetIndex: number | null;
  /** Pet indexes at or above the target rank; their pins draw greyed out. */
  completedPets: Set<number>;
  rankOf: (petIndex: number) => number;
  target: number;
  onSelectPet: (petIndex: number | null) => void;
};

export const COMPLETED_PIN_COLOR = "#8b908d";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]!));
}

const PetPins: React.FC<PinsProps> = ({data, spawnIndexes, selectedPetIndex, completedPets, rankOf, target, onSelectPet}) => {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({padding: 0.5, tolerance: 4}), []);
  // Keep latest callbacks without rebuilding every pin.
  const latest = useRef({rankOf, target, onSelectPet});
  useEffect(() => {
    latest.current = {rankOf, target, onSelectPet};
  }, [rankOf, target, onSelectPet]);

  useEffect(() => {
    const group = L.layerGroup();
    const hasSelection = selectedPetIndex != null;
    const zone = spawnIndexes.length ? data.meta.zones[data.spawns[spawnIndexes[0]][0]] : null;

    // Draw completed pins first, then missing ones, with the selected pet's pins on top.
    const layerOf = (idx: number) => {
      const petIndex = data.spawns[idx][1];
      return petIndex === selectedPetIndex ? 2 : completedPets.has(petIndex) ? 0 : 1;
    };
    const ordered = [...spawnIndexes].sort((a, b) => layerOf(a) - layerOf(b));

    for (const idx of ordered) {
      const [, petIndex, x, y, monsterIndex] = data.spawns[idx];
      const pet = data.pets[petIndex];
      const hot = petIndex === selectedPetIndex;
      const dim = hasSelection && !hot;
      const greyed = completedPets.has(petIndex) && !hot;
      const marker = L.circleMarker([y, x], {
        renderer,
        radius: hot ? 7 : greyed ? 3.5 : 4.5,
        color: hot ? "#fff6c2" : "#0b1410",
        weight: hot ? 2 : 1,
        fillColor: greyed ? COMPLETED_PIN_COLOR : PET_CATEGORY_COLORS[pet.category],
        fillOpacity: dim ? (greyed ? 0.15 : 0.3) : greyed ? 0.45 : 0.95,
        opacity: dim ? 0.3 : greyed ? 0.5 : 1,
      });
      marker.bindTooltip(() => {
        const m = data.monsters[monsterIndex];
        const {rankOf: r, target: t} = latest.current;
        return `<b>${escapeHtml(pet.name)}</b><br>` +
          `<span style="opacity:.8">${pet.category} · Rank ${r(petIndex)} / target ${t}</span><br>` +
          `<span style="opacity:.8">${escapeHtml(m.name)} · Lv ${m.level}${zone ? ` · ${escapeHtml(zone.name)}` : ""}</span>`;
      }, {direction: "top", offset: [0, -6], className: "game-marker-tooltip"});
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        latest.current.onSelectPet(petIndex === selectedPetIndex ? null : petIndex);
      });
      group.addLayer(marker);
    }
    group.addTo(map);
    return () => {
      map.removeLayer(group);
    };
  }, [map, renderer, data, spawnIndexes, selectedPetIndex, completedPets]);

  // Click on empty map space clears the selection.
  useEffect(() => {
    const handler = () => latest.current.onSelectPet(null);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map]);

  return null;
};

/** Fits the map to a set of points whenever `request` changes. */
const FitController: React.FC<{ request: number; points: [number, number][]; size: number }> = ({request, points, size}) => {
  const map = useMap();
  useEffect(() => {
    if (!request) return;
    if (!points.length) {
      map.fitBounds([[0, 0], [size, size]]);
      return;
    }
    map.flyToBounds(L.latLngBounds(points.map(([x, y]) => [y, x] as [number, number])).pad(0.15), {
      maxZoom: 0,
      duration: 0.5,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return null;
};

type Props = Omit<PinsProps, "data"> & {
  data: PetAtlasData;
  zone: PetZone;
  fitRequest: number;
  fitPoints: [number, number][];
};

const PetMap: React.FC<Props> = ({data, zone, fitRequest, fitPoints, ...pinProps}) => {
  const meta = useMemo<GameMapMeta>(() => {
    const tiles = Math.round(zone.size / 1024);
    return {
      id: zone.map,
      name: zone.map,
      type: zone.map.startsWith("Abyss") ? "abyss" : zone.map.includes("_D_") ? "dark" : "light",
      tileWidth: 1024,
      tileHeight: 1024,
      tilesCountX: tiles,
      tilesCountY: tiles,
      isVisible: true,
    };
  }, [zone]);

  const bounds: L.LatLngBoundsExpression = [[0, 0], [zone.size, zone.size]];

  return (
    <MapContainer
      key={zone.map}
      bounds={bounds}
      maxBounds={[[-zone.size * 0.25, -zone.size * 0.25], [zone.size * 1.25, zone.size * 1.25]]}
      minZoom={-4}
      maxZoom={2}
      zoomSnap={0.25}
      zoomDelta={0.5}
      crs={L.CRS.Simple}
      className="pet-map w-full h-full bg-[#0b141a]"
      attributionControl={false}
      preferCanvas
    >
      <GameMapTiles selectedMap={meta}/>
      <PetPins data={data} {...pinProps}/>
      <FitController request={fitRequest} points={fitPoints} size={zone.size}/>
    </MapContainer>
  );
};

export default PetMap;
