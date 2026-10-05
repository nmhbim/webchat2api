"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  LoaderCircle,
  Plus,
  SendHorizonal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ImageComposer } from "@/app/image/components/image-composer";
import {
  ImageResults,
  type ImageLightboxItem,
} from "@/app/image/components/image-results";
import { ImageSidebar } from "@/app/image/components/image-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createChatCompletion,
  createImageEditTask,
  createImageGenerationTask,
  fetchAccounts,
  fetchImageTasks,
  fetchModels,
  type Account,
  type AccountProvider,
  type ImageTask,
  type ModelInfo,
} from "@/lib/api";
import {
  accountProviderDefinitions,
  getAccountProviderDefinition,
  knownProviderIds,
  type KnownProviderId,
} from "@/providers/registry";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";
import {
  clearImageConversations,
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  renameImageConversation,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";
import {
  clearTextMessages,
  listTextMessages,
  saveTextMessages,
  textMessagesToChatMessages,
  type TextChatMessage,
} from "@/store/text-conversations";

const ACTIVE_CONVERSATION_STORAGE_KEY =
  "webchat2api:image_active_conversation_id";
const IMAGE_SIZE_STORAGE_KEY = "webchat2api:image_last_size";
const IMAGE_COUNT_STORAGE_KEY = "webchat2api:image_last_count";
const IMAGE_MODEL_STORAGE_KEY = "webchat2api:image_last_model";
const TEXT_MODEL_STORAGE_KEY = "webchat2api:text_last_model";
const IMAGE_PROVIDER_STORAGE_KEY = "webchat2api:image_last_provider";
const TEXT_PROVIDER_STORAGE_KEY = "webchat2api:text_last_provider";
const TEST_PROVIDER_DEFINITIONS = accountProviderDefinitions.filter(
  (provider) => provider.trial.enabled,
);
const SUPPORTED_TEST_PROVIDERS = knownProviderIds.filter(
  (provider) => getAccountProviderDefinition(provider).trial.enabled,
) as KnownProviderId[];
const DEFAULT_TEST_PROVIDER = SUPPORTED_TEST_PROVIDERS[0] ?? "gpt";
const DEFAULT_IMAGE_MODEL =
  getAccountProviderDefinition(DEFAULT_TEST_PROVIDER).trial.imageFallbackModels[0] ??
  "";
const DEFAULT_TEXT_MODEL =
  getAccountProviderDefinition(DEFAULT_TEST_PROVIDER).trial.textFallbackModels[0] ??
  "";

type TestProviderId = KnownProviderId;
type ExperimentMode = "text" | "image";
type TextModelTestStatus = "pending" | "testing" | "success" | "error";

type TextModelTestResult = {
  model: string;
  status: TextModelTestStatus;
  message: string;
};

function clampImageCount(value: string) {
  return String(Math.min(100, Math.max(1, Math.floor(Number(value) || 1))));
}
const activeConversationQueueIds = new Set<string>();

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...`;
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAvailableQuota(accounts: Account[]) {
  const availableAccounts = accounts.filter(
    (account) => account.status !== "禁用",
  );
  return String(
    availableAccounts.reduce(
      (sum, account) => sum + Math.max(0, account.quota),
      0,
    ),
  );
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read reference image"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: mimeType || matchedMimeType || "image/png",
  });
}

function buildReferenceImageFromResult(
  image: StoredImage,
  fileName: string,
): StoredReferenceImage | null {
  if (!image.b64_json) {
    return null;
  }

  return {
    name: fileName,
    type: "image/png",
    dataUrl: `data:image/png;base64,${image.b64_json}`,
  };
}

async function fetchImageAsFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load generated image");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

async function buildReferenceImageFromStoredImage(
  image: StoredImage,
  fileName: string,
) {
  const direct = buildReferenceImageFromResult(image, fileName);
  if (direct) {
    return {
      referenceImage: direct,
      file: dataUrlToFile(direct.dataUrl, direct.name, direct.type),
    };
  }

  if (!image.url) {
    return null;
  }
  const file = await fetchImageAsFile(image.url, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}

function taskDataToStoredImage(
  image: StoredImage,
  task: ImageTask,
): StoredImage {
  if (task.status === "success") {
    const first = task.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return {
        ...image,
        taskId: task.id,
        status: "error",
        error: "No image data returned",
      };
    }
    return {
      ...image,
      taskId: task.id,
      status: "success",
      b64_json: first.b64_json,
      url: first.url,
      revised_prompt: first.revised_prompt,
      error: undefined,
    };
  }

  if (task.status === "error") {
    return {
      ...image,
      taskId: task.id,
      status: "error",
      error: task.error || "Generation failed",
    };
  }

  return {
    ...image,
    taskId: task.id,
    status: "loading",
    error: undefined,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some(
      (turn) => turn.status === "queued" || turn.status === "generating",
    ),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

function uniqueModelIds(items: string[]) {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of items) {
    const model = item.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }
  return models;
}

function providerTrialMetadataIncludes(
  provider: AccountProvider | null | undefined,
  field: "imageCapabilities" | "textCapabilities",
  value: string,
) {
  if (provider) {
    return getAccountProviderDefinition(provider).trial[field].includes(value);
  }

  return TEST_PROVIDER_DEFINITIONS.some((definition) =>
    definition.trial[field].includes(value),
  );
}

function isImageModel(model: string, metadata?: ModelInfo) {
  if (
    metadata?.capability &&
    providerTrialMetadataIncludes(
      metadata.provider,
      "imageCapabilities",
      metadata.capability,
    )
  ) {
    return true;
  }

  const normalized = model.toLowerCase();
  return TEST_PROVIDER_DEFINITIONS.some((provider) =>
    provider.trial.imageModelKeywords.some((keyword) =>
      normalized.includes(keyword),
    ),
  );
}

function isTextModel(model: string, metadata?: ModelInfo) {
  if (metadata?.capability) {
    return providerTrialMetadataIncludes(
      metadata.provider,
      "textCapabilities",
      metadata.capability,
    );
  }

  const normalized = model.toLowerCase();
  return (
    !isImageModel(normalized) ||
    TEST_PROVIDER_DEFINITIONS.some((provider) =>
      provider.trial.textModelPrefixes.some((prefix) =>
        normalized.startsWith(prefix),
      ),
    )
  );
}

function normalizeTestProvider(
  provider: AccountProvider | null | undefined,
): TestProviderId {
  const normalized = String(provider || DEFAULT_TEST_PROVIDER)
    .trim()
    .toLowerCase();
  return SUPPORTED_TEST_PROVIDERS.includes(normalized as TestProviderId)
    ? (normalized as TestProviderId)
    : DEFAULT_TEST_PROVIDER;
}

function providerFromModelId(model: string): TestProviderId {
  const normalized = model.toLowerCase();
  return (
    TEST_PROVIDER_DEFINITIONS.find((provider) =>
      provider.trial.modelIdPrefixes.some((prefix) =>
        normalized.startsWith(prefix),
      ),
    )?.id ?? DEFAULT_TEST_PROVIDER
  );
}

function modelProvider(model: string, metadata?: ModelInfo) {
  return normalizeTestProvider(
    metadata?.provider || providerFromModelId(model),
  );
}

function providerMatches(
  model: string,
  provider: TestProviderId,
  metadata?: ModelInfo,
) {
  return modelProvider(model, metadata) === provider;
}

function fallbackTextModelsForProvider(
  provider: TestProviderId,
  hasMetadata: boolean,
) {
  const trial = getAccountProviderDefinition(provider).trial;
  return trial.textFallbackMode === "always" || !hasMetadata
    ? trial.textFallbackModels
    : [];
}

function fallbackImageModelsForProvider(provider: TestProviderId) {
  return getAccountProviderDefinition(provider).trial.imageFallbackModels;
}

function pickProviderScopedModel(models: string[], current: string) {
  return models.includes(current) ? current : (models[0] ?? "");
}

function pickStoredModel(storageKey: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.localStorage.getItem(storageKey) || fallback;
}

function ProviderSelect({
  value,
  onChange,
  availability,
}: {
  value: TestProviderId;
  onChange: (value: TestProviderId) => void;
  availability?: Partial<
    Record<TestProviderId, { disabled: boolean; reason?: string }>
  >;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label className="text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase">
        Provider
      </label>
      <Select
        value={value}
        onValueChange={(nextValue) =>
          onChange(normalizeTestProvider(nextValue))
        }
      >
        <SelectTrigger className="h-11 rounded-2xl border-stone-200 bg-white/90 text-stone-800 shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_TEST_PROVIDERS.map((provider) => {
            const state = availability?.[provider];
            const definition = getAccountProviderDefinition(provider);
            return (
              <SelectItem
                key={provider}
                value={provider}
                disabled={state?.disabled}
              >
                <span>{definition.label}</span>
                {state?.reason ? (
                  <span className="ml-2 text-xs text-stone-400">
                    {state.reason}
                  </span>
                ) : null}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function ModelSelect({
  value,
  models,
  label,
  onChange,
}: {
  value: string;
  models: string[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <label className="text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={models.length === 0}>
        <SelectTrigger className="h-11 rounded-2xl border-stone-200 bg-white/90 text-stone-800 shadow-none">
          <SelectValue placeholder={models.length === 0 ? "No models available" : undefined} />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ExperimentModeSwitch({
  mode,
  onChange,
}: {
  mode: ExperimentMode;
  onChange: (mode: ExperimentMode) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-stone-200/80 bg-white/70 p-1">
      {[
        { value: "text" as const, label: "Text Chat Playground" },
        { value: "image" as const, label: "Image Playground" },
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition",
            mode === item.value
              ? "bg-stone-900 text-white shadow-[0_12px_28px_-18px_rgba(68,64,60,0.9)]"
              : "text-stone-500 hover:bg-white/60 hover:text-stone-900",
          )}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function TextExperimentPanel({
  prompt,
  messages,
  provider,
  model,
  models,
  providerAvailability,
  isLoading,
  isTestingModels,
  modelTestResults,
  onPromptChange,
  onProviderChange,
  onModelChange,
  onSubmit,
  onTestModels,
  onClearMessages,
}: {
  prompt: string;
  messages: TextChatMessage[];
  provider: TestProviderId;
  model: string;
  models: string[];
  providerAvailability?: Partial<
    Record<TestProviderId, { disabled: boolean; reason?: string }>
  >;
  isLoading: boolean;
  isTestingModels: boolean;
  modelTestResults: TextModelTestResult[];
  onPromptChange: (value: string) => void;
  onProviderChange: (value: TestProviderId) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onTestModels: () => void | Promise<void>;
  onClearMessages: () => void | Promise<void>;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isLoading]);

  return (
    <section className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white/72">
        <div className="border-b border-stone-200/70 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                Text to Text
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-stone-950">
                Text Chat Playground
              </h2>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-stone-500">
                Interactively test
                /v1/chat/completions, persisting across page refreshes.
              </p>
            </div>
            <span className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500">
              {messages.length} messages
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(250,247,239,0.9),rgba(255,253,248,0.84))] p-4 sm:p-5">
          {messages.length > 0 ? (
            <div className="flex flex-col gap-4">
              {messages.map((message) => {
                const isUser = message.role === "user";
                const isError = message.role === "error";
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      isUser ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[min(82%,760px)] rounded-2xl px-4 py-3 text-sm leading-7",
                        isUser
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : isError
                            ? "rounded-bl-md border border-rose-200 bg-rose-50 text-rose-700"
                            : "rounded-bl-md border border-stone-200 bg-white text-stone-800",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase opacity-70">
                        <span>
                          {isUser ? "You" : isError ? "Error" : "Assistant"}
                        </span>
                        {!isUser && message.model ? (
                          <span>{message.model}</span>
                        ) : null}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {message.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              {isLoading ? (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500">
                    <LoaderCircle className="size-4 animate-spin" />
                    Waiting for model response...
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center border-y border-dashed border-stone-200 px-6 text-center">
              <div>
                <div className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase">
                  Empty Thread
                </div>
                <p className="mt-2 text-lg font-semibold text-stone-900">
                  Enter your first text prompt below
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">
                  Each message is preserved in chat history for comparing prompts and model outputs.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-stone-200/70 bg-white/95 p-3 sm:p-4">
          <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-2">
            <Textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              placeholder="Type a message for the model, e.g.: Summarize this service in 3 sentences."
              className="min-h-[92px] resize-none rounded-[18px] border-transparent bg-white px-4 py-3 text-[15px] leading-7 text-stone-900 shadow-none placeholder:text-stone-400 focus-visible:border-stone-200 focus-visible:ring-stone-300"
            />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid min-w-0 flex-1 gap-2 sm:max-w-[520px] sm:grid-cols-[160px_minmax(0,1fr)]">
                <ProviderSelect
                  value={provider}
                  onChange={onProviderChange}
                  availability={providerAvailability}
                />
                <ModelSelect
                  value={model}
                  models={models}
                  label="Model"
                  onChange={onModelChange}
                />
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <p className="text-xs text-stone-400">Ctrl/⌘ + Enter Send</p>
                <Button
                  className="h-10 rounded-full bg-stone-950 px-5 text-white hover:bg-stone-800"
                  disabled={!prompt.trim() || isLoading}
                  onClick={() => void onSubmit()}
                >
                  {isLoading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="size-4" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="min-h-0 rounded-2xl border border-stone-200/80 bg-white/72 p-3 sm:p-4">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start">
            <div>
              <div className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
                Text History
              </div>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Chat history is stored in local browser storage and can be cleared anytime.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-9 rounded-full border-stone-200 bg-white px-4 text-stone-700 hover:bg-stone-100"
              disabled={messages.length === 0 || isLoading}
              onClick={() => void onClearMessages()}
            >
              <Trash2 className="size-4" />
              Clear Chat
            </Button>
          </div>

          <div className="my-4 h-px bg-stone-200/80" />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start">
            <div>
              <div className="text-xs font-semibold tracking-[0.16em] text-stone-500 uppercase">
                Model Availability
              </div>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Test each text chat model with a small prompt to check availability.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-9 rounded-full border-stone-200 bg-white px-4 text-stone-700 hover:bg-stone-100"
              disabled={models.length === 0 || isTestingModels}
              onClick={() => void onTestModels()}
            >
              {isTestingModels ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              Batch Test Models
            </Button>
          </div>
          <div className="mt-3 grid max-h-[240px] gap-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
            {modelTestResults.length > 0 ? (
              modelTestResults.map((item) => (
                <div
                  key={item.model}
                  className="rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <div className="truncate font-medium text-stone-900">
                    {item.model}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-xs font-semibold",
                      getModelTestStatusClassName(item.status),
                    )}
                  >
                    {getModelTestStatusLabel(item.status)} · {item.message}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-stone-200 bg-white/70 px-3 py-3 text-sm leading-6 text-stone-400">
                Click batch test to see pending / testing / success / error status.
              </div>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}

function getModelTestStatusLabel(status: TextModelTestStatus) {
  if (status === "testing") {
    return "testing";
  }
  if (status === "success") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  return "pending";
}

function getModelTestStatusClassName(status: TextModelTestStatus) {
  if (status === "testing") {
    return "text-amber-600";
  }
  if (status === "success") {
    return "text-emerald-600";
  }
  if (status === "error") {
    return "text-rose-600";
  }
  return "text-stone-400";
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function deriveTurnStatus(
  turn: ImageTurn,
): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter(
    (image) => image.status === "loading",
  ).length;
  const failedCount = turn.images.filter(
    (image) => image.status === "error",
  ).length;
  const successCount = turn.images.filter(
    (image) => image.status === "success",
  ).length;
  if (loadingCount > 0) {
    return {
      status: turn.status === "queued" ? "queued" : "generating",
      error: undefined,
    };
  }
  if (failedCount > 0) {
    return { status: "error", error: ` ${failedCount} images failed to generate` };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  return { status: "queued", error: undefined };
}

async function syncConversationImageTasks(items: ImageConversation[]) {
  const taskIds = Array.from(
    new Set(
      items.flatMap((conversation) =>
        conversation.turns.flatMap((turn) =>
          turn.resultsDeleted
            ? []
            : turn.images.flatMap((image) =>
                image.status === "loading" && image.taskId
                  ? [image.taskId]
                  : [],
              ),
        ),
      ),
    ),
  );
  if (taskIds.length === 0) {
    return items;
  }

  let taskList: Awaited<ReturnType<typeof fetchImageTasks>>;
  try {
    taskList = await fetchImageTasks(taskIds);
  } catch {
    return items;
  }
  const taskMap = new Map(taskList.items.map((task) => [task.id, task]));
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || !image.taskId) {
          return image;
        }
        const task = taskMap.get(image.taskId);
        if (!task) {
          return image;
        }
        const nextImage = taskDataToStoredImage(image, task);
        if (nextImage !== image) {
          turnChanged = true;
        }
        return nextImage;
      });
      if (!turnChanged) {
        return turn;
      }
      changed = true;
      const derived = deriveTurnStatus({ ...turn, images });
      return {
        ...turn,
        ...derived,
        images,
      };
    });
    if (
      turns === conversation.turns ||
      !turns.some((turn, index) => turn !== conversation.turns[index])
    ) {
      return conversation;
    }
    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }
  return normalized;
}

async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if (turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }

      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || image.taskId) {
          return image;
        }
        turnChanged = true;
        return {
          ...image,
          status: "error" as const,
          error: "Page was refreshed or job was interrupted; no recoverable Job ID found",
        };
      });
      const derived = deriveTurnStatus({ ...turn, images });
      if (
        !turnChanged &&
        derived.status === turn.status &&
        derived.error === turn.error
      ) {
        return turn;
      }
      changed = true;
      return {
        ...turn,
        ...derived,
        images,
      };
    });

    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }

    return {
      ...conversation,
      turns,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }

  return syncConversationImageTasks(normalized);
}

function ImagePageContent({ isAdmin }: { isAdmin: boolean }) {
  const didLoadQuotaRef = useRef(false);
  const conversationsRef = useRef<ImageConversation[]>([]);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imagePrompt, setImagePrompt] = useState("");
  const [imageProvider, setImageProvider] = useState<TestProviderId>(
    DEFAULT_TEST_PROVIDER,
  );
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [textPrompt, setTextPrompt] = useState("");
  const [textProvider, setTextProvider] = useState<TestProviderId>(
    DEFAULT_TEST_PROVIDER,
  );
  const [textModel, setTextModel] = useState(DEFAULT_TEXT_MODEL);
  const [textMessages, setTextMessages] = useState<TextChatMessage[]>([]);
  const [isLoadingTextHistory, setIsLoadingTextHistory] = useState(true);
  const [isSubmittingText, setIsSubmittingText] = useState(false);
  const [isTestingTextModels, setIsTestingTextModels] = useState(false);
  const [textModelTestResults, setTextModelTestResults] = useState<
    TextModelTestResult[]
  >([]);
  const [experimentMode, setExperimentMode] = useState<ExperimentMode>("text");
  const [modelMetadata, setModelMetadata] = useState<ModelInfo[]>([]);
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<
    StoredReferenceImage[]
  >([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [availableQuota, setAvailableQuota] = useState("Loading...");
  const [lightboxImages, setLightboxImages] = useState<ImageLightboxItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "one"; id: string }
    | { type: "prompt"; conversationId: string; turnId: string }
    | { type: "results"; conversationId: string; turnId: string }
    | { type: "all" }
    | null
  >(null);

  const parsedCount = useMemo(
    () => Number(clampImageCount(imageCount)),
    [imageCount],
  );
  const modelMetadataById = useMemo(
    () => new Map(modelMetadata.map((model) => [model.id, model])),
    [modelMetadata],
  );
  const selectedConversation = useMemo(
    () =>
      conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const imageModelOptions = useMemo(() => {
    const discovered = modelMetadata
      .filter(
        (model) =>
          providerMatches(model.id, imageProvider, model) &&
          isImageModel(model.id, model),
      )
      .map((model) => model.id);
    const fallbacks =
      modelMetadata.length === 0
        ? fallbackImageModelsForProvider(imageProvider)
        : [];
    return uniqueModelIds([...discovered, ...fallbacks]);
  }, [imageProvider, modelMetadata]);
  const textModelOptions = useMemo(() => {
    const discovered = modelMetadata
      .filter(
        (model) =>
          providerMatches(model.id, textProvider, model) &&
          isTextModel(model.id, model),
      )
      .map((model) => model.id);
    if (modelMetadata.length > 0 && discovered.length === 0) {
      return [];
    }
    return uniqueModelIds([
      ...discovered,
      ...fallbackTextModelsForProvider(textProvider, modelMetadata.length > 0),
      textModel,
    ]).filter((model) =>
      providerMatches(model, textProvider, modelMetadataById.get(model)),
    );
  }, [modelMetadata, modelMetadataById, textModel, textProvider]);
  const textProviderAvailability = useMemo(() => {
    if (modelMetadata.length === 0) {
      return undefined;
    }
    return SUPPORTED_TEST_PROVIDERS.reduce(
      (acc, provider) => {
        const count = modelMetadata.filter(
          (m) => providerMatches(m.id, provider, m) && isTextModel(m.id, m),
        ).length;
        const disabled = count === 0;
        acc[provider] = {
          disabled,
          reason: disabled ? "No accounts available" : undefined,
        };
        return acc;
      },
      {} as Partial<Record<TestProviderId, { disabled: boolean; reason?: string }>>,
    );
  }, [modelMetadata]);

  useEffect(() => {
    if (!textProviderAvailability) return;
    const currentState = textProviderAvailability[textProvider];
    if (currentState?.disabled) {
      const firstAvailable = SUPPORTED_TEST_PROVIDERS.find(
        (p) => !textProviderAvailability[p]?.disabled,
      );
      if (firstAvailable) {
        setTextProvider(firstAvailable);
      }
    }
  }, [textProvider, textProviderAvailability]);
  const imageProviderOptions = useMemo(
    () =>
      SUPPORTED_TEST_PROVIDERS.map((provider) => {
        const providerModels = modelMetadata.filter(
          (model) =>
            providerMatches(model.id, provider, model) &&
            isImageModel(model.id, model),
        );
        const definition = getAccountProviderDefinition(provider);
        const disabled =
          modelMetadata.length > 0
            ? providerModels.length === 0
            : definition.trial.imageFallbackModels.length === 0;
        return {
          value: provider,
          label: definition.label,
          disabled,
          reason: disabled ? "Image generation not supported" : undefined,
        };
      }),
    [modelMetadata],
  );
  const imageModeUnavailableMessage =
    imageModelOptions.length === 0
      ? modelMetadata.length > 0
        ? getAccountProviderDefinition(imageProvider).trial.imageUnsupportedCopy
        : getAccountProviderDefinition(imageProvider).trial.imageNoMetadataCopy
      : undefined;
  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const deleteConfirmTitle =
    deleteConfirm?.type === "all"
      ? "Clear History"
      : deleteConfirm?.type === "prompt"
        ? "Delete Prompt Record"
        : deleteConfirm?.type === "results"
          ? "Delete Generated Results"
          : deleteConfirm?.type === "one"
            ? "Delete Session"
            : "";
  const deleteConfirmDescription =
    deleteConfirm?.type === "all"
      ? "Are you sure you want to delete all image history? This cannot be undone."
      : deleteConfirm?.type === "prompt"
        ? "Are you sure you want to delete this prompt record? The generated results will be kept."
        : deleteConfirm?.type === "results"
          ? "Are you sure you want to delete these results? The prompt record will be kept."
          : deleteConfirm?.type === "one"
            ? "Are you sure you want to delete this session? This cannot be undone."
            : "";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(IMAGE_PROVIDER_STORAGE_KEY, imageProvider);
    }
  }, [imageProvider]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_PROVIDER_STORAGE_KEY, textProvider);
    }
  }, [textProvider]);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const data = await fetchModels();
        if (cancelled) {
          return;
        }
        const nextModels = data.data.filter((model) => model.id.trim());
        setModelMetadata(nextModels);
      } catch {
        if (!cancelled) {
          setModelMetadata([]);
        }
      }
    };

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setImageModel((current) =>
      pickProviderScopedModel(imageModelOptions, current),
    );
  }, [imageModelOptions]);

  useEffect(() => {
    setTextModel((current) =>
      pickProviderScopedModel(textModelOptions, current),
    );
  }, [textModelOptions]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (imageModel) {
      window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, imageModel);
      return;
    }

    window.localStorage.removeItem(IMAGE_MODEL_STORAGE_KEY);
  }, [imageModel]);

  useEffect(() => {
    if (typeof window !== "undefined" && textModel) {
      window.localStorage.setItem(TEXT_MODEL_STORAGE_KEY, textModel);
    }
  }, [textModel]);

  useEffect(() => {
    let cancelled = false;

    const loadTextHistory = async () => {
      try {
        const messages = await listTextMessages();
        if (!cancelled) {
          setTextMessages(messages);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to read text chat history";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingTextHistory(false);
        }
      }
    };

    void loadTextHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoadingTextHistory) {
      void saveTextMessages(textMessages);
    }
  }, [isLoadingTextHistory, textMessages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize =
          typeof window !== "undefined"
            ? window.localStorage.getItem(IMAGE_SIZE_STORAGE_KEY)
            : null;
        const storedCount =
          typeof window !== "undefined"
            ? window.localStorage.getItem(IMAGE_COUNT_STORAGE_KEY)
            : null;
        const storedImageModel = pickStoredModel(
          IMAGE_MODEL_STORAGE_KEY,
          DEFAULT_IMAGE_MODEL,
        );
        const storedTextModel = pickStoredModel(
          TEXT_MODEL_STORAGE_KEY,
          DEFAULT_TEXT_MODEL,
        );
        const storedImageProvider =
          typeof window !== "undefined"
            ? window.localStorage.getItem(IMAGE_PROVIDER_STORAGE_KEY)
            : null;
        const storedTextProvider =
          typeof window !== "undefined"
            ? window.localStorage.getItem(TEXT_PROVIDER_STORAGE_KEY)
            : null;
        setImageSize(storedSize || "");
        setImageCount(storedCount ? clampImageCount(storedCount) : "1");
        setImageProvider(
          normalizeTestProvider(
            storedImageProvider || providerFromModelId(storedImageModel),
          ),
        );
        setTextProvider(
          normalizeTestProvider(
            storedTextProvider || providerFromModelId(storedTextModel),
          ),
        );
        setImageModel(storedImageModel);
        setTextModel(storedTextModel);

        const items = await listImageConversations();
        const normalizedItems = await recoverConversationHistory(items);
        if (cancelled) {
          return;
        }

        conversationsRef.current = normalizedItems;
        setConversations(normalizedItems);
        const storedConversationId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)
            : null;
        const nextSelectedConversationId =
          (storedConversationId &&
          normalizedItems.some(
            (conversation) => conversation.id === storedConversationId,
          )
            ? storedConversationId
            : null) ?? pickFallbackConversationId(normalizedItems);
        setSelectedConversationId(nextSelectedConversationId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load session records";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadQuota = useCallback(async () => {
    if (!isAdmin) {
      setAvailableQuota("--");
      return;
    }
    try {
      const data = await fetchAccounts();
      setAvailableQuota(formatAvailableQuota(data.items));
    } catch {
      setAvailableQuota((prev) => (prev === "Loading..." ? "--" : prev));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (didLoadQuotaRef.current) {
      return;
    }
    didLoadQuotaRef.current = true;

    const handleFocus = () => {
      void loadQuota();
    };

    void loadQuota();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdmin, loadQuota]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }

    resultsViewportRef.current?.scrollTo({
      top: resultsViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    selectedConversation?.updatedAt,
    selectedConversation?.turns.length,
    selectedConversation,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (selectedConversationId) {
      window.localStorage.setItem(
        ACTIVE_CONVERSATION_STORAGE_KEY,
        selectedConversationId,
      );
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (imageSize) {
      window.localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
      return;
    }
    window.localStorage.removeItem(IMAGE_SIZE_STORAGE_KEY);
  }, [imageSize]);

  useEffect(() => {
    if (typeof window !== "undefined" && parsedCount > 0) {
      window.localStorage.setItem(IMAGE_COUNT_STORAGE_KEY, String(parsedCount));
    }
  }, [parsedCount]);

  useEffect(() => {
    if (
      selectedConversationId &&
      !conversations.some(
        (conversation) => conversation.id === selectedConversationId,
      )
    ) {
      setSelectedConversationId(pickFallbackConversationId(conversations));
    }
  }, [conversations, selectedConversationId]);

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversation(conversation);
  };

  const updateConversation = useCallback(
    async (
      conversationId: string,
      updater: (current: ImageConversation | null) => ImageConversation,
      options: { persist?: boolean } = {},
    ) => {
      const current =
        conversationsRef.current.find((item) => item.id === conversationId) ??
        null;
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter(
          (item) => item.id !== conversationId,
        ),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      if (options.persist !== false) {
        await saveImageConversation(nextConversation);
      }
    },
    [],
  );

  const clearComposerInputs = useCallback(() => {
    setImagePrompt("");
    setReferenceImageFiles([]);
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const resetComposer = useCallback(() => {
    clearComposerInputs();
  }, [clearComposerInputs]);

  const handleCreateDraft = () => {
    setSelectedConversationId(null);
    resetComposer();
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    const nextConversations = conversations.filter((item) => item.id !== id);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === id) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
      resetComposer();
    }

    try {
      await deleteImageConversation(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete session";
      toast.error(message);
      const items = await listImageConversations();
      conversationsRef.current = items;
      setConversations(items);
    }
  };

  const handleDeleteTurnPart = async (
    conversationId: string,
    turnId: string,
    part: "prompt" | "results",
  ) => {
    const conversation = conversationsRef.current.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) {
      return;
    }

    const turns = conversation.turns
      .map((turn) => {
        if (turn.id !== turnId) {
          return turn;
        }
        const nextTurn = {
          ...turn,
          prompt: part === "prompt" ? "" : turn.prompt,
          promptDeleted: part === "prompt" ? true : turn.promptDeleted,
          resultsDeleted: part === "results" ? true : turn.resultsDeleted,
          status:
            part === "results" && turn.status === "generating"
              ? ("error" as const)
              : turn.status,
          images:
            part === "results"
              ? turn.images.map((image) => ({
                  id: image.id,
                  status: "error" as const,
                  error: "Generated results deleted",
                }))
              : turn.images,
        };
        return nextTurn.promptDeleted && nextTurn.resultsDeleted
          ? null
          : nextTurn;
      })
      .filter((turn): turn is ImageTurn => Boolean(turn));

    if (turns.length === 0) {
      await handleDeleteConversation(conversationId);
      return;
    }

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns,
    };
    await persistConversation(nextConversation);
  };

  const handleClearHistory = async () => {
    try {
      await clearImageConversations();
      conversationsRef.current = [];
      setConversations([]);
      setSelectedConversationId(null);
      resetComposer();
      toast.success("History cleared");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear history";
      toast.error(message);
    }
  };

  const handleRenameConversation = async (id: string, title: string) => {
    const nextConversations = conversations.map((item) =>
      item.id === id
        ? { ...item, title, updatedAt: new Date().toISOString() }
        : item,
    );
    conversationsRef.current = sortImageConversations(nextConversations);
    setConversations(conversationsRef.current);
    try {
      await renameImageConversation(id, title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rename";
      toast.error(message);
    }
  };

  const openDeleteConversationConfirm = (id: string) => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "one", id });
  };

  const openDeletePromptConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "prompt", conversationId, turnId });
  };

  const openDeleteResultsConfirm = (conversationId: string, turnId: string) => {
    setDeleteConfirm({ type: "results", conversationId, turnId });
  };

  const openClearHistoryConfirm = () => {
    setIsHistoryOpen(false);
    setDeleteConfirm({ type: "all" });
  };

  const handleConfirmDelete = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    if (!target) {
      return;
    }
    if (target.type === "all") {
      await handleClearHistory();
      return;
    }
    if (target.type === "prompt" || target.type === "results") {
      await handleDeleteTurnPart(
        target.conversationId,
        target.turnId,
        target.type,
      );
      return;
    }
    await handleDeleteConversation(target.id);
  };

  const appendReferenceImages = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    try {
      const previews = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setReferenceImageFiles((prev) => [...prev, ...files]);
      setReferenceImages((prev) => [...prev, ...previews]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read reference image";
      toast.error(message);
    }
  }, []);

  const handleReferenceImageChange = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      await appendReferenceImages(files);
    },
    [appendReferenceImages],
  );

  const handleRemoveReferenceImage = useCallback((index: number) => {
    setReferenceImageFiles((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return next;
    });
    setReferenceImages((prev) =>
      prev.filter((_, currentIndex) => currentIndex !== index),
    );
  }, []);

  const handleContinueEdit = useCallback(
    async (
      conversationId: string,
      image: StoredImage | StoredReferenceImage,
    ) => {
      try {
        const nextReference =
          "dataUrl" in image
            ? {
                referenceImage: image,
                file: dataUrlToFile(image.dataUrl, image.name, image.type),
              }
            : await buildReferenceImageFromStoredImage(
                image,
                `conversation-${conversationId}-${Date.now()}.png`,
              );
        if (!nextReference) {
          return;
        }

        setSelectedConversationId(conversationId);

        setReferenceImages((prev) => [...prev, nextReference.referenceImage]);
        setReferenceImageFiles((prev) => [...prev, nextReference.file]);
        setImagePrompt("");
        textareaRef.current?.focus();
        toast.success("Added as reference image. Enter description to continue editing.");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load generated image";
        toast.error(message);
      }
    },
    [],
  );

  const handleReuseTurnConfig = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      const turn = conversation?.turns.find((item) => item.id === turnId);
      if (!conversation || !turn || !turn.prompt.trim()) {
        return;
      }

      setSelectedConversationId(conversationId);
      setImageProvider(
        modelProvider(turn.model, modelMetadataById.get(turn.model)),
      );
      setImagePrompt(turn.prompt);
      setImageModel(turn.model || DEFAULT_IMAGE_MODEL);
      setImageCount(String(Math.max(1, turn.count || turn.images.length || 1)));
      setImageSize(turn.size);
      setReferenceImages(turn.referenceImages);
      setReferenceImageFiles(
        turn.referenceImages.map((image) =>
          dataUrlToFile(image.dataUrl, image.name, image.type),
        ),
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      textareaRef.current?.focus();
      toast.success("Prompt config reused");
    },
    [modelMetadataById],
  );

  const openLightbox = useCallback(
    (images: ImageLightboxItem[], index: number) => {
      if (images.length === 0) {
        return;
      }

      setLightboxImages(images);
      setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
      setLightboxOpen(true);
    },
    [],
  );

  const createLoadingImages = (turnId: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const imageId = `${turnId}-${index}`;
      return {
        id: imageId,
        taskId: imageId,
        status: "loading" as const,
      };
    });

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeConversationQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find(
        (conversation) => conversation.id === conversationId,
      );
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (!snapshot || !activeTurn) {
        return;
      }

      activeConversationQueueIds.add(conversationId);
      const applyTasks = async (tasks: ImageTask[]) => {
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          const turns = conversation.turns.map((turn) => {
            if (turn.id !== activeTurn.id) {
              return turn;
            }
            const images = turn.images.map((image) => {
              const taskId = image.taskId || image.id;
              const task = taskMap.get(taskId);
              return task
                ? taskDataToStoredImage({ ...image, taskId }, task)
                : image;
            });
            const derived = deriveTurnStatus({
              ...turn,
              status: "generating",
              images,
            });
            return {
              ...turn,
              ...derived,
              images,
            };
          });
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns,
          };
        });
      };

      try {
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "generating",
                    error: undefined,
                    images: turn.images.map((image) =>
                      image.status === "loading"
                        ? { ...image, taskId: image.taskId || image.id }
                        : image,
                    ),
                  }
                : turn,
            ),
          };
        });

        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(
            image.dataUrl,
            image.name || `${activeTurn.id}-${index + 1}.png`,
            image.type,
          ),
        );
        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("No reference image found for editing");
        }

        const pendingImages = activeTurn.images.filter(
          (image) => image.status === "loading",
        );
        const submitted = await Promise.all(
          pendingImages.map((image) => {
            const taskId = image.taskId || image.id;
            return activeTurn.mode === "edit"
              ? createImageEditTask(
                  taskId,
                  referenceFiles,
                  activeTurn.prompt,
                  activeTurn.model,
                  activeTurn.size,
                )
              : createImageGenerationTask(
                  taskId,
                  activeTurn.prompt,
                  activeTurn.model,
                  activeTurn.size,
                );
          }),
        );
        await applyTasks(submitted);

        while (true) {
          const latestConversation = conversationsRef.current.find(
            (conversation) => conversation.id === conversationId,
          );
          const latestTurn = latestConversation?.turns.find(
            (turn) => turn.id === activeTurn.id,
          );
          const loadingTaskIds =
            latestTurn?.images.flatMap((image) =>
              image.status === "loading" && image.taskId ? [image.taskId] : [],
            ) || [];
          if (loadingTaskIds.length === 0) {
            break;
          }

          await sleep(2000);
          const taskList = await fetchImageTasks(loadingTaskIds);
          if (taskList.items.length > 0) {
            await applyTasks(taskList.items);
          }
          if (taskList.missing_ids.length > 0 && latestTurn) {
            const missingImages = latestTurn.images.filter(
              (image) =>
                image.status === "loading" &&
                image.taskId &&
                taskList.missing_ids.includes(image.taskId),
            );
            const resubmitted = await Promise.all(
              missingImages.map((image) =>
                activeTurn.mode === "edit"
                  ? createImageEditTask(
                      image.taskId || image.id,
                      referenceFiles,
                      activeTurn.prompt,
                      activeTurn.model,
                      activeTurn.size,
                    )
                  : createImageGenerationTask(
                      image.taskId || image.id,
                      activeTurn.prompt,
                      activeTurn.model,
                      activeTurn.size,
                    ),
              ),
            );
            if (resubmitted.length > 0) {
              await applyTasks(resubmitted);
            }
          }
        }

        await loadQuota();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate image";
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading"
                        ? { ...image, status: "error", error: message }
                        : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);
      } finally {
        activeConversationQueueIds.delete(conversationId);
        for (const conversation of conversationsRef.current) {
          if (
            !activeConversationQueueIds.has(conversation.id) &&
            conversation.turns.some(
              (turn) =>
                (turn.status === "queued" || turn.status === "generating") &&
                turn.images.some((image) => image.status === "loading"),
            )
          ) {
            void runConversationQueue(conversation.id);
          }
        }
      }
    },
    [loadQuota, updateConversation],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const handleRegenerateTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
      if (!conversation || !sourceTurn || !sourceTurn.prompt.trim()) {
        return;
      }

      const now = new Date().toISOString();
      const nextTurnId = createId();
      const count = Math.max(
        1,
        sourceTurn.count || sourceTurn.images.length || 1,
      );
      const nextTurn: ImageTurn = {
        id: nextTurnId,
        prompt: sourceTurn.prompt,
        model: sourceTurn.model,
        mode: sourceTurn.mode,
        referenceImages: sourceTurn.referenceImages,
        count,
        size: sourceTurn.size,
        images: createLoadingImages(nextTurnId, count),
        createdAt: now,
        status: "queued",
      };
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: [...conversation.turns, nextTurn],
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
      toast.success("Added to regeneration queue");
    },
    [runConversationQueue],
  );

  const handleRetryImage = useCallback(
    async (conversationId: string, turnId: string, imageId: string) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) {
        return;
      }

      const now = new Date().toISOString();
      const retryImageId = `${turnId}-${createId()}`;
      const nextConversation = {
        ...conversation,
        updatedAt: now,
        turns: conversation.turns.map((turn) => {
          if (turn.id !== turnId) {
            return turn;
          }
          if (!turn.prompt.trim()) {
            return turn;
          }

          const images = turn.images.map((image) =>
            image.id === imageId
              ? {
                  id: retryImageId,
                  taskId: retryImageId,
                  status: "loading" as const,
                }
              : image,
          );
          const derived = deriveTurnStatus({
            ...turn,
            status: "queued",
            images,
          });
          return {
            ...turn,
            ...derived,
            images,
          };
        }),
      };

      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
    },
    [runConversationQueue],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeConversationQueueIds.has(conversation.id) &&
        conversation.turns.some(
          (turn) =>
            !turn.resultsDeleted &&
            (turn.status === "queued" || turn.status === "generating") &&
            turn.images.some((image) => image.status === "loading"),
        )
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleSubmit = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt) {
      toast.error("Please enter a prompt");
      return;
    }

    const effectiveImageMode: ImageConversationMode =
      referenceImageFiles.length > 0 ? "edit" : "generate";
    if (
      imageModeUnavailableMessage ||
      imageModelOptions.length === 0 ||
      !imageModelOptions.includes(imageModel)
    ) {
      toast.error(imageModeUnavailableMessage || "No image models available for current provider");
      return;
    }

    const targetConversation = selectedConversationId
      ? (conversationsRef.current.find(
          (conversation) => conversation.id === selectedConversationId,
        ) ?? null)
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    const draftTurn: ImageTurn = {
      id: turnId,
      prompt,
      model: imageModel,
      mode: effectiveImageMode,
      referenceImages: effectiveImageMode === "edit" ? referenceImages : [],
      count: parsedCount,
      size: imageSize,
      images: createLoadingImages(turnId, parsedCount),
      createdAt: now,
      status: "queued",
    };

    const baseConversation: ImageConversation = targetConversation
      ? {
          ...targetConversation,
          updatedAt: now,
          turns: [...targetConversation.turns, draftTurn],
        }
      : {
          id: conversationId,
          title: buildConversationTitle(prompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    setSelectedConversationId(conversationId);
    clearComposerInputs();

    await persistConversation(baseConversation);
    void runConversationQueue(conversationId);

    const targetStats = getImageConversationStats(baseConversation);
    if (targetStats.running > 0 || targetStats.queued > 1) {
      toast.success("Added to current session queue");
    } else if (!targetConversation) {
      toast.success("Created new session and started processing");
    } else {
      toast.success("Sent to current session");
    }
  };

  const handleTextSubmit = async () => {
    const prompt = textPrompt.trim();
    if (!prompt) {
      toast.error("Please enter a message to send");
      return;
    }

    setIsSubmittingText(true);
    const userMessage: TextChatMessage = {
      id: createId(),
      role: "user",
      content: prompt,
      model: textModel,
      createdAt: new Date().toISOString(),
    };
    setTextMessages((current) => [...current, userMessage]);
    setTextPrompt("");

    try {
      const apiMessages = textMessagesToChatMessages([
        ...textMessages,
        userMessage,
      ]);
      const data = await createChatCompletion({
        model: textModel,
        messages: apiMessages,
        stream: false,
      });
      const content = data.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Model returned no text content");
      }
      setTextMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "assistant",
          content,
          model: data.model || textModel,
          createdAt: new Date().toISOString(),
        },
      ]);
      toast.success("Chat completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat request failed";
      setTextMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "error",
          content: message,
          model: textModel,
          createdAt: new Date().toISOString(),
        },
      ]);
      toast.error(message);
    } finally {
      setIsSubmittingText(false);
    }
  };

  const handleClearTextMessages = async () => {
    try {
      await clearTextMessages();
      setTextMessages([]);
      toast.success("Text chat history cleared");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Clear text chat historyFailed";
      toast.error(message);
    }
  };

  const updateTextModelTestResult = (
    modelId: string,
    update: Omit<TextModelTestResult, "model">,
  ) => {
    setTextModelTestResults((current) =>
      current.map((item) =>
        item.model === modelId ? { ...item, ...update } : item,
      ),
    );
  };

  const handleBatchTextModelTest = async () => {
    const modelsToTest = uniqueModelIds(textModelOptions);
    if (modelsToTest.length === 0) {
      toast.error("No text models available to test");
      return;
    }

    setIsTestingTextModels(true);
    setTextModelTestResults(
      modelsToTest.map((modelId) => ({
        model: modelId,
        status: "pending",
        message: "Pending",
      })),
    );

    for (const modelId of modelsToTest) {
      updateTextModelTestResult(modelId, {
        status: "testing",
        message: "Testing",
      });
      try {
        const data = await createChatCompletion({
          model: modelId,
          messages: [{ role: "user", content: "Reply with OK." }],
          stream: false,
        });
        const content = data.choices[0]?.message?.content?.trim();
        if (!content) {
          throw new Error("Model returned no text content");
        }
        updateTextModelTestResult(modelId, {
          status: "success",
          message: "Available",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Request failed";
        updateTextModelTestResult(modelId, { status: "error", message });
      }
    }

    setIsTestingTextModels(false);
    toast.success("Model batch test completed");
  };

  const imageProviderLabel = getAccountProviderDefinition(imageProvider).label;
  const selectedConversationTurnCount = selectedConversation?.turns.length ?? 0;
  const selectedConversationStats = selectedConversation
    ? getImageConversationStats(selectedConversation)
    : null;
  const selectedConversationStatus = selectedConversationStats
    ? selectedConversationStats.running > 0
      ? `${selectedConversationStats.running} Processing`
      : selectedConversationStats.queued > 0
        ? `${selectedConversationStats.queued} Queued`
        : `${selectedConversationTurnCount} turns recorded`
    : "New Draft";

  return (
    <>
      <section className="mx-auto flex h-[calc(100dvh-5.5rem)] min-h-0 w-full max-w-[1380px] flex-col gap-4 overflow-hidden px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:h-[calc(100dvh-5.25rem)] sm:px-3 sm:pb-5">
        <div className="border-b border-stone-200/80 px-1 pb-3 sm:px-0">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                Playground
              </div>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                <h1 className="text-xl font-semibold tracking-tight text-stone-950 sm:text-2xl">
                  Image & Text Playground
                </h1>
                <p className="text-sm text-stone-500">
                  Chat interface for text models; queuing and history for image generation.
                </p>
              </div>
              {experimentMode === "image" ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-xs text-stone-600 sm:flex-wrap sm:overflow-visible sm:pb-0">
                  <span className="shrink-0 rounded-full border border-stone-200/80 bg-white/70 px-3 py-1.5">
                    Provider {imageProviderLabel}
                  </span>
                  <span className="max-w-[240px] shrink-0 truncate rounded-full border border-stone-200/80 bg-white/70 px-3 py-1.5 sm:max-w-[320px]">
                    Model {imageModel || "Pending selection"}
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-200/80 bg-amber-50/80 px-3 py-1.5 text-amber-800">
                    Quota {availableQuota}
                  </span>
                  <span className="shrink-0 rounded-full border border-lime-200/80 bg-lime-50/80 px-3 py-1.5 text-lime-800">
                    {activeTaskCount > 0
                      ? `${activeTaskCount} active jobs`
                      : "Idle"}
                  </span>
                  <span className="shrink-0 rounded-full border border-stone-200/80 bg-white/70 px-3 py-1.5">
                    {selectedConversationStatus}
                  </span>
                </div>
              ) : null}
            </div>
            <ExperimentModeSwitch
              mode={experimentMode}
              onChange={setExperimentMode}
            />
          </div>
        </div>

        {experimentMode === "text" ? (
          <TextExperimentPanel
            prompt={textPrompt}
            messages={textMessages}
            provider={textProvider}
            model={textModel}
            models={textModelOptions}
            providerAvailability={textProviderAvailability}
            isLoading={isSubmittingText}
            isTestingModels={isTestingTextModels}
            modelTestResults={textModelTestResults}
            onPromptChange={setTextPrompt}
            onProviderChange={setTextProvider}
            onModelChange={setTextModel}
            onSubmit={handleTextSubmit}
            onTestModels={handleBatchTextModelTest}
            onClearMessages={handleClearTextMessages}
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="hidden h-full min-h-0 border-r border-stone-200/80 pr-3 lg:block">
              <ImageSidebar
                conversations={conversations}
                isLoadingHistory={isLoadingHistory}
                selectedConversationId={selectedConversationId}
                onCreateDraft={handleCreateDraft}
                onClearHistory={openClearHistoryConfirm}
                onSelectConversation={setSelectedConversationId}
                onDeleteConversation={openDeleteConversationConfirm}
                onRenameConversation={handleRenameConversation}
                formatConversationTime={formatConversationTime}
              />
            </div>

            <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
              <DialogContent className="flex h-[min(82dvh,760px)] w-[92vw] max-w-[460px] flex-col overflow-hidden rounded-2xl border-stone-200 bg-white p-0 shadow-sm">
                <DialogHeader className="px-6 pt-7 pb-4 sm:px-8">
                  <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
                    <History className="size-5" />
                    History
                  </DialogTitle>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8">
                  <ImageSidebar
                    conversations={conversations}
                    isLoadingHistory={isLoadingHistory}
                    selectedConversationId={selectedConversationId}
                    onCreateDraft={() => {
                      handleCreateDraft();
                      setIsHistoryOpen(false);
                    }}
                    onClearHistory={openClearHistoryConfirm}
                    onSelectConversation={(id) => {
                      setSelectedConversationId(id);
                      setIsHistoryOpen(false);
                    }}
                    onDeleteConversation={openDeleteConversationConfirm}
                    onRenameConversation={handleRenameConversation}
                    formatConversationTime={formatConversationTime}
                    hideActionButtons
                  />
                </div>
              </DialogContent>
            </Dialog>

            <div className="flex min-h-0 flex-col gap-2 sm:gap-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-1 lg:hidden">
                <Button
                  variant="outline"
                  className="h-10 min-w-0 rounded-2xl border-stone-200 bg-white/90 text-stone-700 shadow-sm"
                  onClick={() => setIsHistoryOpen(true)}
                >
                  <History className="mr-2 size-4" />
                  History ({conversations.length})
                </Button>
                <Button
                  className="h-10 rounded-2xl bg-stone-950 text-white shadow-sm"
                  onClick={handleCreateDraft}
                >
                  <Plus className="size-4" />
                  New
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-2xl border-stone-200 bg-white/85 px-3 text-stone-600 shadow-sm"
                  onClick={openClearHistoryConfirm}
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div
                ref={resultsViewportRef}
                className="hide-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto border-y border-stone-200/70 px-1 py-3 sm:px-4 sm:py-4"
              >
                <ImageResults
                  selectedConversation={selectedConversation}
                  onOpenLightbox={openLightbox}
                  onContinueEdit={handleContinueEdit}
                  onDeletePrompt={openDeletePromptConfirm}
                  onDeleteResults={openDeleteResultsConfirm}
                  onReuseTurnConfig={handleReuseTurnConfig}
                  onRegenerateTurn={handleRegenerateTurn}
                  onRetryImage={handleRetryImage}
                  formatConversationTime={formatConversationTime}
                />
              </div>

              <ImageComposer
                prompt={imagePrompt}
                imageCount={imageCount}
                imageSize={imageSize}
                imageModel={imageModel}
                imageModels={imageModelOptions}
                imageProvider={imageProvider}
                imageProviderOptions={imageProviderOptions}
                imageModeUnavailableMessage={imageModeUnavailableMessage}
                availableQuota={availableQuota}
                activeTaskCount={activeTaskCount}
                referenceImages={referenceImages}
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                onPromptChange={setImagePrompt}
                onImageCountChange={(value) =>
                  setImageCount(value ? clampImageCount(value) : "")
                }
                onImageSizeChange={setImageSize}
                onImageModelChange={setImageModel}
                onImageProviderChange={(value) =>
                  setImageProvider(normalizeTestProvider(value))
                }
                onSubmit={handleSubmit}
                onPickReferenceImage={() => fileInputRef.current?.click()}
                onReferenceImageChange={handleReferenceImageChange}
                onRemoveReferenceImage={handleRemoveReferenceImage}
              />
            </div>
          </div>
        )}
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />

      {deleteConfirm ? (
        <Dialog
          open
          onOpenChange={(open) => (!open ? setDeleteConfirm(null) : null)}
        >
          <DialogContent showCloseButton={false} className="rounded-2xl p-6">
            <DialogHeader className="gap-2">
              <DialogTitle>{deleteConfirmTitle}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {deleteConfirmDescription}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => void handleConfirmDelete()}
              >
                Are you sure you want to delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <ImagePageContent isAdmin={session.role === "admin"} />;
}
