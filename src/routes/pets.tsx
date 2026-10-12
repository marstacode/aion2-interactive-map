import {createFileRoute} from "@tanstack/react-router";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Button, Input, Select, SelectItem, Spinner, Switch, Tab, Tabs} from "@heroui/react";
import {getStaticUrl} from "@/utils/url.ts";
import PetMap from "@/components/Pets/PetMap.tsx";
import {
  PET_CATEGORY_COLORS,
  PET_MAX_RANK,
  type Pet,
  type PetAtlasData,
  type PetCategory,
  type PetRanks,
} from "@/types/pets.ts";
import {STORAGE_PREFIX} from "@/constants.ts";

const PROGRESS_STORAGE_KEY = `${STORAGE_PREFIX}.petAtlas.progress.v1`;
const VIEW_STORAGE_KEY = `${STORAGE_PREFIX}.petAtlas.view.v1`;

type Availability = "all" | "zone" | "nonfield";

type Progress = { target: number; ranks: PetRanks };

type ViewState = {
  category: PetCategory | "";
  availability: Availability;
  showCompleted: boolean;
  zone: number;
};

const DEFAULT_VIEW: ViewState = {category: "Cogni", availability: "all", showCompleted: true, zone: 0};

function clampRank(n: unknown) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(PET_MAX_RANK, v)) : 0;
}

function normalizeProgress(raw: unknown): Progress {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ranks: PetRanks = {};
  if (obj.ranks && typeof obj.ranks === "object") {
    for (const [id, r] of Object.entries(obj.ranks as Record<string, unknown>)) {
      const v = clampRank(r);
      if (v > 0) ranks[id] = v;
    }
  }
  return {target: Math.max(1, clampRank(obj.target) || 1), ranks};
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.) — progress stays in memory
  }
}

const CategoryDot: React.FC<{ category: PetCategory; size?: number }> = ({category, size = 10}) => (
  <span
    className="inline-block shrink-0 rounded-full"
    style={{width: size, height: size, background: PET_CATEGORY_COLORS[category]}}
  />
);

const RankPips: React.FC<{ rank: number; target: number; onChange: (rank: number) => void; color: string }> = (
  {rank, target, onChange, color},
) => (
  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
    {Array.from({length: PET_MAX_RANK}, (_, i) => i + 1).map((r) => {
      const filled = rank >= r;
      return (
        <button
          key={r}
          type="button"
          title={filled && rank === r ? `Clear to rank ${r - 1}` : `Set rank ${r}`}
          aria-label={`Rank ${r}`}
          onClick={() => onChange(rank === r ? r - 1 : r)}
          className={`h-6 w-6 rounded-md border text-[11px] font-semibold transition-colors ${
            r === target ? "ring-1 ring-offset-0 ring-default-400" : ""
          } ${filled ? "text-black border-transparent" : "border-default-300 text-default-500 hover:border-default-500"}`}
          style={filled ? {background: color} : undefined}
        >
          {r}
        </button>
      );
    })}
  </div>
);

