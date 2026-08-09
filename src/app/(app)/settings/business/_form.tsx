"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

import {
  saveBusinessProfile,
  uploadProfilePicture,
  type BusinessProfileState,
} from "./actions";

interface Initial {
  about: string;
  description: string;
  address: string;
  email: string;
  vertical: string;
  website1: string;
  website2: string;
  profilePictureUrl: string | null;
  displayName: string;
  phoneNumber: string;
}

/** Meta's fixed industry list. */
const VERTICALS = [
  ["", "Not set"],
  ["OTHER", "Other"],
  ["AUTO", "Automotive"],
  ["BEAUTY", "Beauty, spa and salon"],
  ["APPAREL", "Clothing and apparel"],
  ["EDU", "Education"],
  ["ENTERTAIN", "Entertainment"],
  ["EVENT_PLAN", "Event planning and service"],
  ["FINANCE", "Finance and banking"],
  ["GROCERY", "Food and grocery"],
  ["GOVT", "Public service"],
  ["HOTEL", "Hotel and lodging"],
  ["HEALTH", "Medical and health"],
  ["NONPROFIT", "Non-profit"],
  ["PROF_SERVICES", "Professional services"],
  ["RETAIL", "Shopping and retail"],
  ["TRAVEL", "Travel and transportation"],
  ["RESTAURANT", "Restaurant"],
] as const;

function CharacterCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={over ? "text-red-600 dark:text-red-400" : "text-slate-400"}>
      {value.length}/{max}
    </span>
  );
}

export function BusinessProfileForm({ initial }: { initial: Initial }) {
  const [state, setState] = useState<BusinessProfileState>({});
  const [pictureState, setPictureState] = useState<BusinessProfileState>({});
  const [isPending, startTransition] = useTransition();
  const [isUploading, startUpload] = useTransition();

  const [about, setAbout] = useState(initial.about);
  const [description, setDescription] = useState(initial.description);
  const [address, setAddress] = useState(initial.address);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Business profile
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          What customers see when they tap your name in WhatsApp.
        </p>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {/* Picture and display name sit together because that is how a
          customer sees them. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
          Picture and name
        </h3>

        <div className="flex flex-wrap items-start gap-5">
          <div className="text-center">
            {initial.profilePictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={initial.profilePictureUrl}
                alt="Current profile picture"
                className="h-24 w-24 rounded-full border border-slate-200 object-cover dark:border-slate-700"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-600">
                No picture
              </div>
            )}
          </div>

          <div className="min-w-56 flex-1 space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {initial.displayName || "No display name"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {initial.phoneNumber}
              </p>
              {/* Stated plainly: this one field cannot be changed here. */}
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                The display name can only be changed in WhatsApp Manager —
                WhatsApp requires a review, and there is no way to submit it
                from here.{" "}
                <a
                  href="https://business.facebook.com/latest/whatsapp_manager/phone_numbers"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline dark:text-emerald-400"
                >
                  Open WhatsApp Manager
                </a>
              </p>
            </div>

            <form
              action={(formData) => {
                startUpload(async () => {
                  setPictureState(await uploadProfilePicture({}, formData));
                });
              }}
              className="space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  name="picture"
                  accept="image/jpeg,image/png"
                  required
                  className="max-w-64 text-xs file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 dark:file:bg-slate-800"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={isUploading}
                >
                  {isUploading ? "Uploading…" : "Change picture"}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                Square JPG or PNG, at least 192×192, under 5 MB.
              </p>

              {pictureState.error && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {pictureState.error}
                </p>
              )}
              {pictureState.success && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {pictureState.success}
                </p>
              )}
            </form>
          </div>
        </div>
      </section>

      <form
        action={(formData) => {
          startTransition(async () => {
            setState(await saveBusinessProfile({}, formData));
          });
        }}
        className="space-y-5"
      >
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            About your business
          </h3>

          <Field
            label="Status line"
            htmlFor="about"
            hint="shown under your name"
            error={state.issues?.about}
          >
            <Input
              id="about"
              name="about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={139}
              placeholder="Real ingredients. No preservatives."
            />
            <p className="mt-1 text-xs">
              <CharacterCount value={about} max={139} />
            </p>
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={state.issues?.description}
          >
            <Textarea
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={512}
              placeholder="What Uncanned makes and who it is for."
            />
            <p className="mt-1 text-xs">
              <CharacterCount value={description} max={512} />
            </p>
          </Field>

          <Field label="Industry" htmlFor="vertical">
            <Select
              id="vertical"
              name="vertical"
              defaultValue={initial.vertical}
            >
              {VERTICALS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Links and contact
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              WhatsApp shows up to two links. Most businesses use their website
              and one social profile.
            </p>
          </div>

          <Field
            label="Website"
            htmlFor="website1"
            error={state.issues?.website1}
          >
            <Input
              id="website1"
              name="website1"
              type="url"
              defaultValue={initial.website1}
              placeholder="https://uncanned.in"
            />
          </Field>

          <Field
            label="Second link"
            htmlFor="website2"
            hint="Instagram, for example"
            error={state.issues?.website2}
          >
            <Input
              id="website2"
              name="website2"
              type="url"
              defaultValue={initial.website2}
              placeholder="https://instagram.com/uncanned"
            />
          </Field>

          <Field label="Email" htmlFor="email" error={state.issues?.email}>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={initial.email}
              placeholder="hello@uncanned.in"
            />
          </Field>

          <Field label="Address" htmlFor="address" error={state.issues?.address}>
            <Textarea
              id="address"
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              maxLength={256}
            />
            <p className="mt-1 text-xs">
              <CharacterCount value={address} max={256} />
            </p>
          </Field>
        </section>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}
