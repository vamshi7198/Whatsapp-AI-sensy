"use client";

import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ValidationResult } from "@/lib/journeys/validate";

import { publishJourneyAction, saveGraphAction, testJourneyAction } from "../actions";
import { StepSettings } from "./_settings";
import {
  STEP_LIBRARY,
  branchOptionsOf,
  type StepKind,
  type StepModel,
} from "./_steps";

/**
 * The journey canvas.
 *
 * Boxes are steps, lines are what happens next. A step that offers choices
 * grows one outgoing point per choice, so a branch is visible as a line
 * leaving the button it belongs to rather than something configured elsewhere.
 * That is the single decision that makes a branching conversation readable.
 */

interface CanvasProps {
  versionId: string;
  journeyId: string;
  journeyName: string;
  isDraft: boolean;
  initialSteps: StepModel[];
  initialLinks: Array<{ fromStepId: string; optionId: string | null; toStepId: string }>;
  initialValidation: ValidationResult;
  templates: Array<{ id: string; name: string; category: string }>;
  tags: Array<{ id: string; name: string }>;
}

type StepNode = Node<{ step: StepModel; problem?: string }>;

/* -------------------------------------------------------------------------- */
/* The box                                                                     */
/* -------------------------------------------------------------------------- */

function StepBox({ data, selected }: NodeProps<StepNode>) {
  const { step, problem } = data;
  const meta = STEP_LIBRARY[step.type];
  const options = branchOptionsOf(step);

  return (
    <div
      className={`w-60 rounded-xl border-2 bg-white shadow-sm dark:bg-slate-900 ${
        problem
          ? "border-red-400"
          : selected
            ? "border-emerald-500"
            : "border-slate-200 dark:border-slate-700"
      }`}
    >
      {step.type !== "START" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-4 !w-4 !border-2 !border-white !bg-slate-400"
        />
      )}

      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span aria-hidden="true">{meta?.icon ?? "•"}</span>
        <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
          {meta?.label ?? step.type}
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {step.name}
        </p>

        {step.preview && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {step.preview}
          </p>
        )}

        {problem && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{problem}</p>
        )}
      </div>

      {/*
        One outgoing point per choice, labelled. A branch is then a line you
        can see leaving the button it belongs to.
      */}
      {options.length > 0 ? (
        <div className="border-t border-slate-100 dark:border-slate-800">
          {options.map((option) => (
            <div
              key={option.id}
              /*
                Each row positions its own dot. React Flow centres a handle
                inside whatever is positioned around it, so giving the row
                `relative` is the whole of the layout — an explicit offset on
                top of that pushed every dot after the first out of its row
                and made it impossible to grab.
              */
              className="relative flex items-center border-b border-slate-50 px-3 py-2 text-xs text-slate-600 last:border-0 dark:border-slate-800 dark:text-slate-400"
            >
              <span className="truncate">{option.label}</span>
              <Handle
                id={option.id}
                type="source"
                position={Position.Right}
                // Bigger than the default: this is the thing the operator has
                // to hit with a mouse, several times, to build a branch.
                className="!h-4 !w-4 !border-2 !border-white !bg-emerald-500 hover:!bg-emerald-400"
              />
            </div>
          ))}
        </div>
      ) : (
        step.type !== "END" &&
        step.type !== "HANDOFF" && (
          <Handle
            type="source"
            position={Position.Right}
            className="!h-4 !w-4 !border-2 !border-white !bg-emerald-500 hover:!bg-emerald-400"
          />
        )
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The canvas                                                                  */
/* -------------------------------------------------------------------------- */

function Canvas(props: CanvasProps) {
  const nodeTypes = useMemo(() => ({ step: StepBox }), []);

  const [validation, setValidation] = useState(props.initialValidation);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [isPending, startTransition] = useTransition();
  const [testPhone, setTestPhone] = useState("");
  const newStepCount = useRef(0);

  /** Problems keyed by step, so a box can show its own. */
  const problems = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of validation.errors) {
      if (error.stepId && !map.has(error.stepId)) map.set(error.stepId, error.message);
    }
    return map;
  }, [validation]);

  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(
    props.initialSteps.map((step) => ({
      id: step.id,
      type: "step",
      position: { x: step.x, y: step.y },
      data: { step },
    })),
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    props.initialLinks.map((link, i) => ({
      id: `e${i}`,
      source: link.fromStepId,
      target: link.toStepId,
      sourceHandle: link.optionId,
      animated: true,
    })),
  );

  // Problems are merged in rather than stored, so revalidating does not lose
  // whatever the operator has dragged since.
  const shownNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: { ...node.data, problem: problems.get(node.id) },
      })),
    [nodes, problems],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        // One line per choice. A second from the same point would make the
        // next step ambiguous, so it replaces rather than stacks.
        const cleaned = current.filter(
          (e) =>
            !(
              e.source === connection.source &&
              (e.sourceHandle ?? null) === (connection.sourceHandle ?? null)
            ),
        );

        return addEdge({ ...connection, animated: true }, cleaned);
      });
    },
    [setEdges],
  );

  function addStep(type: StepKind) {
    const meta = STEP_LIBRARY[type];

    // A counter rather than a clock: these ids only need to be unique within
    // this editing session, and the database issues the real ones on save.
    newStepCount.current += 1;
    const id = `new-${newStepCount.current}`;

    const step: StepModel = {
      id,
      type,
      name: meta.label,
      // Deep copy: a shallow spread would leave every new step of the same
      // kind sharing one options array with the template it came from.
      config: structuredClone(meta.defaultConfig),
      x: 260 + (nodes.length % 4) * 300,
      y: 80 + Math.floor(nodes.length / 4) * 220,
      preview: "",
    };

    setNodes((current) => [
      ...current,
      { id, type: "step", position: { x: step.x, y: step.y }, data: { step } },
    ]);

    setSelectedId(id);
  }

  function updateStep(id: string, patch: Partial<StepModel>) {
    setNodes((current) =>
      current.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, step: { ...node.data.step, ...patch } } }
          : node,
      ),
    );
  }

  function deleteStep(id: string) {
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveGraphAction({
        versionId: props.versionId,
        steps: nodes.map((node) => ({
          id: node.id,
          type: node.data.step.type,
          name: node.data.step.name,
          config: node.data.step.config,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        })),
        links: edges.map((edge) => ({
          fromStepId: edge.source,
          optionId: edge.sourceHandle ?? null,
          toStepId: edge.target,
        })),
      });

      setState({ error: result.error, success: result.success });
      if (result.validation) setValidation(result.validation);
    });
  }

  function publish() {
    startTransition(async () => {
      // Saved first: publishing what is on screen rather than what was last
      // written is what the button appears to promise.
      const formData = new FormData();
      formData.set("versionId", props.versionId);

      const result = await publishJourneyAction({}, formData);
      setState({ error: result.error, success: result.success });
      if (result.validation) setValidation(result.validation);
    });
  }

  function test() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("journeyId", props.journeyId);
      formData.set("phone", testPhone);

      const result = await testJourneyAction({}, formData);
      setState({ error: result.error, success: result.success });
    });
  }

  const selected = nodes.find((n) => n.id === selectedId)?.data.step ?? null;

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col">
      {/* ---------- Bar ---------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="font-medium text-slate-900 dark:text-slate-50">
          {props.journeyName}
        </span>

        {!props.isDraft && (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Live — editing makes a new version
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+91…"
            aria-label="Number to test with"
            className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={test}
            disabled={isPending || !testPhone.trim()}
          >
            Test on this number
          </Button>

          <Button variant="secondary" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" onClick={publish} disabled={isPending}>
            Publish
          </Button>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ---------- Library ---------- */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
          <p className="px-1 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Add a step
          </p>

          {Object.entries(STEP_LIBRARY)
            .filter(([type]) => type !== "START")
            .map(([type, meta]) => (
              <button
                key={type}
                type="button"
                onClick={() => addStep(type as StepKind)}
                className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span aria-hidden="true">{meta.icon}</span>
                {meta.label}
              </button>
            ))}
        </aside>

        {/* ---------- Canvas ---------- */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={shownNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* ---------- Settings ---------- */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {selected ? (
            <StepSettings
              step={selected}
              templates={props.templates}
              tags={props.tags}
              onChange={(patch) => updateStep(selected.id, patch)}
              onDelete={() => deleteStep(selected.id)}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Click a step to change it, or add one from the left.
              </p>

              {validation.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Fix before publishing
                  </p>
                  <ul className="mt-1 space-y-1">
                    {validation.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600 dark:text-red-400">
                        {e.stepName ? `${e.stepName}: ` : ""}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Worth knowing
                  </p>
                  <ul className="mt-1 space-y-1">
                    {validation.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-700 dark:text-amber-400">
                        {w.stepName ? `${w.stepName}: ` : ""}
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.ok && validation.warnings.length === 0 && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  No problems found.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function JourneyCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
