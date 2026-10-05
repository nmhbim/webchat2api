"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { DateRangeFilter } from "@/components/date-range-filter";
import { ImageLightbox } from "@/components/image-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  deleteImageTag,
  deleteManagedImages,
  downloadImages,
  downloadSingleImage,
  fetchImageTag,
  fetchManagedImages,
  setImageTag,
  type ManagedImage,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";

const LONG_PRESS_MS = 800;

function storageBadge(item: ManagedImage) {
  if (item.local && item.webdav) {
    return {
      label: "Dual Storage",
      className: "border-lime-200 bg-lime-50 text-lime-800",
    };
  }
  if (item.webdav || item.storage === "webdav") {
    return {
      label: "WebDAV",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Local Storage",
    className: "border-stone-200 bg-stone-50 text-stone-600",
  };
}

function formatSize(size: number) {
  return size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(2)} MB`
    : `${Math.ceil(size / 1024)} KB`;
}

function imageKey(item: ManagedImage) {
  return item.rel || item.url;
}

function ImageManagerContent() {
  const [items, setItems] = useState<ManagedImage[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ManagedImage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [allTag, setAllTag] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string[]>([]);
  const [tagEditTarget, setTagEditTarget] = useState<ManagedImage | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [dialogVisible, setDialogVisible] = useState(false);
  const deleteTargetRef = useRef<ManagedImage | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState<"selected" | "filtered" | null>(
    null,
  );
  const [isDownloading, setIsDownloading] = useState(false);

  const filteredItems =
    selectedTag.length > 0
      ? items.filter((item) =>
          selectedTag.every((t) => (item.tags ?? []).includes(t)),
        )
      : items;

  const lightboxImages = filteredItems.map((item) => ({
    id: item.name,
    src: item.url,
    sizeLabel: formatSize(item.size),
    dimensions:
      item.width && item.height ? `${item.width} x ${item.height}` : undefined,
  }));
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const currentRows = filteredItems.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedCount =
    deleteMode === "filtered" ? items.length : selectedPaths.length;
  const currentPageSelected =
    currentRows.length > 0 &&
    currentRows.every((item) => selectedSet.has(imageKey(item)));
  const allSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selectedSet.has(imageKey(item)));

  const loadImages = async () => {
    setIsLoading(true);
    try {
      const [data, tagsData] = await Promise.all([
        fetchManagedImages({ start_date: startDate, end_date: endDate }),
        fetchImageTag(),
      ]);
      setItems(data.items);
      setAllTag(tagsData.tags);
      setSelectedPaths((current) =>
        current.filter((path) =>
          data.items.some((item) => imageKey(item) === path),
        ),
      );
      setPage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load images");
    } finally {
      setIsLoading(false);
    }
  };

  const closeDialog = useCallback(() => {
    setDialogVisible(false);
    setTimeout(() => setDeleteTarget(null), 200);
  }, []);

  const openDeleteDialog = useCallback((item: ManagedImage) => {
    deleteTargetRef.current = item;
    setDeleteTarget(item);
    setDialogVisible(true);
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteManagedImages({ paths: [deleteTarget.rel] });
      setItems((prev) => prev.filter((item) => item.rel !== deleteTarget.rel));
      setSelectedPaths((prev) =>
        prev.filter((p) => p !== imageKey(deleteTarget)),
      );
      toast.success("Image deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setIsDeleting(false);
      closeDialog();
    }
  };

  const handleSetTag = async (item: ManagedImage, tags: string[]) => {
    try {
      const result = await setImageTag(item.rel, tags);
      setItems((prev) =>
        prev.map((i) => (i.rel === item.rel ? { ...i, tags: result.tags } : i)),
      );
      const tagsData = await fetchImageTag();
      setAllTag(tagsData.tags);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to set tag");
    }
  };

  const handleAddTag = (item: ManagedImage) => {
    const tag = tagInput.trim();
    if (!tag) return;
    const current = item.tags ?? [];
    if (current.includes(tag)) {
      toast.error("Tag already exists");
      return;
    }
    void handleSetTag(item, [...current, tag]);
    setTagInput("");
  };

  const handleRemoveTag = (item: ManagedImage, tag: string) => {
    void handleSetTag(
      item,
      (item.tags ?? []).filter((t) => t !== tag),
    );
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTag((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
    setPage(1);
  };

  const [pressingTag, setPressingTag] = useState<string | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<string | null>(null);

  const handleDeleteTag = async (tag: string) => {
    try {
      const result = await deleteImageTag(tag);
      setAllTag((prev) => prev.filter((t) => t !== tag));
      setSelectedTag((prev) => prev.filter((t) => t !== tag));
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          tags: (item.tags ?? []).filter((t) => t !== tag),
        })),
      );
      toast.success(`Tag"${tag}"deleted, affected ${result.removed_from} images`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete tag");
    }
  };

  const startTagPress = useCallback((tag: string) => {
    setPressingTag(tag);
    pressTimerRef.current = setTimeout(() => {
      setPressingTag(null);
      setTagDeleteTarget(tag);
    }, LONG_PRESS_MS);
  }, []);

  const stopTagPress = useCallback(() => {
    setPressingTag(null);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedTag([]);
  };

  const togglePaths = (paths: string[], checked: boolean) => {
    setSelectedPaths((current) =>
      checked
        ? Array.from(new Set([...current, ...paths]))
        : current.filter((path) => !paths.includes(path)),
    );
  };

  const confirmDelete = async () => {
    if (!deleteMode || selectedCount === 0) return;
    setIsDeleting(true);
    try {
      const data = await deleteManagedImages(
        deleteMode === "filtered"
          ? { start_date: startDate, end_date: endDate, all_matching: true }
          : { paths: selectedPaths },
      );
      toast.success(`Deleted ${data.removed} images`);
      setDeleteMode(null);
      setSelectedPaths([]);
      await loadImages();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete image");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBatchDownload = async () => {
    const paths =
      deleteMode === "filtered" ? items.map((item) => item.rel) : selectedPaths;
    if (paths.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadImages(paths);
      toast.success(`Downloaded ${paths.length} images`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSingleDownload = async (item: ManagedImage) => {
    await downloadSingleImage(item.rel);
  };

  useEffect(() => {
    void loadImages();
  }, [startDate, endDate]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            Images
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950">
            Image Management
          </h1>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onChange={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
          />
          <Button
            variant="outline"
            onClick={clearFilters}
            className="h-10 rounded-xl border-stone-200 bg-white/90 px-4 text-stone-700 shadow-sm hover:bg-white"
          >
            Clear Filters
          </Button>
          <Button
            onClick={() => void loadImages()}
            disabled={isLoading}
            className="h-10 rounded-xl bg-stone-950 px-4 text-white shadow-[0_18px_40px_-26px_rgba(68,64,60,0.9)] hover:bg-stone-800"
          >
            {isLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
          <Button
            variant="outline"
            onClick={() => setDeleteMode("filtered")}
            disabled={
              isDeleting || items.length === 0 || (!startDate && !endDate)
            }
            className="h-10 rounded-xl border-rose-200 bg-white/90 px-4 text-rose-600 shadow-sm hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="size-4" />
            Delete by Date Range
          </Button>
        </div>
      </div>

      {allTag.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-y border-stone-200/70 py-3">
          <span className="text-xs font-medium text-stone-500">
            <Tag className="mr-1 inline size-3.5" />
            Filter by Tag:
          </span>
          {allTag.map((tag) => {
            const isPressing = pressingTag === tag;
            return (
              <span
                key={tag}
                className="relative inline-flex items-center"
                onMouseDown={() => startTagPress(tag)}
                onMouseUp={stopTagPress}
                onMouseLeave={stopTagPress}
                onTouchStart={() => startTagPress(tag)}
                onTouchEnd={stopTagPress}
              >
                <button type="button" onClick={() => toggleFilterTag(tag)}>
                  <Badge
                    variant={selectedTag.includes(tag) ? "default" : "outline"}
                    className={`cursor-pointer rounded-md px-2.5 py-1 shadow-sm transition-all hover:opacity-80 ${isPressing ? "ring-2 ring-red-400 ring-offset-1" : ""}`}
                  >
                    {tag}
                  </Badge>
                </button>
                {isPressing ? (
                  <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                    <span className="absolute inset-0 animate-[grow_800ms_linear_forwards] rounded-md bg-red-400/20" />
                  </span>
                ) : null}
              </span>
            );
          })}
          {selectedTag.length > 0 ? (
            <button type="button" onClick={() => setSelectedTag([])}>
              <Badge
                variant="secondary"
                className="cursor-pointer rounded-md px-2.5 py-1 shadow-sm"
              >
                <X className="mr-0.5 size-3" />
                Clear
              </Badge>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white/72">
        <div className="flex flex-col gap-3 border-b border-stone-200/70 bg-stone-50/45 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
            <ImageIcon className="size-4" />{filteredItems.length} images total 
            {selectedTag.length > 0 ? (
              <span className="text-stone-400">
                (filtered from {items.length} images)
              </span>
            ) : null}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={currentPageSelected}
                onCheckedChange={(checked) =>
                  togglePaths(currentRows.map(imageKey), Boolean(checked))
                }
              />
              Select Page
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) =>
                  togglePaths(filteredItems.map(imageKey), Boolean(checked))
                }
              />
              Select All
            </label>
            {selectedPaths.length > 0 ? (
              <span className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-semibold text-stone-600 shadow-sm">
                Selected: {selectedPaths.length} 
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              className="h-8 rounded-lg px-3 text-stone-600 hover:bg-white hover:text-stone-900"
              onClick={() => void loadImages()}
              disabled={isLoading}
            >
              <RefreshCw
                className={`size-4 ${isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-stone-500 transition hover:bg-white hover:text-stone-900 disabled:text-stone-300"
              onClick={() => setSelectedPaths([])}
              disabled={selectedPaths.length === 0 || isDeleting}
            >
              Deselect All
            </button>
            <Button
              variant="outline"
              className="h-8 rounded-lg border-stone-200 bg-white px-3 text-stone-600 shadow-sm hover:bg-stone-50 hover:text-stone-900"
              onClick={() => void handleBatchDownload()}
              disabled={
                selectedPaths.length === 0 || isDownloading || isDeleting
              }
            >
              {isDownloading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Download Selected
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-lg border-rose-200 bg-white px-3 text-rose-600 shadow-sm hover:bg-rose-50 hover:text-rose-700"
              onClick={() => setDeleteMode("selected")}
              disabled={selectedPaths.length === 0 || isDeleting}
            >
              <Trash2 className="size-4" />
              Delete Selected
            </Button>
          </div>
        </div>
        <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {currentRows.map((item) => {
            const imageIndex = filteredItems.findIndex(
              (row) => row.url === item.url,
            );
            const storage = storageBadge(item);
            return (
              <div
                key={item.rel}
                className="group border-r border-b border-stone-200/70 p-3 transition hover:bg-stone-50/75 sm:p-4"
              >
                <div className="relative">
                  <button
                    type="button"
                    className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-stone-100 text-left shadow-inner"
                    onClick={() => {
                      setLightboxIndex(imageIndex);
                      setLightboxOpen(true);
                    }}
                  >
                    <img
                      src={item.thumbnail_url || item.url}
                      alt={item.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      onError={(event) => {
                        if (event.currentTarget.src !== item.url) {
                          event.currentTarget.src = item.url;
                        }
                      }}
                    />
                    <span className="absolute right-2 bottom-2 rounded-full bg-black/55 p-2 text-white opacity-100 shadow-lg transition sm:opacity-0 sm:group-hover:opacity-100">
                      <Maximize2 className="size-4" />
                    </span>
                    <span
                      className={`absolute top-2 left-2 rounded-md border px-2.5 py-1 text-[10px] font-semibold shadow-sm ${storage.className}`}
                    >
                      {storage.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-100 shadow-lg transition hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Delete Image"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDeleteDialog(item);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-stone-500">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium text-stone-700">
                      <CalendarDays className="mr-1 inline size-3.5" />
                      {item.created_at}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => void handleSingleDownload(item)}
                        title="Download image"
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        onClick={() => {
                          void navigator.clipboard.writeText(item.url);
                          toast.success("Image URL copied to clipboard");
                        }}
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Checkbox
                        checked={selectedSet.has(imageKey(item))}
                        onCheckedChange={(checked) =>
                          togglePaths([imageKey(item)], Boolean(checked))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>{formatSize(item.size)}</span>
                    <span className="inline-flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`rounded-md px-2.5 py-1 text-[10px] shadow-sm ${storage.className}`}
                      >
                        {storage.label}
                      </Badge>
                      {item.width && item.height
                        ? `${item.width} x ${item.height}`
                        : "-"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(item.tags ?? []).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="gap-0.5 rounded-md py-0 pr-0.5 text-[10px] shadow-sm"
                      >
                        {tag}
                        <button
                          type="button"
                          className="inline-flex size-3.5 items-center justify-center rounded-full hover:bg-stone-300"
                          onClick={() => handleRemoveTag(item, tag)}
                        >
                          <X className="size-2.5" />
                        </button>
                      </Badge>
                    ))}
                    <Popover
                      open={tagEditTarget?.rel === item.rel}
                      onOpenChange={(open) => {
                        setTagEditTarget(open ? item : null);
                        setTagInput("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600"
                          title="Add Tag"
                        >
                          <Plus className="size-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-2">
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-stone-500">
                            Add Tag
                          </div>
                          <div className="flex gap-1">
                            <Input
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              placeholder="Enter tag name"
                              className="h-8 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddTag(item);
                                }
                              }}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-8 shrink-0"
                              onClick={() => handleAddTag(item)}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </div>
                          {allTag.filter((t) => !(item.tags ?? []).includes(t))
                            .length > 0 ? (
                            <div className="flex flex-wrap gap-1 border-t border-stone-100 pt-2">
                              {allTag
                                .filter((t) => !(item.tags ?? []).includes(t))
                                .map((tag) => (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      void handleSetTag(item, [
                                        ...(item.tags ?? []),
                                        tag,
                                      ]);
                                      setTagEditTarget(null);
                                    }}
                                  >
                                    <Badge
                                      variant="outline"
                                      className="cursor-pointer rounded-md text-[10px] hover:bg-stone-100"
                                    >
                                      {tag}
                                    </Badge>
                                  </button>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-stone-100 bg-stone-50/30 px-4 py-3 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-end">
          <span>
            Page {safePage} of {pageCount} ({filteredItems.length} total) 
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-lg border-stone-200 bg-white"
            disabled={safePage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-lg border-stone-200 bg-white"
            disabled={safePage >= pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {!isLoading && filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center text-sm text-stone-500">
            <div className="rounded-2xl bg-stone-100/80 p-3 text-stone-500 shadow-inner">
              <ImageIcon className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-stone-700">No images found</p>
              <p>Try adjusting date range or tag filter.</p>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog
        open={dialogVisible}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-sm overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8">Are you sure you want to delete</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete this image? This action cannot be undone.
          </p>
          {deleteTarget ? (
            <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 p-3">
              <img
                src={deleteTarget.thumbnail_url || deleteTarget.url}
                alt=""
                className="size-16 shrink-0 rounded-lg object-cover"
                onError={(e) => {
                  if (e.currentTarget.src !== deleteTarget.url)
                    e.currentTarget.src = deleteTarget.url;
                }}
              />
              <div className="min-w-0 overflow-hidden text-xs text-stone-500">
                <div className="truncate font-medium text-stone-700">
                  {deleteTarget.name}
                </div>
                <div className="truncate">{deleteTarget.created_at}</div>
                <div>{formatSize(deleteTarget.size)}</div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="rounded-xl"
            >
              {isDeleting ? (
                <LoaderCircle className="mr-1 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 size-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
      <Dialog
        open={Boolean(deleteMode)}
        onOpenChange={(open) => (!open ? setDeleteMode(null) : null)}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>
              {deleteMode === "filtered"
                ? "Delete images in date range"
                : "Delete Selected Images"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete {selectedCount} images? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setDeleteMode(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void confirmDelete()}
              disabled={isDeleting || selectedCount === 0}
            >
              {isDeleting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Are you sure you want to delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(tagDeleteTarget)}
        onOpenChange={(open) => {
          if (!open) setTagDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete Tag</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600">
            Are you sure you want to delete tag{" "}
            <span className="font-semibold">"{tagDeleteTarget}"</span>{" "}
            ? It will be removed from all images.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setTagDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              onClick={() => {
                if (tagDeleteTarget) void handleDeleteTag(tagDeleteTarget);
                setTagDeleteTarget(null);
              }}
            >
              Are you sure you want to delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function ImageManagerPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }
  return <ImageManagerContent />;
}
