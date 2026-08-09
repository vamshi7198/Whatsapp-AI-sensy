"use client";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { BUTTON_LIMITS, type TemplateButton } from "@/lib/templates/builder";

/**
 * Editor for template buttons.
 *
 * Meta's grouping rule — quick replies and action buttons must each be
 * contiguous — is enforced by keeping the list ordered and warning inline,
 * rather than letting the user discover it in a rejection.
 */
export function ButtonEditor({
  buttons,
  onChange,
  issues,
}: {
  buttons: TemplateButton[];
  onChange: (buttons: TemplateButton[]) => void;
  issues?: Record<string, string>;
}) {
  const urlCount = buttons.filter((b) => b.type === "URL").length;
  const phoneCount = buttons.filter((b) => b.type === "PHONE_NUMBER").length;

  function add(type: TemplateButton["type"]) {
    const next: TemplateButton =
      type === "URL"
        ? { type: "URL", text: "", url: "" }
        : type === "PHONE_NUMBER"
          ? { type: "PHONE_NUMBER", text: "", phoneNumber: "" }
          : { type: "QUICK_REPLY", text: "" };

    onChange([...buttons, next]);
  }

  function update(index: number, patch: Partial<TemplateButton>) {
    onChange(
      buttons.map((b, i) =>
        i === index ? ({ ...b, ...patch } as TemplateButton) : b,
      ),
    );
  }

  function remove(index: number) {
    onChange(buttons.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= buttons.length) return;

    const next = [...buttons];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Buttons
          <span className="ml-1.5 font-normal text-slate-400">optional</span>
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Give people something to tap. Quick replies send you a response;
          website and call buttons open a link or dial your number.
        </p>
      </div>

      {issues?.buttons && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {issues.buttons}
        </p>
      )}

      {buttons.map((button, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">#{index + 1}</span>

            <Select
              value={button.type}
              onChange={(e) => {
                const type = e.target.value as TemplateButton["type"];
                onChange(
                  buttons.map((b, i) =>
                    i === index
                      ? type === "URL"
                        ? { type: "URL", text: b.text, url: "" }
                        : type === "PHONE_NUMBER"
                          ? { type: "PHONE_NUMBER", text: b.text, phoneNumber: "" }
                          : { type: "QUICK_REPLY", text: b.text }
                      : b,
                  ),
                );
              }}
              aria-label={`Type of button ${index + 1}`}
              className="w-auto text-xs"
            >
              <option value="QUICK_REPLY">Quick reply</option>
              <option value="URL">Open a website</option>
              <option value="PHONE_NUMBER">Call a number</option>
            </Select>

            <Input
              value={button.text}
              onChange={(e) => update(index, { text: e.target.value })}
              placeholder="Button label"
              maxLength={BUTTON_LIMITS.TEXT_LENGTH}
              aria-label={`Label for button ${index + 1}`}
              className="max-w-44 text-xs"
            />

            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => move(index, 1)}
                disabled={index === buttons.length - 1}
                aria-label="Move down"
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 dark:text-red-400"
                onClick={() => remove(index)}
                aria-label="Remove button"
              >
                Remove
              </Button>
            </div>
          </div>

          {button.type === "URL" && (
            <Input
              value={button.url}
              onChange={(e) => update(index, { url: e.target.value })}
              placeholder="https://uncanned.in/track"
              aria-label={`Web address for button ${index + 1}`}
              className="text-xs"
            />
          )}

          {button.type === "PHONE_NUMBER" && (
            <Input
              value={button.phoneNumber}
              onChange={(e) => update(index, { phoneNumber: e.target.value })}
              placeholder="+91 96329 29141"
              aria-label={`Phone number for button ${index + 1}`}
              className="text-xs"
            />
          )}

          {(issues?.[`button_${index}_text`] ||
            issues?.[`button_${index}_url`] ||
            issues?.[`button_${index}_phone`]) && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {issues[`button_${index}_text`] ??
                issues[`button_${index}_url`] ??
                issues[`button_${index}_phone`]}
            </p>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => add("QUICK_REPLY")}
          disabled={buttons.length >= BUTTON_LIMITS.TOTAL}
        >
          + Quick reply
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => add("URL")}
          disabled={
            buttons.length >= BUTTON_LIMITS.TOTAL ||
            urlCount >= BUTTON_LIMITS.URL
          }
          title={
            urlCount >= BUTTON_LIMITS.URL
              ? `WhatsApp allows ${BUTTON_LIMITS.URL} website buttons`
              : undefined
          }
        >
          + Website link
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => add("PHONE_NUMBER")}
          disabled={
            buttons.length >= BUTTON_LIMITS.TOTAL ||
            phoneCount >= BUTTON_LIMITS.PHONE_NUMBER
          }
          title={
            phoneCount >= BUTTON_LIMITS.PHONE_NUMBER
              ? "WhatsApp allows one call button"
              : undefined
          }
        >
          + Call button
        </Button>
      </div>

      {buttons.length > 0 && (
        <p className="text-xs text-slate-400">
          {buttons.length} of {BUTTON_LIMITS.TOTAL} used. Keep quick replies
          together and link or call buttons together — WhatsApp does not allow
          them to alternate.
        </p>
      )}
    </section>
  );
}
