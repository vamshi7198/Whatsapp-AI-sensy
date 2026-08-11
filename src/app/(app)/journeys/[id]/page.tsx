import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { checkJourney, editableVersion, getVersionGraph } from "@/lib/journeys/service";

import { JourneyCanvas } from "./_canvas";
import type { StepKind, StepModel } from "./_steps";

export const metadata = { title: "Journey" };

/** A short line describing a step, shown on its box. */
function previewOf(
  type: string,
  config: Record<string, unknown>,
  templateNames: Map<string, string>,
  tagNames: Map<string, string>,
): string {
  if (type === "SEND_MESSAGE" || type === "ASK_QUESTION") {
    return String(config.body ?? "").slice(0, 90);
  }
  if (type === "SEND_TEMPLATE") {
    return templateNames.get(String(config.templateId ?? "")) ?? "";
  }
  if (type === "ADD_TAG" || type === "REMOVE_TAG") {
    return tagNames.get(String(config.tagId ?? "")) ?? "";
  }
  if (type === "WAIT") {
    const minutes = Number(config.minutes ?? 0);
    return minutes >= 1440
      ? `${Math.round(minutes / 1440)} day(s)`
      : `${minutes} minutes`;
  }
  if (type === "SEND_MEDIA") return String(config.caption ?? config.link ?? "");
  return "";
}

export default async function JourneyBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth("journey:manage");
  const { id } = await params;

  const journey = await prisma.journey.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  if (!journey) notFound();

  // Editing a live journey opens a new draft rather than the running version,
  // so customers midway through are never disturbed by an edit.
  const versionId = await editableVersion(id, user.id);
  if (!versionId) redirect("/journeys");

  const [graph, validation, templates, tags] = await Promise.all([
    getVersionGraph(versionId),
    checkJourney(versionId),
    prisma.template.findMany({
      where: { status: "APPROVED" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!graph) notFound();

  const templateNames = new Map(templates.map((t) => [t.id, t.name]));
  const tagNames = new Map(tags.map((t) => [t.id, t.name]));

  const steps: StepModel[] = graph.steps.map((step) => {
    const config = (step.config ?? {}) as Record<string, unknown>;

    return {
      id: step.id,
      type: step.type as StepKind,
      name: step.name,
      config,
      x: step.x,
      y: step.y,
      preview: previewOf(step.type, config, templateNames, tagNames),
    };
  });

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8">
      <div className="px-4 pt-2 sm:px-6 lg:px-8">
        <Link
          href="/journeys"
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          ← All journeys
        </Link>
      </div>

      <JourneyCanvas
        versionId={versionId}
        journeyId={journey.id}
        journeyName={journey.name}
        isDraft={graph.status === "DRAFT"}
        initialSteps={steps}
        initialLinks={graph.links.map((l) => ({
          fromStepId: l.fromStepId,
          optionId: l.optionId,
          toStepId: l.toStepId,
        }))}
        initialValidation={validation}
        templates={templates}
        tags={tags}
      />
    </div>
  );
}