function Page() {
  const [data, setData] = useState<PetAtlasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(() => normalizeProgress(readJson(PROGRESS_STORAGE_KEY, null)));
  const [view, setView] = useState<ViewState>(() => ({...DEFAULT_VIEW, ...readJson(VIEW_STORAGE_KEY, {})}));
  const [query, setQuery] = useState("");
  const [selectedPetIndex, setSelectedPetIndex] = useState<number | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [fitToSelected, setFitToSelected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(getStaticUrl(`data/pets/atlas.json?build=${__BUILD_GIT_COMMIT__}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PetAtlasData) => setData(d))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => writeJson(PROGRESS_STORAGE_KEY, progress), [progress]);
  useEffect(() => writeJson(VIEW_STORAGE_KEY, view), [view]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedPetIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const zoneIndex = data ? Math.min(view.zone, data.meta.zones.length - 1) : 0;
  const zone = data?.meta.zones[zoneIndex];
  const {target, ranks} = progress;

  const rankOf = useCallback((petIndex: number) => (data ? ranks[data.pets[petIndex].id] ?? 0 : 0), [data, ranks]);
  const isDone = useCallback((p: Pet) => (ranks[p.id] ?? 0) >= target, [ranks, target]);

  const setRank = useCallback((p: Pet, rank: number) => {
    setProgress((prev) => {
      const next = {...prev.ranks};
      const v = clampRank(rank);
      if (v > 0) next[p.id] = v; else delete next[p.id];
      return {...prev, ranks: next};
    });
  }, []);

  // Pet index lookups.
  const monsterNames = useCallback(
    (p: Pet, zi?: number) => {
      if (!data) return [];
      const idxs = zi == null ? p.sources.flat() : p.sources[zi] ?? [];
      return [...new Set(idxs.map((i) => data.monsters[i].name))];
    },
    [data],
  );

  const matchesFilters = useCallback(
    (p: Pet) => {
      if (view.category && p.category !== view.category) return false;
      if (view.availability === "zone" && !p.zones.includes(zoneIndex)) return false;
      if (view.availability === "nonfield" && p.zones.length) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || monsterNames(p).some((n) => n.toLowerCase().includes(q));
    },
    [view.category, view.availability, zoneIndex, query, monsterNames],
  );

  const listPets = useMemo(() => {
    if (!data) return [];
    return data.pets
      .map((p, index) => ({p, index}))
      .filter(({p}) => matchesFilters(p) && (view.showCompleted || !isDone(p)))
      .sort((a, b) =>
        Number(isDone(a.p)) - Number(isDone(b.p)) ||
        Number(b.p.zones.includes(zoneIndex)) - Number(a.p.zones.includes(zoneIndex)) ||
        a.p.category.localeCompare(b.p.category) ||
        a.p.name.localeCompare(b.p.name));
  }, [data, matchesFilters, view.showCompleted, isDone, zoneIndex]);

  // Pins: spawns in the current zone for pets that match the filters and are below target.
  const spawnIndexes = useMemo(() => {
    if (!data) return [];
    const out: number[] = [];
    data.spawns.forEach((s, i) => {
      if (s[0] !== zoneIndex) return;
      const p = data.pets[s[1]];
      if (!isDone(p) && matchesFilters(p)) out.push(i);
    });
    return out;
  }, [data, zoneIndex, isDone, matchesFilters]);

  const missingPetsOnMap = useMemo(
    () => (data ? new Set(spawnIndexes.map((i) => data.spawns[i][1])).size : 0),
    [data, spawnIndexes],
  );

  const stats = useMemo(() => {
    if (!data) return null;
    const byCategory = data.meta.categories.map((c) => {
      const pets = data.pets.filter((p) => p.category === c);
      return {category: c, total: pets.length, done: pets.filter(isDone).length};
    });
    const zoneMissing = data.meta.zones.map((_, zi) =>
      data.pets.filter((p) => p.zones.includes(zi) && !isDone(p) && (!view.category || p.category === view.category)).length);
    return {
      total: data.pets.length,
      done: data.pets.filter(isDone).length,
      byCategory,
      zoneMissing,
    };
  }, [data, isDone, view.category]);

  const selectedPet = data && selectedPetIndex != null ? data.pets[selectedPetIndex] : null;

  const fitPoints = useMemo<[number, number][]>(() => {
    if (!data || !fitToSelected || selectedPetIndex == null) return [];
    return data.spawns
      .filter((s) => s[0] === zoneIndex && s[1] === selectedPetIndex)
      .map((s) => [s[2], s[3]]);
  }, [data, fitToSelected, selectedPetIndex, zoneIndex]);

  const focusPet = useCallback((petIndex: number) => {
    setSelectedPetIndex(petIndex);
    setFitToSelected(true);
    setFitRequest((n) => n + 1);
  }, []);

  const selectFromList = (petIndex: number) => {
    if (!data) return;
    if (selectedPetIndex === petIndex) {
      setSelectedPetIndex(null);
      return;
    }
    const p = data.pets[petIndex];
    if (p.zones.length && !p.zones.includes(zoneIndex)) {
      setView((v) => ({...v, zone: p.zones[0]}));
    }
    if (p.zones.length) focusPet(petIndex);
    else setSelectedPetIndex(petIndex);
  };

  const switchZone = (zi: number) => {
    setView((v) => ({...v, zone: zi}));
    setFitToSelected(false);
  };

  const exportProgress = () => {
    const payload = {schema: "aion2-pet-atlas-progress-v1", exportedAt: new Date().toISOString(), target, ranks};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aion2-pet-progress.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setToast("Progress exported.");
  };

  const importProgress = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !parsed.ranks) throw new Error("No pet ranks found in file");
      const next = normalizeProgress(parsed);
      setProgress(next);
      setToast(`Imported ranks for ${Object.keys(next.ranks).length} pets.`);
    } catch (e) {
      setToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const resetProgress = () => {
    if (!window.confirm("Reset all pet ranks? Export first if you want a backup.")) return;
    setProgress((prev) => ({...prev, ranks: {}}));
    setToast("Pet ranks reset.");
  };

  if (error) {
    return <div className="flex-1 flex items-center justify-center text-danger">Failed to load pet data: {error}</div>;
  }
  if (!data || !zone || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner label="Loading pet atlas..."/>
      </div>
    );
  }

  const rowMeta = (p: Pet) => {
    if (p.zones.includes(zoneIndex)) {
      const names = monsterNames(p, zoneIndex);
      const n = p.spawnCounts[zoneIndex];
      return `${n.toLocaleString()} ${zone.name} spawn${n === 1 ? "" : "s"} · ${names.slice(0, 2).join(", ")}${
        names.length > 2 ? ` +${names.length - 2}` : ""}`;
    }
    if (!p.zones.length) return p.kind === "special" ? "Special pet · no field spawn" : "No tracked open-world spawn";
    return `Available in ${p.zones.map((zi) => data.meta.zones[zi].name).join(" · ")}`;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-default-200 px-4 py-2">
        <div className="text-sm">
          <div className="text-lg font-bold leading-tight">{stats.done} / {stats.total}</div>
          <div className="text-xs text-default-500">pets at Rank {target}+</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {stats.byCategory.map(({category, total, done}) => {
            const active = view.category === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setView((v) => ({...v, category: active ? "" : category}))}
                className={`min-w-[108px] rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  active ? "border-default-600 bg-default-100" : "border-default-200 hover:border-default-400"}`}
                title={active ? "Show all types" : `Filter to ${category}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <CategoryDot category={category}/>
                  {category}
                  <span className="ml-auto tabular-nums text-default-600">{done}/{total}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-default-200">
                  <div
                    className="h-full rounded-full"
                    style={{width: `${total ? (done / total) * 100 : 0}%`, background: PET_CATEGORY_COLORS[category]}}
                  />
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-default-500">Target</span>
          <Tabs
            size="sm"
            selectedKey={String(target)}
            onSelectionChange={(k) => setProgress((prev) => ({...prev, target: Number(k)}))}
            aria-label="Collection target rank"
          >
            {[1, 2, 3].map((r) => <Tab key={String(r)} title={`Rank ${r}`}/>)}
          </Tabs>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="bordered" onPress={exportProgress}>Export</Button>
          <Button size="sm" variant="bordered" onPress={() => fileInputRef.current?.click()}>Import</Button>
          <Button size="sm" variant="bordered" color="danger" onPress={resetProgress}>Reset</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importProgress(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Sidebar */}
        <aside className="flex min-h-0 h-[45%] md:h-auto w-full md:w-[400px] shrink-0 flex-col border-b md:border-b-0 md:border-r border-default-200">
          <div className="grid grid-cols-[1fr_130px] gap-2 border-b border-default-200 p-3">
            <Input
              size="sm"
              isClearable
              placeholder="Search pet or source monster…"
              value={query}
              onValueChange={setQuery}
              aria-label="Search pets"
            />
            <Select
              size="sm"
              aria-label="Pet type"
              selectedKeys={[view.category || "all"]}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as string | undefined;
                setView((v) => ({...v, category: !k || k === "all" ? "" : (k as PetCategory)}));
              }}
            >
              {[{key: "all", label: "All types"}, ...data.meta.categories.map((c) => ({key: c, label: c}))].map((o) => (
                <SelectItem key={o.key}>{o.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              aria-label="Availability"
              selectedKeys={[view.availability]}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as Availability | undefined;
                if (k) setView((v) => ({...v, availability: k}));
              }}
            >
              <SelectItem key="all">All pets</SelectItem>
              <SelectItem key="zone">Pets on current map</SelectItem>
              <SelectItem key="nonfield">No field spawn (dungeon / special)</SelectItem>
            </Select>
            <Switch
              size="sm"
              isSelected={view.showCompleted}
              onValueChange={(on) => setView((v) => ({...v, showCompleted: on}))}
            >
              <span className="text-xs">Completed</span>
            </Switch>
            <div className="col-span-2 flex justify-between text-[11px] text-default-500">
              <span>{listPets.length} shown</span>
              <span>Click a pet to show its spawns · Esc to deselect</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {listPets.map(({p, index}) => {
              const done = isDone(p);
              const selected = index === selectedPetIndex;
              const rank = ranks[p.id] ?? 0;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectFromList(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") selectFromList(index);
                  }}
                  className={`mb-1 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                    selected ? "border-default-500 bg-default-100" : "border-transparent hover:bg-default-100"
                  } ${done ? "opacity-50" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <CategoryDot category={p.category}/>
                      <span className={`truncate text-sm font-medium ${done ? "line-through" : ""}`}>{p.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-default-500">{rowMeta(p)}</div>
                    <div className="mt-1 flex gap-1">
                      {p.zones.map((zi) => (
                        <span
                          key={zi}
                          className={`rounded px-1 text-[10px] font-semibold ${
                            zi === zoneIndex ? "bg-default-300 text-default-900" : "bg-default-100 text-default-500"}`}
                          title={data.meta.zones[zi].name}
                        >
                          {data.meta.zones[zi].short}
                        </span>
                      ))}
                      {!p.zones.length && (
                        <span className="rounded bg-default-100 px-1 text-[10px] font-semibold text-default-500">
                          {p.kind === "special" ? "SPECIAL" : "OTHER"}
                        </span>
                      )}
                    </div>
                  </div>
                  <RankPips rank={rank} target={target} color={PET_CATEGORY_COLORS[p.category]} onChange={(r) => setRank(p, r)}/>
                </div>
              );
            })}
            {!listPets.length && <div className="p-4 text-center text-sm text-default-500">No pets match these filters.</div>}
          </div>
        </aside>

        {/* Map column */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default-200 px-3 py-1.5">
            <Tabs
              size="sm"
              variant="underlined"
              selectedKey={String(zoneIndex)}
              onSelectionChange={(k) => switchZone(Number(k))}
              aria-label="Zone"
            >
              {data.meta.zones.map((z, zi) => (
                <Tab
                  key={String(zi)}
                  title={
                    <span className="flex items-center gap-1.5">
                      {z.name}
                      <span className="rounded-full bg-default-200 px-1.5 text-[10px] tabular-nums">{stats.zoneMissing[zi]}</span>
                    </span>
                  }
                />
              ))}
            </Tabs>
            <span className="text-xs text-default-500">
              {spawnIndexes.length.toLocaleString()} pins · {missingPetsOnMap} missing pets
            </span>
          </div>
          <div className="relative flex-1 min-h-0">
            <PetMap
              data={data}
              zone={zone}
              spawnIndexes={spawnIndexes}
              selectedPetIndex={selectedPetIndex}
              rankOf={rankOf}
              target={target}
              onSelectPet={setSelectedPetIndex}
              fitRequest={fitRequest}
              fitPoints={fitPoints}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
              {data.meta.categories.map((c) => (
                <span key={c} className="flex items-center gap-1"><CategoryDot category={c} size={8}/>{c}</span>
              ))}
            </div>
            {toast && (
              <div className="absolute right-3 top-3 z-[1000] rounded-md bg-black/80 px-3 py-1.5 text-sm text-white shadow-lg">
                {toast}
              </div>
            )}
          </div>
          {/* Detail panel */}
          <div className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-t border-default-200 px-4 py-2">
            {selectedPet && selectedPetIndex != null ? (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-default-500">
                    <CategoryDot category={selectedPet.category}/>
                    {selectedPet.category} · Rank {ranks[selectedPet.id] ?? 0} / {PET_MAX_RANK}
                    {isDone(selectedPet) ? " · target met" : ""}
                  </div>
                  <div className="text-base font-semibold">{selectedPet.name}</div>
                  <div className="text-xs text-default-500">
                    {selectedPet.zones.includes(zoneIndex)
                      ? `${selectedPet.spawnCounts[zoneIndex].toLocaleString()} spawns in ${zone.name} · ${
                        selectedPet.sources[zoneIndex].map((i) => `${data.monsters[i].name} (Lv ${data.monsters[i].level})`).join(" · ")}`
                      : selectedPet.zones.length
                        ? `No ${zone.name} source · available in ${selectedPet.zones.map((zi) => data.meta.zones[zi].name).join(", ")}`
                        : "No tracked open-world source."}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedPet.zones.includes(zoneIndex) && !isDone(selectedPet) && (
                    <Button size="sm" variant="flat" onPress={() => focusPet(selectedPetIndex)}>Fit spawns</Button>
                  )}
                  {selectedPet.zones.filter((zi) => zi !== zoneIndex).map((zi) => (
                    <Button
                      key={zi}
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        setView((v) => ({...v, zone: zi}));
                        focusPet(selectedPetIndex);
                      }}
                    >
                      Go to {data.meta.zones[zi].name}
                    </Button>
                  ))}
                  <RankPips
                    rank={ranks[selectedPet.id] ?? 0}
                    target={target}
                    color={PET_CATEGORY_COLORS[selectedPet.category]}
                    onChange={(r) => setRank(selectedPet, r)}
                  />
                  <Button size="sm" variant="light" onPress={() => setSelectedPetIndex(null)}>Deselect</Button>
                </div>
              </>
            ) : (
              <div className="text-sm text-default-500">
                Pick a pet from the list or click a pin. Pets at or above Rank {target} are hidden from the map.
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="border-t border-default-200 px-4 py-1 text-[10px] text-default-400">
        Pet spawn data: {data.meta.client} via AION 2 Pet Atlas. Progress is stored in this browser — use Export to back it up.
      </div>
    </div>
  );
}

export const Route = createFileRoute("/pets")({
  component: Page,
});
