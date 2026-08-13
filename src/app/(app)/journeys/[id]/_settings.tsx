"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/types";

import {
  optionIdFrom,
  optionsOf,
  STEP_LIBRARY,
  type StepModel,
  type StepOptionModel,
} from "./_steps";

/**
 * Settings for the selected step.
 *
 * Every field is worded for somebody who has never seen an API. The character
 * limits and the three-button cap are surfaced while they are typing, because
 * finding out at send time means a customer already saw the failure.
 */

export function StepSettings({
  step,
  templates,
  tags,
  onChange,
  onDelete,
}: {
  step: StepModel;
  templates: Array<{ id: string; name: string; category: string }>;
  tags: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<StepModel>) => void;
  onDelete: () => void;
}) {
  const meta = STEP_LIBRARY[step.type];
  const options = optionsOf(step);

  function setConfig(patch: Record<string, unknown>) {
    onChange({ config: { ...step.config, ...patch } });
  }

  function setOptions(next: StepOptionModel[]) {
    setConfig({ options: next });
  }

  const asButtons = options.length <= INTERACTIVE_LIMITS.MAX_BUTTONS;
  const labelCap = asButtons
    ? INTERACTIVE_LIMITS.MAX_BUTTON_LABEL
    : INTERACTIVE_LIMITS.MAX_LIST_ROW_TITLE;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{meta.icon}</span>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {meta.label}
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meta.hint}</p>
      </div>

      {step.type !== "START" && (
        <Field label="Name this step" htmlFor="stepName" hint="Only you see this.">
          <Input
            id="stepName"
            value={step.name}
            onChange={(e) => onChange({ name: e.target.value })}
            maxLength={60}
          />
        </Field>
      )}

      {/* ---------- Message ---------- */}

      {step.type === "SEND_MESSAGE" && (
        <>
          <Field
            label="What to say"
            htmlFor="body"
            hint="Use {{first_name}} to include their name."
          >
            <Textarea
              id="body"
              rows={4}
              value={String(step.config.body ?? "")}
              onChange={(e) => {
                setConfig({ body: e.target.value });
                onChange({ preview: e.target.value.slice(0, 90) });
              }}
              maxLength={INTERACTIVE_LIMITS.MAX_BODY}
            />
          </Field>

          <OptionEditor
            options={options}
            labelCap={labelCap}
            asButtons={asButtons}
            onChange={setOptions}
          />

          {!asButtons && (
            <Field
              label="Menu button"
              htmlFor="menuLabel"
              hint="The button that opens the list of options."
            >
              <Input
                id="menuLabel"
                value={String(step.config.menuLabel ?? "")}
                onChange={(e) => setConfig({ menuLabel: e.target.value })}
                maxLength={INTERACTIVE_LIMITS.MAX_LIST_BUTTON_LABEL}
              />
            </Field>
          )}
        </>
      )}

      {/* ---------- Template ---------- */}

      {step.type === "SEND_TEMPLATE" && (
        <>
          <Field label="Which template" htmlFor="templateId">
            <Select
              id="templateId"
              value={String(step.config.templateId ?? "")}
              onChange={(e) => {
                const chosen = templates.find((t) => t.id === e.target.value);
                setConfig({ templateId: e.target.value });
                if (chosen) onChange({ preview: chosen.name });
              }}
            >
              <option value="">Choose an approved template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category.toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              If this template has buttons, list them here exactly as they were
              approved — WhatsApp does not tell us which one was tapped, only
              its wording.
            </p>
            <OptionEditor
              options={options}
              labelCap={INTERACTIVE_LIMITS.MAX_TEMPLATE_BUTTON_LABEL}
              asButtons
              matchByText
              onChange={setOptions}
            />
          </div>
        </>
      )}

      {/* ---------- Question ---------- */}

      {step.type === "ASK_QUESTION" && (
        <>
          <Field label="What to ask" htmlFor="qbody">
            <Textarea
              id="qbody"
              rows={3}
              value={String(step.config.body ?? "")}
              onChange={(e) => {
                setConfig({ body: e.target.value });
                onChange({ preview: e.target.value.slice(0, 90) });
              }}
            />
          </Field>

          <Field
            label="Save the answer as"
            htmlFor="saveAs"
            hint="Use it later with {{ }} around this name."
          >
            <Input
              id="saveAs"
              value={String(step.config.saveAs ?? "")}
              onChange={(e) => setConfig({ saveAs: e.target.value })}
              placeholder="address"
            />
          </Field>

          <Field
            label="Also save it on the contact"
            htmlFor="saveToContactField"
            hint="Leave blank to keep it only for this conversation."
          >
            <Input
              id="saveToContactField"
              value={String(step.config.saveToContactField ?? "")}
              onChange={(e) => setConfig({ saveToContactField: e.target.value })}
              placeholder="address"
              list="contact-field-suggestions"
            />
            {/* Suggestions rather than a fixed list: any name works, and the
                two that are real columns are simply the common ones. */}
            <datalist id="contact-field-suggestions">
              <option value="name" />
              <option value="email" />
              <option value="address" />
              <option value="pincode" />
              <option value="flavour" />
            </datalist>
          </Field>
        </>
      )}

      {/* ---------- Media ---------- */}

      {step.type === "SEND_MEDIA" && (
        <>
          <Field label="What kind of file" htmlFor="mediaType">
            <Select
              id="mediaType"
              value={String(step.config.type ?? "image")}
              onChange={(e) => setConfig({ type: e.target.value })}
            >
              <option value="image">Image</option>
              <option value="document">PDF or document</option>
              <option value="video">Video</option>
            </Select>
          </Field>

          <Field
            label="Web address of the file"
            htmlFor="link"
            hint="It must be publicly reachable — WhatsApp fetches it."
          >
            <Input
              id="link"
              value={String(step.config.link ?? "")}
              onChange={(e) => setConfig({ link: e.target.value })}
              placeholder="https://uncanned.in/lab-report.pdf"
            />
          </Field>

          <Field label="Caption" htmlFor="caption">
            <Input
              id="caption"
              value={String(step.config.caption ?? "")}
              onChange={(e) => setConfig({ caption: e.target.value })}
            />
          </Field>
        </>
      )}

      {/* ---------- Tags ---------- */}

      {(step.type === "ADD_TAG" || step.type === "REMOVE_TAG") && (
        <Field label="Which tag" htmlFor="tagId">
          <Select
            id="tagId"
            value={String(step.config.tagId ?? "")}
            onChange={(e) => {
              const chosen = tags.find((t) => t.id === e.target.value);
              setConfig({ tagId: e.target.value });
              if (chosen) onChange({ preview: chosen.name });
            }}
          >
            <option value="">Choose a tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {/* ---------- Condition ---------- */}

      {step.type === "CONDITION" && (
        <>
          <Field label="Check what" htmlFor="subject">
            <Select
              id="subject"
              value={String(step.config.subject ?? "tag")}
              onChange={(e) => setConfig({ subject: e.target.value })}
            >
              <option value="tag">Whether they have a tag</option>
              <option value="answer">An answer they gave earlier</option>
              <option value="contact_field">Something on their record</option>
            </Select>
          </Field>

          {step.config.subject === "tag" ? (
            <Field label="Which tag" htmlFor="condTag">
              <Select
                id="condTag"
                value={String(step.config.key ?? "")}
                onChange={(e) => setConfig({ key: e.target.value })}
              >
                <option value="">Choose a tag…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Which one" htmlFor="condKey">
              <Input
                id="condKey"
                value={String(step.config.key ?? "")}
                onChange={(e) => setConfig({ key: e.target.value })}
                placeholder="flavour"
              />
            </Field>
          )}

          <Field label="Test" htmlFor="operator">
            <Select
              id="operator"
              value={String(step.config.operator ?? "exists")}
              onChange={(e) => setConfig({ operator: e.target.value })}
            >
              <option value="exists">They have it</option>
              <option value="not_exists">They do not have it</option>
              <option value="is">It is exactly…</option>
              <option value="is_not">It is not…</option>
              <option value="contains">It contains…</option>
            </Select>
          </Field>

          {["is", "is_not", "contains"].includes(
            String(step.config.operator ?? ""),
          ) && (
            <Field label="Compared with" htmlFor="condValue">
              <Input
                id="condValue"
                value={String(step.config.value ?? "")}
                onChange={(e) => setConfig({ value: e.target.value })}
              />
            </Field>
          )}
        </>
      )}

      {/* ---------- Wait ---------- */}

      {step.type === "WAIT" && (
        <Field
          label="Wait for"
          htmlFor="minutes"
          hint="After 24 hours only a template can be sent."
        >
          <Select
            id="minutes"
            value={String(step.config.minutes ?? 60)}
            onChange={(e) => {
              setConfig({ minutes: Number(e.target.value) });
              const label =
                e.target.selectedOptions[0]?.text ?? `${e.target.value} minutes`;
              onChange({ preview: label });
            }}
          >
            <option value="10">10 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="360">6 hours</option>
            <option value="1440">1 day</option>
            <option value="4320">3 days</option>
          </Select>
        </Field>
      )}

      {/* ---------- Contact ---------- */}

      {step.type === "UPDATE_CONTACT" && (
        <>
          <Field
            label="Which detail"
            htmlFor="field"
            hint="Anything you like — it is saved on the contact under this name."
          >
            <Input
              id="field"
              value={String(step.config.field ?? "")}
              onChange={(e) => setConfig({ field: e.target.value })}
              placeholder="address"
              list="contact-field-suggestions-update"
            />
            <datalist id="contact-field-suggestions-update">
              <option value="name" />
              <option value="email" />
              <option value="address" />
              <option value="pincode" />
              <option value="flavour" />
            </datalist>
          </Field>

          <Field
            label="Set it to"
            htmlFor="value"
            hint="Use {{ }} to insert an earlier answer."
          >
            <Input
              id="value"
              value={String(step.config.value ?? "")}
              onChange={(e) => setConfig({ value: e.target.value })}
              placeholder="{{address}}"
            />
          </Field>
        </>
      )}

      {/* ---------- Webhook ---------- */}

      {step.type === "WEBHOOK" && (
        <Field
          label="Web address"
          htmlFor="url"
          hint="Must start with https://. The contact's details are sent to it."
        >
          <Input
            id="url"
            value={String(step.config.url ?? "")}
            onChange={(e) => setConfig({ url: e.target.value })}
            placeholder="https://example.com/order"
          />
        </Field>
      )}

      {/* ---------- Handoff ---------- */}

      {step.type === "HANDOFF" && (
        <Field
          label="Note for whoever picks it up"
          htmlFor="note"
          hint="Shown in the Inbox."
        >
          <Input
            id="note"
            value={String(step.config.note ?? "")}
            onChange={(e) => setConfig({ note: e.target.value })}
            placeholder="Asked about a damaged delivery"
          />
        </Field>
      )}

      {step.type !== "START" && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onDelete}>
            Delete this step
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

function OptionEditor({
  options,
  labelCap,
  asButtons,
  matchByText,
  onChange,
}: {
  options: StepOptionModel[];
  labelCap: number;
  asButtons: boolean;
  /** True for template buttons, where WhatsApp sends back only the wording. */
  matchByText?: boolean;
  onChange: (next: StepOptionModel[]) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Options
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([
              ...options,
              { id: `option_${options.length + 1}`, label: "" },
            ])
          }
        >
          Add
        </Button>
      </div>

      {/*
        Said at the moment it becomes true rather than at send time. Crossing
        three changes what the customer sees, and that is worth knowing while
        you are still typing.
      */}
      {!asButtons && (
        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          With more than {INTERACTIVE_LIMITS.MAX_BUTTONS} options, these show as
          a menu the customer opens rather than buttons in the chat.
        </p>
      )}

      <div className="mt-2 space-y-2">
        {options.map((option, index) => (
          <div key={index} className="flex gap-1">
            <Input
              value={option.label}
              onChange={(e) => {
                const label = e.target.value;

                onChange(
                  options.map((o, i) =>
                    i === index
                      ? {
                          ...o,
                          label,
                          // A template button is matched on its wording, so
                          // the id must equal it. Elsewhere the id is fixed
                          // once set, so rewording cannot break the branch.
                          id: matchByText
                            ? label
                            : o.id.startsWith("option_") || !o.id
                              ? optionIdFrom(label)
                              : o.id,
                        }
                      : o,
                  ),
                );
              }}
              maxLength={labelCap}
              placeholder={`Option ${index + 1}`}
              aria-label={`Option ${index + 1}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(options.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      {options.length > 0 && (
        <p className="mt-1 text-xs text-slate-400">
          Up to {labelCap} characters each. Drag from each option on the box to
          set what happens next.
        </p>
      )}
    </div>
  );
}
