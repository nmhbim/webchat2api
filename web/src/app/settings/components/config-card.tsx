"use client";

import { Cloud, LoaderCircle, PlugZap, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ImageStorageMode } from "@/lib/api";
import { testProxy, type ProxyTestResult } from "@/lib/api";

import { useSettingsStore } from "../store";

export function ConfigCard() {
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const logLevelOptions = ["debug", "info", "warning", "error"];
  const config = useSettingsStore((state) => state.config);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const setRefreshAccountIntervalMinute = useSettingsStore((state) => state.setRefreshAccountIntervalMinute);
  const setImageRetentionDays = useSettingsStore((state) => state.setImageRetentionDays);
  const setImagePollTimeoutSecs = useSettingsStore((state) => state.setImagePollTimeoutSecs);
  const setImageAccountConcurrency = useSettingsStore((state) => state.setImageAccountConcurrency);
  const setAutoRemoveInvalidAccounts = useSettingsStore((state) => state.setAutoRemoveInvalidAccounts);
  const setAutoRemoveRateLimitedAccounts = useSettingsStore((state) => state.setAutoRemoveRateLimitedAccounts);
  const setLogLevel = useSettingsStore((state) => state.setLogLevel);
  const setProxy = useSettingsStore((state) => state.setProxy);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const setGlobalSystemPrompt = useSettingsStore((state) => state.setGlobalSystemPrompt);
  const setSensitiveWordsText = useSettingsStore((state) => state.setSensitiveWordsText);
  const setAIReviewField = useSettingsStore((state) => state.setAIReviewField);
  const setImageStorageField = useSettingsStore((state) => state.setImageStorageField);
  const testImageStorage = useSettingsStore((state) => state.testImageStorage);
  const syncImagesToWebDAV = useSettingsStore((state) => state.syncImagesToWebDAV);
  const isTestingImageStorage = useSettingsStore((state) => state.isTestingImageStorage);
  const isSyncingImageStorage = useSettingsStore((state) => state.isSyncingImageStorage);
  const saveConfig = useSettingsStore((state) => state.saveConfig);

  const handleTestProxy = async () => {
    const candidate = String(config?.proxy || "").trim();
    if (!candidate) {
      toast.error("Please enter a proxy address first");
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const data = await testProxy(candidate);
      setProxyTestResult(data.result);
      if (data.result.ok) {
        toast.success(`Proxy available（${data.result.latency_ms} ms，HTTP ${data.result.status}）`);
      } else {
        toast.error(`Proxy unavailable：${data.result.error ?? "Unknown error"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to test proxy");
    } finally {
      setIsTestingProxy(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <Card className="rounded-[28px] border-white/75 bg-card/88 shadow-[var(--shadow-soft)] backdrop-blur-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[28px] border-white/75 bg-card/88 shadow-[var(--shadow-soft)] backdrop-blur-sm">
      <CardContent className="space-y-4 p-6">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
          Admin login secret continues to be read from deployment config and is not shown here. Create User API Keys below for team access.
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Account Refresh Interval (Minutes)</label>
            <Input
              value={String(config?.refresh_account_interval_minute || "")}
              onChange={(event) => setRefreshAccountIntervalMinute(event.target.value)}
              placeholder="minutes"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">In minutes; controls automatic background account refresh frequency.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Global Proxy</label>
            <Input
              value={String(config?.proxy || "")}
              onChange={(event) => {
                setProxy(event.target.value);
                setProxyTestResult(null);
              }}
              placeholder="http://127.0.0.1:7890"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">Leave blank for direct connection.</p>
            {proxyTestResult ? (
              <div
                className={`rounded-xl border px-3 py-2 text-xs leading-6 ${
                  proxyTestResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                {proxyTestResult.ok
                  ? `Proxy available：HTTP ${proxyTestResult.status}，time ${proxyTestResult.latency_ms} ms`
                  : `Proxy unavailable：${proxyTestResult.error ?? "Unknown error"}（time ${proxyTestResult.latency_ms} ms）`}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                onClick={() => void handleTestProxy()}
                disabled={isTestingProxy}
              >
                {isTestingProxy ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                Test Proxy
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Image Access URL</label>
            <Input
              value={String(config?.base_url || "")}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.com"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">Public URL prefix used for generating image links.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Auto Clean Images (Days)</label>
            <Input
              value={String(config?.image_retention_days || "")}
              onChange={(event) => setImageRetentionDays(event.target.value)}
              placeholder="30"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">Automatically deletes local images older than specified days.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Image Polling Timeout (Seconds)</label>
            <Input
              value={String(config?.image_poll_timeout_secs || "")}
              onChange={(event) => setImagePollTimeoutSecs(event.target.value)}
              placeholder="120"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">In seconds; maximum time to wait for upstream image completion.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Per-Account Image Concurrency</label>
            <Input
              value={String(config?.image_account_concurrency || "")}
              onChange={(event) => setImageAccountConcurrency(event.target.value)}
              placeholder="1"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">Maximum simultaneous image requests per account; default is 3.</p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
            <Checkbox
              checked={Boolean(config?.auto_remove_invalid_accounts)}
              onCheckedChange={(checked) => setAutoRemoveInvalidAccounts(Boolean(checked))}
            />
            Auto-remove Abnormal Accounts
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
            <Checkbox
              checked={Boolean(config?.auto_remove_rate_limited_accounts)}
              onCheckedChange={(checked) => setAutoRemoveRateLimitedAccounts(Boolean(checked))}
            />
            Auto-remove Rate-limited Accounts
          </label>
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
            <div>
              <label className="text-sm text-stone-700">Console Log Level</label>
              <p className="mt-1 text-xs text-stone-500">Defaults to info / warning / error if not selected.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {logLevelOptions.map((level) => (
                <label key={level} className="flex items-center gap-2 text-sm capitalize text-stone-700">
                  <Checkbox
                    checked={Boolean(config?.log_levels?.includes(level))}
                    onCheckedChange={(checked) => setLogLevel(level, Boolean(checked))}
                  />
                  {level}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">Global System Prompt</label>
            <Textarea
              value={String(config?.global_system_prompt || "")}
              onChange={(event) => setGlobalSystemPrompt(event.target.value)}
              placeholder="e.g. Always respond politely; decline harmful or inappropriate requests."
              className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
            />
            <p className="text-xs text-stone-500">Injected into every request as a system message to guide model behavior or enforce policy.</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">Sensitive Words</label>
            <Textarea
              value={(config?.sensitive_words || []).join("\n")}
              onChange={(event) => setSensitiveWordsText(event.target.value)}
              placeholder="One per line; requests containing matches are rejected"
              className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
            />
            <p className="text-xs text-stone-500">Rejects user requests immediately if any listed word is found.</p>
          </div>
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white px-4 py-3 md:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-3 text-sm text-stone-700">
                <Checkbox
                  checked={Boolean(config?.image_storage?.enabled)}
                  onCheckedChange={(checked) => setImageStorageField("enabled", Boolean(checked))}
                />
                Enable WebDAV Image Storage
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void testImageStorage()}
                  disabled={isTestingImageStorage || !config?.image_storage?.enabled}
                >
                  {isTestingImageStorage ? <LoaderCircle className="size-4 animate-spin" /> : <Cloud className="size-4" />}
                  Test WebDAV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void syncImagesToWebDAV()}
                  disabled={isSyncingImageStorage || !config?.image_storage?.enabled || config?.image_storage?.mode === "local"}
                >
                  {isSyncingImageStorage ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Full Sync
                </Button>
              </div>
            </div>
            <p className="text-xs leading-6 text-stone-500">
              New images sync automatically upon generation; Full Sync uploads past local images to WebDAV.
            </p>
            <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-600">
              Pending save mode: 
              <span className="ml-1 font-medium text-stone-900">
                {config?.image_storage?.enabled
                  ? config.image_storage.mode === "both"
                    ? "Local Storage + WebDAV"
                    : config.image_storage.mode === "webdav"
                      ? "WebDAV Only"
                      : "Local Storage Only"
                  : "Local Storage Only"}
              </span>
              <span className="ml-2 text-stone-400">Click Save or use Test/Sync buttons to persist changes.</span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Storage Mode</label>
                <Select
                  value={String(config?.image_storage?.mode || "local")}
                  onValueChange={(value) => setImageStorageField("mode", value as ImageStorageMode)}
                  disabled={!config?.image_storage?.enabled}
                >
                  <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Storage Only</SelectItem>
                    <SelectItem value="webdav">WebDAV Only</SelectItem>
                    <SelectItem value="both">Local Storage + WebDAV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm text-stone-700">WebDAV URL</label>
                <Input
                  value={String(config?.image_storage?.webdav_url || "")}
                  onChange={(event) => setImageStorageField("webdav_url", event.target.value)}
                  placeholder="https://example.com/dav"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                  disabled={!config?.image_storage?.enabled}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Username</label>
                <Input
                  value={String(config?.image_storage?.webdav_username || "")}
                  onChange={(event) => setImageStorageField("webdav_username", event.target.value)}
                  className="h-10 rounded-xl border-stone-200 bg-white"
                  disabled={!config?.image_storage?.enabled}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Password</label>
                <Input
                  type="password"
                  value={String(config?.image_storage?.webdav_password || "")}
                  onChange={(event) => setImageStorageField("webdav_password", event.target.value)}
                  className="h-10 rounded-xl border-stone-200 bg-white"
                  disabled={!config?.image_storage?.enabled}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Remote Directory</label>
                <Input
                  value={String(config?.image_storage?.webdav_root_path || "")}
                  onChange={(event) => setImageStorageField("webdav_root_path", event.target.value)}
                  placeholder="webchat2api/images"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                  disabled={!config?.image_storage?.enabled}
                />
              </div>
              <div className="space-y-2 md:col-span-3">
                <label className="text-sm text-stone-700">Public Access Prefix</label>
                <Input
                  value={String(config?.image_storage?.public_base_url || "")}
                  onChange={(event) => setImageStorageField("public_base_url", event.target.value)}
                  placeholder="https://cdn.example.com/webchat2api/images"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                  disabled={!config?.image_storage?.enabled}
                />
                <p className="text-xs text-stone-500">When blank, returns local /images/... proxy URL; when configured, returns public URL directly.</p>
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white px-4 py-3 md:col-span-2">
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <Checkbox
                checked={Boolean(config?.ai_review?.enabled)}
                onCheckedChange={(checked) => setAIReviewField("enabled", Boolean(checked))}
              />
              Enabled AI Review Moderation
            </label>
            <p className="text-xs leading-6 text-stone-500">
              Invokes moderation model before generation; rejects violations early to protect accounts from bans.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Base URL</label>
                <Input value={String(config?.ai_review?.base_url || "")} onChange={(event) => setAIReviewField("base_url", event.target.value)} placeholder="https://api.openai.com" className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">API Key</label>
                <Input value={String(config?.ai_review?.api_key || "")} onChange={(event) => setAIReviewField("api_key", event.target.value)} placeholder="sk-..." className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Model</label>
                <Input value={String(config?.ai_review?.model || "")} onChange={(event) => setAIReviewField("model", event.target.value)} placeholder="gpt-5.4-mini" className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">Moderation Prompt</label>
              <Textarea value={String(config?.ai_review?.prompt || "")} onChange={(event) => setAIReviewField("prompt", event.target.value)} placeholder="Determine if user request is allowed. Respond only with ALLOW or REJECT." className="min-h-24 rounded-xl border-stone-200 bg-white text-xs shadow-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void saveConfig()}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
