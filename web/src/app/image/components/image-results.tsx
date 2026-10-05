"use client";

import { useState } from "react";
import {
  Clock3,
  Download,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ImageConversation,
  ImageTurnStatus,
  StoredImage,
  StoredReferenceImage,
} from "@/store/image-conversations";

export type ImageLightboxItem = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
};

type ImageResultsProps = {
  selectedConversation: ImageConversation | null;
  onOpenLightbox: (images: ImageLightboxItem[], index: number) => void;
  onContinueEdit: (
    conversationId: string,
    image: StoredImage | StoredReferenceImage,
  ) => void;
  onDeletePrompt: (conversationId: string, turnId: string) => void;
  onDeleteResults: (conversationId: string, turnId: string) => void;
  onReuseTurnConfig: (
    conversationId: string,
    turnId: string,
  ) => void | Promise<void>;
  onRegenerateTurn: (
    conversationId: string,
    turnId: string,
  ) => void | Promise<void>;
  onRetryImage: (
    conversationId: string,
    turnId: string,
    imageId: string,
  ) => void | Promise<void>;
  formatConversationTime: (value: string) => string;
};

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

async function downloadStoredImage(image: StoredImage, index: number) {
  let blob: Blob;
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: "image/png" });
  } else if (image.url) {
    const res = await fetch(image.url);
    blob = await res.blob();
  } else {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `image-${index + 1}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ImageResults({
  selectedConversation,
  onOpenLightbox,
  onContinueEdit,
  onDeletePrompt,
  onDeleteResults,
  onReuseTurnConfig,
  onRegenerateTurn,
  onRetryImage,
  formatConversationTime,
}: ImageResultsProps) {
  const [imageDimensions, setImageDimensions] = useState<
    Record<string, string>
  >({});

  const updateImageDimensions = (id: string, width: number, height: number) => {
    const dimensions = formatImageDimensions(width, height);
    setImageDimensions((current) => {
      if (current[id] === dimensions) {
        return current;
      }
      return { ...current, [id]: dimensions };
    });
  };

  if (!selectedConversation) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center text-center sm:min-h-[420px]">
        <div className="w-full max-w-4xl border-y border-dashed border-stone-200/80 px-6 py-10 sm:px-10 sm:py-14">
          <h1
            className="text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl md:text-5xl"
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Turn ideas into images
          </h1>
          <p
            className="mx-auto mt-3 max-w-[280px] text-sm italic tracking-[0.01em] text-stone-500 sm:mt-4 sm:max-w-xl sm:text-[15px]"
            style={{
              fontFamily:
                '"Palatino Linotype","Book Antiqua","URW Palladio L","Times New Roman",serif',
            }}
          >
            Keep local history and task status in one window, and branch edits from existing images.
          </p>
          <div className="mx-auto mt-6 grid max-w-xl gap-2 text-left text-xs text-stone-500 sm:grid-cols-3">
            <span className="rounded-2xl border border-stone-200/80 bg-white/70 px-3 py-2">
              1. Enter Prompt
            </span>
            <span className="rounded-2xl border border-stone-200/80 bg-white/70 px-3 py-2">
              2. Optionally attach Reference Image
            </span>
            <span className="rounded-2xl border border-stone-200/80 bg-white/70 px-3 py-2">
              3. Generated results can be edited further
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 sm:gap-8">
      {selectedConversation.turns.map((turn, turnIndex) => {
        const turnLabel = `Turn ${turnIndex + 1}`;
        const modeLabel = turn.mode === "edit" ? "Image Edit" : "Text to Image";
        const referenceLightboxImages = turn.referenceImages.map(
          (image, index) => ({
            id: `${turn.id}-reference-${index}`,
            src: image.dataUrl,
          }),
        );
        const successfulTurnImages = turn.images.flatMap((image) => {
          const src =
            image.status === "success" ? getStoredImageSrc(image) : "";
          return src
            ? [
                {
                  id: image.id,
                  src,
                  sizeLabel: image.b64_json
                    ? formatBase64ImageSize(image.b64_json)
                    : undefined,
                  dimensions: imageDimensions[image.id],
                },
              ]
            : [];
        });

        return (
          <div key={turn.id} className="flex flex-col gap-3 sm:gap-4">
            {!turn.promptDeleted ? (
              <div className="flex justify-end">
                <div className="max-w-[90%] px-1 py-1 text-[14px] leading-6 text-stone-900 sm:max-w-[82%] sm:text-[15px] sm:leading-7">
                  <div className="mb-1.5 flex flex-wrap justify-end gap-2 text-[11px] text-stone-400 sm:mb-2">
                    <span>{turnLabel}</span>
                    <span>{modeLabel}</span>
                    <span>{getTurnStatusLabel(turn.status)}</span>
                    <span>{formatConversationTime(turn.createdAt)}</span>
                  </div>
                  <div className="text-right">{turn.prompt}</div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        void onReuseTurnConfig(selectedConversation.id, turn.id)
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 transition hover:bg-stone-200 hover:text-stone-900"
                    >
                      Reuse Config
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onDeletePrompt(selectedConversation.id, turn.id)
                      }
                      className="inline-flex size-6 items-center justify-center rounded-full text-stone-300 transition hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Delete Prompt Record"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!turn.resultsDeleted ? (
              <div className="flex justify-start">
                <div className="w-full border-y border-stone-200/70 bg-white/45 py-3 sm:py-4">
                  {turn.referenceImages.length > 0 ? (
                    <div className="mb-4 flex flex-col items-end border-b border-stone-200/70 px-3 pb-3">
                      <div className="mb-3 text-xs font-medium text-stone-500">
                        Current Turn Reference Images
                      </div>
                      <div className="flex flex-wrap justify-end gap-3">
                        {turn.referenceImages.map((image, index) => (
                          <div
                            key={`${turn.id}-${image.name}-${index}`}
                            className="flex flex-col items-end gap-2"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onOpenLightbox(referenceLightboxImages, index)
                              }
                              className="group relative h-24 w-24 overflow-hidden border border-stone-200/80 bg-stone-100/60 text-left transition hover:border-stone-300"
                              aria-label={`Preview reference image ${image.name || index + 1}`}
                            >
                              <img
                                src={image.dataUrl}
                                alt={image.name || `Reference Image ${index + 1}`}
                                className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              />
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-full border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                              onClick={() =>
                                onContinueEdit(selectedConversation.id, image)
                              }
                            >
                              <Sparkles className="size-4" />
                              Add to Edit
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 sm:mb-4 sm:gap-2 sm:text-xs">
                    <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1">
                      {turn.count} 
                    </span>
                    <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1">
                      {turn.size}
                    </span>
                    <span className="max-w-full truncate rounded-full border border-stone-200 bg-white/80 px-3 py-1">
                      {turn.model}
                    </span>
                    <span className="rounded-full border border-stone-200 bg-stone-100/80 px-3 py-1">
                      {getTurnStatusLabel(turn.status)}
                    </span>
                    {turn.status === "queued" ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
                        Waiting for prior jobs in this session to complete
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:block sm:columns-2 sm:gap-4 sm:space-y-4 xl:columns-3">
                    {turn.images.map((image, index) => {
                      const imageSrc =
                        image.status === "success"
                          ? getStoredImageSrc(image)
                          : "";
                      if (image.status === "success" && imageSrc) {
                        const currentIndex = successfulTurnImages.findIndex(
                          (item) => item.id === image.id,
                        );
                        const sizeLabel = image.b64_json
                          ? formatBase64ImageSize(image.b64_json)
                          : "";
                        const dimensions = imageDimensions[image.id];
                        const imageMeta = [sizeLabel, dimensions]
                          .filter(Boolean)
                          .join(" · ");

                        return (
                          <div key={image.id} className="break-inside-avoid">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenLightbox(
                                  successfulTurnImages,
                                  currentIndex,
                                )
                              }
                              className="group block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-100/70 shadow-sm transition hover:border-stone-300 sm:aspect-auto"
                            >
                              <img
                                src={imageSrc}
                                alt={`Generated result ${index + 1}`}
                                className="block h-full w-full object-cover transition duration-200 group-hover:brightness-90 sm:h-auto sm:object-contain"
                                onLoad={(event) => {
                                  updateImageDimensions(
                                    image.id,
                                    event.currentTarget.naturalWidth,
                                    event.currentTarget.naturalHeight,
                                  );
                                }}
                              />
                            </button>
                            <div className="flex flex-col gap-1 px-1 py-2 text-[10px] sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-3 sm:py-3 sm:text-xs">
                              <div className="min-w-0 text-stone-500">
                                <span>Result {index + 1}</span>
                                {imageMeta ? (
                                  <span className="block text-stone-400 sm:ml-2 sm:inline">
                                    {imageMeta}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 rounded-full border-stone-200 bg-white px-0 text-[10px] text-stone-700 hover:bg-stone-50 sm:h-8 sm:w-fit sm:px-3 sm:text-xs"
                                  onClick={() =>
                                    onContinueEdit(
                                      selectedConversation.id,
                                      image,
                                    )
                                  }
                                  aria-label="Add to Edit"
                                >
                                  <Sparkles className="size-3 sm:size-4" />
                                  <span className="hidden sm:inline">
                                    Add to Edit
                                  </span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 rounded-full border-stone-200 bg-white px-0 text-[10px] text-stone-700 hover:bg-stone-50 sm:h-8 sm:w-fit sm:px-3 sm:text-xs"
                                  onClick={() =>
                                    void downloadStoredImage(image, index)
                                  }
                                  aria-label="Download"
                                >
                                  <Download className="size-3 sm:size-4" />
                                  <span className="hidden sm:inline">Download</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (image.status === "error") {
                        return (
                          <div
                            key={image.id}
                            className={cn(
                              "break-inside-avoid overflow-hidden rounded-2xl border border-rose-200 bg-rose-50 shadow-sm",
                              "aspect-square",
                              turn.size === "1:1" && "sm:aspect-square",
                              turn.size === "16:9" && "sm:aspect-video",
                              turn.size === "9:16" && "sm:aspect-[9/16]",
                              turn.size === "4:3" && "sm:aspect-[4/3]",
                              turn.size === "3:4" && "sm:aspect-[3/4]",
                              !["1:1", "16:9", "9:16", "4:3", "3:4"].includes(
                                turn.size,
                              ) && "sm:aspect-square",
                            )}
                          >
                            <div className="flex h-full min-h-16 flex-col items-center justify-center gap-1.5 px-2 py-2 text-center text-[11px] leading-4 text-rose-600 sm:gap-3 sm:px-6 sm:py-8 sm:text-sm sm:leading-6">
                              <span className="line-clamp-2 sm:line-clamp-none">
                                {image.error || "Generation failed"}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void onRetryImage(
                                    selectedConversation.id,
                                    turn.id,
                                    image.id,
                                  )
                                }
                                className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-rose-600 shadow-sm transition hover:bg-rose-100 sm:px-3 sm:text-xs"
                              >
                                Regenerate this image
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={image.id}
                          className={cn(
                            "break-inside-avoid overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-100/80 shadow-inner",
                            turn.size === "1:1" && "aspect-square",
                            turn.size === "16:9" && "aspect-video",
                            turn.size === "9:16" && "aspect-[9/16]",
                            turn.size === "4:3" && "aspect-[4/3]",
                            turn.size === "3:4" && "aspect-[3/4]",
                            !["1:1", "16:9", "9:16", "4:3", "3:4"].includes(
                              turn.size,
                            ) && "aspect-square",
                          )}
                        >
                          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 py-3 text-center text-stone-500 sm:gap-3 sm:px-6 sm:py-8">
                            <div className="rounded-full bg-white p-2 shadow-sm sm:p-3">
                              {turn.status === "queued" ? (
                                <Clock3 className="size-4 sm:size-5" />
                              ) : (
                                <LoaderCircle className="size-4 animate-spin sm:size-5" />
                              )}
                            </div>
                            <p className="text-[10px] leading-4 sm:text-sm">
                              {turn.status === "queued" ? "Queued" : "Processing"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {turn.status === "error" && turn.error ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-700">
                      {turn.error}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] sm:mt-4">
                    <button
                      type="button"
                      onClick={() =>
                        void onRegenerateTurn(selectedConversation.id, turn.id)
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-500 transition hover:bg-stone-200 hover:text-stone-900"
                    >
                      <RotateCcw className="size-3" />
                      Regenerate All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onDeleteResults(selectedConversation.id, turn.id)
                      }
                      className="inline-flex size-6 items-center justify-center rounded-full text-stone-300 transition hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Delete Generated Results"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function getTurnStatusLabel(status: ImageTurnStatus) {
  if (status === "queued") {
    return "Queued";
  }
  if (status === "generating") {
    return "Processing";
  }
  if (status === "success") {
    return "Completed";
  }
  return "Failed";
}

function formatBase64ImageSize(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  const bytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatImageDimensions(width: number, height: number) {
  return `${width} x ${height}`;
}
