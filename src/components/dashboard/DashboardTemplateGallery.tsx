"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, ArrowRight, LayoutTemplate, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardTemplate } from "@/lib/dashboard-templates";

interface DashboardTemplateGalleryProps {
  templates: DashboardTemplate[];
  connectedSources: string[];
  workspaceId: string;
}

export function DashboardTemplateGallery({
  templates,
  connectedSources,
  workspaceId,
}: DashboardTemplateGalleryProps) {
  const router = useRouter();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(
    async (template: DashboardTemplate) => {
      setSelectedSlug(template.slug);
      setIsCreating(true);

      try {
        const res = await fetch("/api/dashboard-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            templateSlug: template.slug,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          if (data.error === "Missing required sources") {
            toast.error(
              `This template requires: ${data.required.join(", ")}. Please connect these sources first.`,
              {
                action: {
                  label: "Connect Sources",
                  onClick: () => router.push("/sources"),
                },
              }
            );
          } else {
            throw new Error(data.error || "Failed to create dashboard");
          }
          return;
        }

        toast.success(`Created ${template.name} dashboard`);
        router.push("/console");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create dashboard");
      } finally {
        setIsCreating(false);
        setSelectedSlug(null);
      }
    },
    [workspaceId, router]
  );

  const featured = templates.filter((t) => t.isFeatured);
  const available = templates.filter((t) => !t.isFeatured);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Dashboard Templates
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose a pre-built dashboard or start from scratch
          </p>
        </div>
      </div>

      {/* Featured Templates */}
      {featured.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Featured
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((template) => (
              <TemplateCard
                key={template.slug}
                template={template}
                isSelected={selectedSlug === template.slug}
                isCreating={isCreating && selectedSlug === template.slug}
                connectedSources={connectedSources}
                onClick={() => handleCreate(template)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Available Templates */}
      {available.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Available for Your Data
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((template) => (
              <TemplateCard
                key={template.slug}
                template={template}
                isSelected={selectedSlug === template.slug}
                isCreating={isCreating && selectedSlug === template.slug}
                connectedSources={connectedSources}
                onClick={() => handleCreate(template)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {templates.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl">
          <LayoutTemplate className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            No templates available yet
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Connect data sources to unlock pre-built dashboards
          </p>
          <button
            onClick={() => router.push("/sources")}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-600 hover:text-cyan-700"
          >
            Connect a source
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Manual Create Option */}
      <div className="pt-4 border-t border-gray-200 dark:border-slate-700">
        <button
          onClick={() => router.push("/console")}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <Plus className="h-4 w-4" />
          Start with blank dashboard
        </button>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  template: DashboardTemplate;
  isSelected: boolean;
  isCreating: boolean;
  connectedSources: string[];
  onClick: () => void;
}

function TemplateCard({
  template,
  isSelected,
  isCreating,
  connectedSources,
  onClick,
}: TemplateCardProps) {
  const missingSources = template.requiredSources.filter(
    (s) => !connectedSources.includes(s)
  );
  const isAvailable = missingSources.length === 0;

  return (
    <button
      onClick={onClick}
      disabled={isCreating}
      className={cn(
        "relative text-left rounded-xl border p-4 transition-all",
        isAvailable
          ? "border-gray-200 bg-white hover:border-cyan-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-cyan-600"
          : "border-gray-100 bg-gray-50 opacity-60 dark:border-slate-800 dark:bg-slate-900",
        isSelected && "ring-2 ring-cyan-500"
      )}
    >
      {/* Icon */}
      <div className="flex items-start justify-between">
        <img
          src={template.icon}
          alt=""
          className="h-10 w-10 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/icons/dashboard.svg";
          }}
        />
        {template.isFeatured && (
          <span className="flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
            <Sparkles className="h-3 w-3" />
            Featured
          </span>
        )}
      </div>

      {/* Content */}
      <h4 className="mt-3 font-semibold text-gray-900 dark:text-white">
        {template.name}
      </h4>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
        {template.description}
      </p>

      {/* Required Sources */}
      <div className="mt-3 flex flex-wrap gap-1">
        {template.requiredSources.map((source) => {
          const isConnected = connectedSources.includes(source);
          return (
            <span
              key={source}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isConnected
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                  : "bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400"
              )}
            >
              {isConnected && <Check className="h-2.5 w-2.5" />}
              {source.replace(/_/g, " ")}
            </span>
          );
        })}
      </div>

      {/* Action Indicator */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-cyan-600 dark:text-cyan-400">
          {isCreating
            ? "Creating..."
            : isAvailable
            ? "Click to create →"
            : `${missingSources.length} source${missingSources.length > 1 ? "s" : ""} required`}
        </span>
      </div>
    </button>
  );
}
