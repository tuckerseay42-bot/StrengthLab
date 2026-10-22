// The composition surface for the Athleticism Report's quality→metric
// mapping: drag quality columns to reorder, drag a metric to reorder it
// within a column or in from the "available metrics" tray — or use the
// exact non-drag equivalents (move-up/down, +add, x-remove) that call the
// same handlers, since not every coach wants to drag on a touch device.
// Adapted from a purchased bundle's QualityBoard.tsx: that version lets a
// coach add/remove whole qualities from a variable 3-8 of 8 set. This
// app's 7 qualities are fixed — every quality always appears in the
// report, just possibly unconfigured — so only reordering applies here,
// not adding/removing a quality column.
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  QUALITIES,
  QUALITY_COLORS,
  MAX_METRICS_PER_QUALITY,
  MAX_HIGHLIGHTS,
  type QualityKey,
  type ReportConfig,
  type MetricOption,
} from "@/lib/athleticism-report";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { GripVertical, Star, X, ChevronUp, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const QUALITY_PREFIX = "quality::";
const METRIC_PREFIX = "metric::";
const TRAY_PREFIX = "tray::";

const qualityId = (key: QualityKey) => `${QUALITY_PREFIX}${key}`;
const metricId = (key: QualityKey, metricKey: string) => `${METRIC_PREFIX}${key}::${metricKey}`;
const trayId = (key: QualityKey, metricKey: string) => `${TRAY_PREFIX}${key}::${metricKey}`;

function qualityOfId(id: string): QualityKey | null {
  if (id.startsWith(QUALITY_PREFIX)) return id.slice(QUALITY_PREFIX.length) as QualityKey;
  if (id.startsWith(METRIC_PREFIX))
    return id.slice(METRIC_PREFIX.length).split("::")[0] as QualityKey;
  if (id.startsWith(TRAY_PREFIX)) return id.slice(TRAY_PREFIX.length).split("::")[0] as QualityKey;
  return null;
}

type Props = {
  config: ReportConfig;
  setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>;
  options: MetricOption[];
  qualityOrder: QualityKey[];
  setQualityOrder: (order: QualityKey[]) => void;
};

function MetricChip({
  qualityKey,
  metricKey,
  label,
  highlighted,
  index,
  count,
  onRemove,
  onToggleHighlight,
  onMove,
  highlightDisabled,
}: {
  qualityKey: QualityKey;
  metricKey: string;
  label: string;
  highlighted: boolean;
  index: number;
  count: number;
  onRemove: () => void;
  onToggleHighlight: () => void;
  onMove: (direction: "up" | "down") => void;
  highlightDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: metricId(qualityKey, metricKey),
  });
  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={`Drag ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onToggleHighlight}
        aria-pressed={highlighted}
        aria-label={highlighted ? "Unstar" : "Star to highlight"}
        disabled={!highlighted && highlightDisabled}
        className="shrink-0"
      >
        <Star
          className={cn(
            "h-3.5 w-3.5",
            highlighted
              ? "fill-[oklch(0.82_0.17_85)] text-[oklch(0.82_0.17_85)]"
              : "text-muted-foreground",
          )}
        />
      </button>
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={index === 0}
          aria-label={`Move ${label} up`}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={index === count - 1}
          aria-label={`Move ${label} down`}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TrayChip({
  qualityKey,
  metricKey,
  label,
  onAdd,
}: {
  qualityKey: QualityKey;
  metricKey: string;
  label: string;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: trayId(qualityKey, metricKey),
  });
  const style = { transform: CSS.Translate.toString(transform) };

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onAdd}
      className={cn(
        "rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted",
        isDragging && "opacity-50",
      )}
      {...attributes}
      {...listeners}
    >
      + {label}
    </button>
  );
}

function QualityColumn({
  qualityKey,
  label,
  index,
  count,
  picked,
  available,
  starred,
  highlightedCount,
  metricLabel,
  onMoveQuality,
  onRemoveMetric,
  onToggleStar,
  onMoveMetric,
  onAddMetric,
}: {
  qualityKey: QualityKey;
  label: string;
  index: number;
  count: number;
  picked: string[];
  available: MetricOption[];
  starred: string[];
  highlightedCount: number;
  metricLabel: (key: string) => string;
  onMoveQuality: (direction: "up" | "down") => void;
  onRemoveMetric: (key: string) => void;
  onToggleStar: (key: string) => void;
  onMoveMetric: (key: string, direction: "up" | "down") => void;
  onAddMetric: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: qualityId(qualityKey),
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: qualityId(qualityKey) });
  const style = { transform: CSS.Translate.toString(transform), transition };

  const [search, setSearch] = useState("");
  const trayItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return available.slice(0, 8);
    return available.filter((o) => o.label.toLowerCase().includes(term));
  }, [available, search]);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: QUALITY_COLORS[qualityKey] }}
      className={cn(
        "rounded-lg border border-border/60 border-l-[3px] p-2.5",
        isDragging && "opacity-60",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          aria-label={`Drag ${label} column`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={() => onMoveQuality("up")}
          disabled={index === 0}
          aria-label={`Move ${label} up`}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMoveQuality("down")}
          disabled={index === count - 1}
          aria-label={`Move ${label} down`}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <SortableContext
        items={picked.map((k) => metricId(qualityKey, k))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setDropRef}
          className={cn("space-y-1.5 rounded-md", isOver && "bg-primary/5 ring-1 ring-primary/30")}
        >
          {picked.map((key, i) => (
            <MetricChip
              key={key}
              qualityKey={qualityKey}
              metricKey={key}
              label={metricLabel(key)}
              highlighted={starred.includes(key)}
              index={i}
              count={picked.length}
              highlightDisabled={highlightedCount >= MAX_HIGHLIGHTS}
              onRemove={() => onRemoveMetric(key)}
              onToggleHighlight={() => onToggleStar(key)}
              onMove={(direction) => onMoveMetric(key, direction)}
            />
          ))}
          {picked.length === 0 && (
            <p className="px-1 py-1 text-[11px] text-muted-foreground">No tests mapped yet.</p>
          )}
        </div>
      </SortableContext>

      {picked.length < MAX_METRICS_PER_QUALITY && available.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {available.length > 8 && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search metrics…"
                className="h-6 pl-6 text-[11px]"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {trayItems.map((o) => (
              <TrayChip
                key={o.key}
                qualityKey={qualityKey}
                metricKey={o.key}
                label={o.label}
                onAdd={() => onAddMetric(o.key)}
              />
            ))}
            {trayItems.length === 0 && (
              <p className="px-1 py-1 text-[11px] text-muted-foreground">No metrics match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AthleticismQualityBoard({
  config,
  setConfig,
  options,
  qualityOrder,
  setQualityOrder,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const metricLabel = (key: string) => options.find((o) => o.key === key)?.label ?? key;
  const highlightedCount = config.starred.length;

  const addMetric = (key: QualityKey, metricKey: string) => {
    const cur = config.qualityMetrics[key] ?? [];
    if (cur.includes(metricKey) || cur.length >= MAX_METRICS_PER_QUALITY) return;
    setConfig((c) => ({
      ...c,
      qualityMetrics: { ...c.qualityMetrics, [key]: [...cur, metricKey] },
    }));
  };
  const removeMetric = (key: QualityKey, metricKey: string) => {
    setConfig((c) => ({
      ...c,
      qualityMetrics: {
        ...c.qualityMetrics,
        [key]: (c.qualityMetrics[key] ?? []).filter((k) => k !== metricKey),
      },
      starred: c.starred.filter((k) => k !== metricKey),
    }));
  };
  const toggleStar = (metricKey: string) => {
    setConfig((c) => {
      if (c.starred.includes(metricKey))
        return { ...c, starred: c.starred.filter((k) => k !== metricKey) };
      if (c.starred.length >= MAX_HIGHLIGHTS) {
        toast.error(`Only ${MAX_HIGHLIGHTS} highlighted stats allowed — remove one first`);
        return c;
      }
      return { ...c, starred: [...c.starred, metricKey] };
    });
  };
  const reorderMetrics = (key: QualityKey, order: string[]) => {
    setConfig((c) => ({ ...c, qualityMetrics: { ...c.qualityMetrics, [key]: order } }));
  };
  const moveMetric = (key: QualityKey, metricKey: string, direction: "up" | "down") => {
    const cur = [...(config.qualityMetrics[key] ?? [])];
    const from = cur.indexOf(metricKey);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= cur.length) return;
    [cur[from], cur[to]] = [cur[to], cur[from]];
    reorderMetrics(key, cur);
  };
  const moveQuality = (key: QualityKey, direction: "up" | "down") => {
    const from = qualityOrder.indexOf(key);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= qualityOrder.length) return;
    const next = [...qualityOrder];
    [next[from], next[to]] = [next[to], next[from]];
    setQualityOrder(next);
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    if (activeIdStr.startsWith(QUALITY_PREFIX)) {
      const overQuality = qualityOfId(overIdStr);
      if (!overQuality) return;
      const from = qualityOrder.indexOf(activeIdStr.slice(QUALITY_PREFIX.length) as QualityKey);
      const to = qualityOrder.indexOf(overQuality);
      if (from === -1 || to === -1) return;
      const next = [...qualityOrder];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setQualityOrder(next);
      return;
    }

    if (activeIdStr.startsWith(METRIC_PREFIX)) {
      const key = qualityOfId(activeIdStr);
      const overQuality = qualityOfId(overIdStr);
      if (!key || key !== overQuality) return; // fixed taxonomy: no cross-quality drop
      const cur = [...(config.qualityMetrics[key] ?? [])];
      const activeKey = activeIdStr.slice(METRIC_PREFIX.length + key.length + 2);
      const from = cur.indexOf(activeKey);
      let to = cur.length - 1;
      if (overIdStr.startsWith(METRIC_PREFIX)) {
        const overKey = overIdStr.slice(METRIC_PREFIX.length + key.length + 2);
        to = cur.indexOf(overKey);
      }
      if (from === -1 || to === -1) return;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorderMetrics(key, next);
      return;
    }

    if (activeIdStr.startsWith(TRAY_PREFIX)) {
      const key = qualityOfId(activeIdStr);
      const overQuality = qualityOfId(overIdStr);
      if (!key || key !== overQuality) return;
      const metricKey = activeIdStr.slice(TRAY_PREFIX.length + key.length + 2);
      addMetric(key, metricKey);
    }
  }

  const activeLabel = (() => {
    if (!activeId) return null;
    if (activeId.startsWith(QUALITY_PREFIX)) {
      const key = activeId.slice(QUALITY_PREFIX.length) as QualityKey;
      return QUALITIES.find((q) => q.key === key)?.label ?? key;
    }
    const key = activeId.split("::").pop();
    return key ? metricLabel(key) : null;
  })();

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={qualityOrder.map(qualityId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {qualityOrder.map((key, index) => {
              const q = QUALITIES.find((x) => x.key === key);
              if (!q) return null;
              const picked = config.qualityMetrics[key] ?? [];
              const available = options.filter((o) => !picked.includes(o.key));
              return (
                <QualityColumn
                  key={key}
                  qualityKey={key}
                  label={q.label}
                  index={index}
                  count={qualityOrder.length}
                  picked={picked}
                  available={available}
                  starred={config.starred}
                  highlightedCount={highlightedCount}
                  metricLabel={metricLabel}
                  onMoveQuality={(d) => moveQuality(key, d)}
                  onRemoveMetric={(k) => removeMetric(key, k)}
                  onToggleStar={toggleStar}
                  onMoveMetric={(k, d) => moveMetric(key, k, d)}
                  onAddMetric={(k) => addMetric(key, k)}
                />
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeLabel ? <Badge variant="secondary">{activeLabel}</Badge> : null}
        </DragOverlay>
      </DndContext>
      <p className="text-[11px] text-muted-foreground">
        {highlightedCount}/{MAX_HIGHLIGHTS} highlighted stats used. Drag to reorder, or use the
        arrows/+/x.
      </p>
    </div>
  );
}
