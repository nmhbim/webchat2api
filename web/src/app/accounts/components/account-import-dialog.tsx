"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  ExternalLink,
  FileJson,
  FileText,
  Files,
  KeyRound,
  LoaderCircle,
  ServerCog,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAccounts, type Account, type AccountImportPayload } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  accountImportProviderOptions,
  getAccountProviderDefinition,
} from "@/providers/registry";
import type { AccountImportMethod, ProviderId } from "@/providers/types";

type ImportMethod = "provider" | "methods" | AccountImportMethod;
type ImportProvider = ProviderId;

type AccountImportDialogProps = {
  disabled?: boolean;
  onImported: (items: Account[], provider: ImportProvider) => void | Promise<void>;
};

type PendingCpaImport = {
  tokens: string[];
  accounts: AccountImportPayload[];
  parsedFileCount: number;
  errorCount: number;
};

const methodIcons: Record<AccountImportMethod, typeof KeyRound> = {
  token: KeyRound,
  session: FileJson,
  cpa: Files,
  "remote-cpa": Files,
  sub2api: ServerCog,
};

function splitTokens(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSessionAccessToken(value: unknown) {
  const token = (value as { accessToken?: unknown })?.accessToken;
  return typeof token === "string" ? token.trim() : "";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getStringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasCookiePair(value: string, name: string) {
  return new RegExp(`(?:^|[;\\s])${name}\\s*=`, "i").test(value);
}

function normalizeGrokSsoCookie(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes(";") || hasCookiePair(trimmed, "sso-rw")) {
    return "";
  }
  if (trimmed.includes("=")) {
    return /^sso\s*=\s*[^=;\s]+$/i.test(trimmed) ? trimmed : "";
  }
  return trimmed;
}

function getProviderScopedRecord(raw: Record<string, unknown>, provider: ImportProvider) {
  const rawProvider = getStringField(raw.provider).toLowerCase();
  if (rawProvider && rawProvider !== provider) {
    return null;
  }
  return raw;
}

function buildCpaPayload(raw: Record<string, unknown>, token: string, provider: ImportProvider): AccountImportPayload {
  const payload: AccountImportPayload = {
    ...raw,
    access_token: token,
    provider,
  };
  if (provider !== "gpt") {
    delete payload.accessToken;
  }
  if (provider === "gpt" && payload.type === "codex") {
    payload.export_type = "codex";
    payload.source_type = "codex";
    delete payload.type;
  }
  return payload;
}

function getCookieStringField(value: unknown) {
  const stringValue = getStringField(value);
  if (stringValue) {
    return stringValue;
  }

  const record = getRecord(value);
  if (!record) {
    return "";
  }

  return Object.entries(record)
    .map(([name, cookieValue]) => {
      const normalizedValue = getStringField(cookieValue);
      return normalizedValue ? `${name}=${normalizedValue}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function getCpaToken(raw: Record<string, unknown>, provider: ImportProvider) {
  if (provider === "grok") {
    const directSso = normalizeGrokSsoCookie(getStringField(raw.sso));
    if (directSso) {
      return directSso;
    }

    const cookie = getStringField(raw.cookie) || getStringField(raw.cookie_header) || getStringField(raw.cookieHeader) || getCookieStringField(raw.cookies);
    if (hasCookiePair(cookie, "sso")) {
      return cookie;
    }

    const accessToken = getStringField(raw.access_token) || getStringField(raw.accessToken);
    return hasCookiePair(accessToken, "sso") ? accessToken : "";
  }

  return getStringField(raw.access_token) || getStringField(raw.accessToken);
}

function getCpaAccount(value: unknown, provider: ImportProvider): AccountImportPayload | null {
  const raw = getRecord(value);
  if (!raw) {
    return null;
  }

  const scopedRaw = getProviderScopedRecord(raw, provider);
  if (!scopedRaw) {
    return null;
  }

  const token = getCpaToken(scopedRaw, provider);
  return token ? buildCpaPayload(scopedRaw, token, provider) : null;
}

function collectCpaAccounts(value: unknown, provider: ImportProvider): AccountImportPayload[] {
  const directAccount = getCpaAccount(value, provider);
  if (directAccount) {
    return [directAccount];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCpaAccounts(item, provider));
  }

  const raw = getRecord(value);
  if (!raw) {
    return [];
  }

  const nestedValues = [raw.account, raw.accounts, raw.items, raw.data, raw.results, raw.records, raw.list].filter((item): item is unknown => item !== undefined);
  return nestedValues.flatMap((item) => collectCpaAccounts(item, provider));
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

function methodTitle(method: AccountImportMethod, provider: ImportProvider) {
  const definition = getAccountProviderDefinition(provider);
  if (method === "token") return definition.importTokenCopy.label;
  if (method === "session") return definition.importSessionCopy.label;
  if (method === "cpa") return "Local JSON Files";
  if (method === "remote-cpa") return "Remote CPA Server";
  return "Sub2API Server";
}

function methodDescription(method: AccountImportMethod, provider: ImportProvider) {
  const definition = getAccountProviderDefinition(provider);
  if (method === "token") return definition.importTokenCopy.fileHelp ?? definition.importTokenCopy.placeholder;
  if (method === "session") return definition.importSessionCopy.help || definition.importSessionCopy.placeholder;
  if (method === "cpa") return definition.importFlowCopy.cpaHelp;
  if (method === "remote-cpa") return definition.importFlowCopy.remoteCpaDescription;
  return definition.importFlowCopy.sub2apiDescription;
}

function MethodCard({
  method,
  provider,
  onClick,
}: {
  method: AccountImportMethod;
  provider: ImportProvider;
  onClick: () => void;
}) {
  const Icon = methodIcons[method];
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-stone-200 bg-white p-4 text-left transition hover:border-stone-300 hover:bg-stone-50"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-stone-100 p-3 text-stone-700">
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-stone-900">{methodTitle(method, provider)}</div>
          <div className="text-sm leading-6 text-stone-500">{methodDescription(method, provider)}</div>
        </div>
      </div>
    </button>
  );
}

export function AccountImportDialog({ disabled, onImported }: AccountImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ImportMethod>("provider");
  const [tokenInput, setTokenInput] = useState("");
  const [importProvider, setImportProvider] = useState<ImportProvider>("gpt");
  const [sessionInput, setSessionInput] = useState("");
  const [geminiSecure1Psid, setGeminiSecure1Psid] = useState("");
  const [geminiSecure1Psidts, setGeminiSecure1Psidts] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCpaImport, setPendingCpaImport] = useState<PendingCpaImport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const txtInputRef = useRef<HTMLInputElement | null>(null);
  const cpaInputRef = useRef<HTMLInputElement | null>(null);

  const providerDefinition = getAccountProviderDefinition(importProvider);
  const availableMethods = providerDefinition.importMethods;

  const resetState = () => {
    setMethod("provider");
    setTokenInput("");
    setImportProvider("gpt");
    setSessionInput("");
    setGeminiSecure1Psid("");
    setGeminiSecure1Psidts("");
    setPendingCpaImport(null);
    setConfirmOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const submitTokens = async (tokens: string[], successText?: string, accountPayloads: AccountImportPayload[] = []) => {
    const normalizedTokens = tokens.map((item) => item.trim()).filter(Boolean);

    if (normalizedTokens.length === 0 && accountPayloads.length === 0) {
      toast.error("Please provide at least one valid credential");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await createAccounts(normalizedTokens, accountPayloads, importProvider);
      const refreshText = providerDefinition.refresh.enabled ? `Automatically refreshed ${providerDefinition.label} account info` : "Added to pool with submitted content";
      await onImported(data.items, importProvider);
      setOpen(false);
      resetState();

      if ((data.errors?.length ?? 0) > 0) {
        const firstError = data.errors?.[0]?.error;
        toast.error(
          `${successText ?? "Import completed"}，Added ${data.added ?? 0} ，Refreshed ${data.refreshed ?? 0} ，Failed ${data.errors?.length ?? 0} ${firstError ? `，First error：${firstError}` : ""}`,
        );
      } else {
        toast.success(`${successText ?? "Import completed"}，Added ${data.added ?? 0} ，Skipped ${data.skipped ?? 0} duplicate items，${refreshText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import accounts";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildTokenPayloads = (tokens: string[]): AccountImportPayload[] => {
    if (importProvider === "grok") {
      return [];
    }

    return tokens.map((token) => ({ access_token: token, provider: importProvider }));
  };

  const normalizeImportTokens = (tokens: string[]) => {
    if (importProvider !== "grok") {
      return tokens;
    }
    return tokens.map(normalizeGrokSsoCookie).filter(Boolean);
  };

  const hasInvalidGrokImportTokens = (tokens: string[]) => {
    return importProvider === "grok" && tokens.some((token) => !normalizeGrokSsoCookie(token));
  };

  const showInvalidGrokImportToast = () => {
    toast.error("Grok only supports raw SSO values or single sso=value per line; sso-rw, full Cookie headers, or other name=value pairs are not supported.");
  };

  const buildGeminiSessionPayload = (secure1Psid: string, secure1Psidts: string): AccountImportPayload => {
    return {
      provider: "gemini",
      "__Secure-1PSID": secure1Psid,
      "__Secure-1PSIDTS": secure1Psidts,
    };
  };

  const handleImportTokenText = async () => {
    const rawTokens = splitTokens(tokenInput);
    if (hasInvalidGrokImportTokens(rawTokens)) {
      showInvalidGrokImportToast();
      return;
    }

    const tokens = normalizeImportTokens(rawTokens);
    await submitTokens(tokens, providerDefinition.importTokenCopy.successLabel, buildTokenPayloads(tokens));
  };

  const handleTxtSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const content = await readFileAsText(file);
      const rawTokens = splitTokens(content);
      if (hasInvalidGrokImportTokens(rawTokens)) {
        showInvalidGrokImportToast();
        return;
      }

      const tokens = normalizeImportTokens(rawTokens);

      if (tokens.length === 0) {
        toast.error("No valid credentials found in TXT file");
        return;
      }

      setTokenInput((prev) => {
        const next = [...splitTokens(prev), ...tokens];
        return next.join("\n");
      });
      toast.success(`Loaded ${tokens.length} credentials from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read TXT file";
      toast.error(message);
    }
  };

  const handleImportSessionJson = async () => {
    const sessionCopy = providerDefinition.importSessionCopy;

    if (importProvider === "gemini") {
      const secure1Psid = geminiSecure1Psid.trim();
      const secure1Psidts = geminiSecure1Psidts.trim();

      if (!secure1Psid || !secure1Psidts) {
        toast.error("Please enter values for both __Secure-1PSID and __Secure-1PSIDTS");
        return;
      }
      if (secure1Psid.includes("=") || secure1Psid.includes(";") || secure1Psidts.includes("=") || secure1Psidts.includes(";")) {
        toast.error("Enter only the cookie value to the right of '=', without cookie name or semicolons");
        return;
      }

      const accountPayload = buildGeminiSessionPayload(secure1Psid, secure1Psidts);
      await submitTokens([], sessionCopy.successLabel, [accountPayload]);
      return;
    }

    if (!sessionCopy.parseJsonAccessToken) {
      const rawTokens = splitTokens(sessionInput);
      if (hasInvalidGrokImportTokens(rawTokens)) {
        showInvalidGrokImportToast();
        return;
      }

      const tokens = normalizeImportTokens(rawTokens);
      await submitTokens(tokens, sessionCopy.successLabel, buildTokenPayloads(tokens));
      return;
    }

    if (!sessionInput.trim()) {
      toast.error(sessionCopy.emptyMessage ?? "Please paste full Session JSON first");
      return;
    }

    try {
      const payload = JSON.parse(sessionInput) as unknown;
      const token = getSessionAccessToken(payload);

      if (!token) {
        toast.error("No accessToken extracted from GPT Session JSON");
        return;
      }

      await submitTokens([token], sessionCopy.successLabel, buildTokenPayloads([token]));
    } catch (error) {
      const message = error instanceof Error ? error.message : (sessionCopy.parseErrorMessage ?? "Failed to parse Session JSON");
      toast.error(message);
    }
  };

  const handleCpaSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const raw = await readFileAsText(file);
          const parsed = JSON.parse(raw) as unknown;
          const accountList = collectCpaAccounts(parsed, importProvider);
          return { accounts: accountList };
        }),
      );

      const accounts = results.flatMap((item) => item.accounts);
      const tokens = accounts.map((item) => item.access_token).filter((token): token is string => Boolean(token));
      const parsedFileCount = results.filter((item) => item.accounts.length > 0).length;
      const errorCount = results.length - parsedFileCount;

      if (parsedFileCount === 0) {
        toast.error("No usable credentials found in these JSON files");
        return;
      }

      setPendingCpaImport({ tokens, accounts, parsedFileCount, errorCount });
      setConfirmOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read JSON files";
      toast.error(message);
    }
  };

  const renderProviderStep = () => (
    <div className="space-y-3">
      {accountImportProviderOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            setImportProvider(option.value);
            setMethod("methods");
          }}
          className={cn(
            "w-full rounded-2xl border bg-white p-4 text-left transition hover:border-stone-300 hover:bg-stone-50",
            importProvider === option.value ? "border-stone-300" : "border-stone-200",
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-stone-900">{option.label}</div>
              <div className="text-sm leading-6 text-stone-500">{option.description}</div>
            </div>
            <div className="text-xs font-semibold tracking-[0.16em] text-stone-400 uppercase">Select</div>
          </div>
        </button>
      ))}
    </div>
  );

  const renderMethodMenu = () => {
    if (availableMethods.length === 0) {
      return <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-500">{providerDefinition.importFlowCopy.emptyMethodsLabel}</div>;
    }

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setMethod("provider")}
          className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
        >
          <ArrowLeft className="size-4" />
          Back to Provider Selection
        </button>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
          {providerDefinition.importFlowCopy.methodIntro}
        </div>
        <div className="space-y-3">
          {availableMethods.map((item) => (
            <MethodCard
              key={item}
              method={item}
              provider={importProvider}
              onClick={() => {
                if (item === "remote-cpa" || item === "sub2api") {
                  setOpen(false);
                  resetState();
                  router.push("/settings");
                  return;
                }
                setMethod(item);
              }}
            />
          ))}
        </div>
      </div>
    );
  };

  const renderMethodBody = () => {
    if (method === "provider") {
      return renderProviderStep();
    }

    if (method === "methods" || !availableMethods.includes(method)) {
      return renderMethodMenu();
    }

    if (method === "token") {
      const tokenCount = splitTokens(tokenInput).length;
      const tokenCopy = providerDefinition.importTokenCopy;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMethod("methods")}
              className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
            >
              <ArrowLeft className="size-4" />
              Back to Import Methods
            </button>
            <span className="text-xs text-stone-400">Recognized {tokenCount} credentials from</span>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">{tokenCopy.label}</label>
            <Textarea
              placeholder={tokenCopy.placeholder}
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              className="min-h-48 resize-none rounded-xl border-stone-200"
            />
          </div>
          <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="text-sm font-medium text-stone-800">Import from TXT File</div>
                <div className="text-sm leading-6 text-stone-500">{tokenCopy.fileHelp}</div>
              </div>
              <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white" onClick={() => txtInputRef.current?.click()} disabled={isSubmitting}>
                <FileText className="size-4" />
                Select TXT
              </Button>
            </div>
          </div>
          <input ref={txtInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => void handleTxtSelected(event)} />
        </div>
      );
    }

    if (method === "session") {
      const sessionCopy = providerDefinition.importSessionCopy;

      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setMethod("methods")}
            className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
          >
            <ArrowLeft className="size-4" />
            Back to Import Methods
          </button>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-600">
            {sessionCopy.parseJsonAccessToken && sessionCopy.sessionUrl ? (
              <>
                Open{" "}
                <a href={sessionCopy.sessionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-stone-900 underline underline-offset-4">
                  {sessionCopy.sessionUrl}
                  <ExternalLink className="size-3.5" />
                </a>
                , copy the full JSON response, and the system will automatically extract and import the accessToken.
              </>
            ) : (
              sessionCopy.help
            )}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <div className="font-medium">Risk Warning</div>
            <div>Do not use primary personal accounts. Use disposable or secondary accounts to minimize ban risk. This project assumes no liability for account suspensions.</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {importProvider === "gemini" ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700">__Secure-1PSID</label>
                  <Input
                    value={geminiSecure1Psid}
                    onChange={(event) => setGeminiSecure1Psid(event.target.value)}
                    placeholder="Enter only the __Secure-1PSID value"
                    className="h-11 rounded-xl border-stone-200 bg-white font-mono text-xs"
                  />
                  <p className="text-xs leading-5 text-stone-500">Do not include cookie name; paste only the value to the right of '='.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700">__Secure-1PSIDTS</label>
                  <Input
                    value={geminiSecure1Psidts}
                    onChange={(event) => setGeminiSecure1Psidts(event.target.value)}
                    placeholder="Enter only the __Secure-1PSIDTS value"
                    className="h-11 rounded-xl border-stone-200 bg-white font-mono text-xs"
                  />
                  <p className="text-xs leading-5 text-stone-500">Required; do not include cookie name; paste only the value to the right of '='.</p>
                </div>
              </>
            ) : (
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-stone-700">{sessionCopy.label}</label>
                <Textarea
                  placeholder={sessionCopy.placeholder}
                  value={sessionInput}
                  onChange={(event) => setSessionInput(event.target.value)}
                  className="min-h-48 resize-none rounded-xl border-stone-200 font-mono text-xs"
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    if (method === "cpa") {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setMethod("methods")}
            className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
          >
            <ArrowLeft className="size-4" />
            Back to Import Methods
          </button>
          <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-5">
            <div className="space-y-2">
              <div className="text-sm font-medium text-stone-800">Select Multiple Local JSON Files</div>
              <div className="text-sm leading-6 text-stone-500">{providerDefinition.importFlowCopy.cpaHelp}</div>
            </div>
            <Button type="button" className="mt-4 rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => cpaInputRef.current?.click()} disabled={isSubmitting}>
              <Files className="size-4" />
              Select Multiple JSON Files
            </Button>
          </div>
          <input ref={cpaInputRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={(event) => void handleCpaSelected(event)} />
          {pendingCpaImport ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-6 text-stone-600">
              Latest read: {pendingCpaImport.parsedFileCount} credentials from{pendingCpaImport.errorCount > 0 ? `, additionally ${pendingCpaImport.errorCount} files failed to parse` : ""}。
            </div>
          ) : null}
        </div>
      );
    }

    return renderMethodMenu();
  };

  const footerDisabled = disabled || isSubmitting;
  const selectedTokenCopy = providerDefinition.importTokenCopy;
  const selectedSessionCopy = providerDefinition.importSessionCopy;
  const title = useMemo(() => {
    if (method === "provider") return "Select Import Provider";
    if (method === "methods" || !availableMethods.includes(method)) return `${providerDefinition.label} Import Methods`;
    return `${providerDefinition.label} ${methodTitle(method, importProvider)}`;
  }, [availableMethods, importProvider, method, providerDefinition.label]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Button className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setOpen(true)} disabled={disabled}>
          <Upload className="size-4" />
          Import
        </Button>
        <DialogContent showCloseButton={false} className="max-h-[88vh] overflow-y-auto rounded-2xl p-6 sm:max-w-2xl">
          <DialogHeader className="gap-2">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {method === "provider" ? "Select a provider first to see supported import methods and field guidelines." : providerDefinition.importFlowCopy.methodIntro}
            </DialogDescription>
          </DialogHeader>

          {renderMethodBody()}

          <DialogFooter className="pt-2">
            <Button variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setOpen(false)} disabled={footerDisabled}>
              Cancel
            </Button>
            {method !== "provider" && (
              <Button variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-5 text-stone-700" onClick={() => setMethod("provider")} disabled={footerDisabled}>
                Switch Provider
              </Button>
            )}
            {method === "token" ? (
              <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleImportTokenText()} disabled={footerDisabled}>
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {selectedTokenCopy.submitLabel}
              </Button>
            ) : null}
            {method === "session" ? (
              <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleImportSessionJson()} disabled={footerDisabled}>
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {selectedSessionCopy.submitLabel}
              </Button>
            ) : null}
            {method === "cpa" ? (
              <Button
                className={cn("h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800", !pendingCpaImport ? "hidden" : "")}
                onClick={() => setConfirmOpen(true)}
                disabled={footerDisabled || !pendingCpaImport}
              >
                Review Import
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>Confirm Import {providerDefinition.label} JSON</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {pendingCpaImport ? `Confirmed recognition of ${pendingCpaImport.parsedFileCount} credentials from，credentials. Confirm import to ${providerDefinition.label}？` : "No importable credentials found yet."}
              {pendingCpaImport?.errorCount ? `, additionally ${pendingCpaImport.errorCount} files failed to parse。` : "。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="secondary" className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200" onClick={() => setConfirmOpen(false)} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void submitTokens(pendingCpaImport?.tokens ?? [], `${providerDefinition.label} JSON import completed`, pendingCpaImport?.accounts ?? [])}
              disabled={isSubmitting || !pendingCpaImport}
            >
              {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
