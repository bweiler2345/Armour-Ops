"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CameraIcon, PlusIcon, SpinnerIcon } from "@/components/Icons";
import {
  archiveReferencePicture,
  finishReferenceUpload,
  moveReferencePicture,
  startReferenceUpload,
  type ReferenceTarget,
} from "@/lib/actions/references";
import { checkFile } from "@/lib/media/files";
import { PrepareError, preparePhoto } from "@/lib/media/prepare";
import { sendGrant, UPLOAD_MESSAGES, UploadError } from "@/lib/media/upload";

export type ReferencePicture = { linkId: string; pictureId: string };

// Owner-supplied reference pictures: guidance only, never proof. Everyone who
// can open the step sees them; the owner can add, reorder, and remove them
// while they can still change (see the database rules).
export default function ReferencePictures({
  pictures,
  manage,
}: {
  pictures: ReferencePicture[];
  manage?: { target: ReferenceTarget; targetId: string; path: string };
}) {
  if (pictures.length === 0 && !manage) return null;
  return (
    <section aria-labelledby="reference-pictures" className="mt-6 rounded-3xl border border-sky-400/30 bg-sky-400/5 p-4">
      <h2 id="reference-pictures" className="flex items-center gap-2 text-lg font-semibold text-white">
        <CameraIcon className="h-5 w-5 text-sky-200" /> Reference pictures
      </h2>
      <p className="mt-1 text-sm text-sky-100/80">Guidance from the owner. These are not proof and don’t count toward it.</p>
      {pictures.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {pictures.map((p, i) => (
            <li key={p.linkId} className="flex flex-col gap-2">
              <a href={`/reference/${p.pictureId}`} target="_blank" rel="noreferrer" aria-label={`Reference picture ${i + 1}`}>
                {/* Private, short-lived links; Next's image optimizer isn't used. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/reference/${p.pictureId}`}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-2xl bg-charcoal-800 object-cover"
                />
              </a>
              {manage && <PictureControls picture={p} first={i === 0} last={i === pictures.length - 1} path={manage.path} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] text-charcoal-300">No reference pictures yet.</p>
      )}
      {manage && <AddReferencePicture {...manage} />}
    </section>
  );
}

const small =
  "flex min-h-12 flex-1 items-center justify-center rounded-xl border border-charcoal-600 bg-charcoal-900 text-sm font-semibold text-white disabled:opacity-40";

function PictureControls({ picture, first, last, path }: { picture: ReferencePicture; first: boolean; last: boolean; path: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await task().catch(() => ({ ok: false, error: UPLOAD_MESSAGES.offline }));
    setBusy(false);
    if (!result.ok) setError(result.error ?? UPLOAD_MESSAGES.offline);
    else setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <button type="button" className={small} disabled={busy || first} onClick={() => run(() => moveReferencePicture(picture.linkId, -1, path))} aria-label="Move earlier">
          ↑
        </button>
        <button type="button" className={small} disabled={busy || last} onClick={() => run(() => moveReferencePicture(picture.linkId, 1, path))} aria-label="Move later">
          ↓
        </button>
        <button type="button" className={small} disabled={busy} onClick={() => setConfirming(true)}>
          Remove
        </button>
      </div>
      {error && <p className="text-sm text-red-200">{error}</p>}
      {confirming && (
        <Dialog title="Remove this reference picture?" onClose={() => setConfirming(false)} locked={busy}>
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            It stops showing here. Jobs that already have it keep their copy, and nothing is deleted from history.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 font-semibold text-white">
              Keep
            </button>
            <button
              type="button"
              onClick={() => run(() => archiveReferencePicture(picture.linkId, path))}
              disabled={busy}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-red-500/90 font-semibold text-white disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="h-5 w-5" />}
              Remove
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AddReferencePicture({ target, targetId, path }: { target: ReferenceTarget; targetId: string; path: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function add(file: File | undefined) {
    if (!file || busy.current) return;
    setError(null);
    const check = checkFile(file, "picture");
    if (!check.ok) return setError(check.error);
    busy.current = true;
    try {
      setStatus("Preparing picture…");
      const jpeg = await preparePhoto(file);
      setStatus("Uploading 0%");
      const start = await startReferenceUpload({ size: jpeg.size, fileName: file.name });
      if (!start.ok) throw new Error(start.error);
      await sendGrant({ method: "single", mediaId: start.value.pictureId, url: start.value.url, contentType: "image/jpeg" }, jpeg, {
        signal: new AbortController().signal,
        onProgress: (p) => setStatus(`Uploading ${Math.floor(p * 100)}%`),
      });
      setStatus("Checking upload…");
      const done = await finishReferenceUpload({ pictureId: start.value.pictureId, target, targetId, path });
      if (!done.ok) throw new Error(done.error);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof PrepareError
          ? err.message
          : err instanceof UploadError
            ? err.kind === "canceled"
              ? "Canceled."
              : UPLOAD_MESSAGES[err.kind]
            : err instanceof Error && err.message
              ? err.message
              : UPLOAD_MESSAGES.offline,
      );
    } finally {
      busy.current = false;
      setStatus(null);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {error && (
        <p role="alert" className="flex items-start gap-2 text-[15px] text-red-200">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" /> {error}
        </p>
      )}
      {status ? (
        <p role="status" className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-charcoal-800 font-semibold text-gold-300">
          <SpinnerIcon className="h-5 w-5" /> {status}
        </p>
      ) : (
        <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-sky-400/50 bg-charcoal-800 text-lg font-semibold text-sky-100 active:scale-[0.98]">
          <PlusIcon className="h-6 w-6" /> Add Reference Picture
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
