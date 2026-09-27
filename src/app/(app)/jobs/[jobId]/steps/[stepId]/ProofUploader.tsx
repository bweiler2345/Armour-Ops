"use client";

import { useEffect, useReducer, useRef, useState, type RefObject } from "react";
import Dialog from "@/components/Dialog";
import { AlertIcon, CameraIcon, CheckIcon, PlusIcon, SpinnerIcon, VideoIcon } from "@/components/Icons";
import { finishMediaUpload, removeMedia, resumeMediaUpload, startMediaUpload } from "@/lib/actions/media";
import { checkFile, formatBytes, formatDuration } from "@/lib/media/files";
import { PrepareError, preparePhoto, readVideoDuration } from "@/lib/media/prepare";
import type { StepMediaItem, UploadGrant } from "@/lib/media/types";
import { sendGrant, UPLOAD_MESSAGES, UploadError } from "@/lib/media/upload";
import {
  canAddMore,
  filesInUse,
  isActive,
  percent,
  proofRows,
  sameVideo,
  uploadsReducer,
  type LocalUpload,
  type ProofRow,
} from "@/lib/media/upload-state";
import type { LeaseRefusal } from "@/lib/steps/lease";
import type { ProofNeed } from "@/lib/steps/validation";

const NEED_LEASE = "Tap “Edit this step” first, then try again.";

// Picture and video proof for one step. Files go straight from the phone to
// private storage; the server approves each upload first and checks the
// stored file before it counts. Upload problems never touch the checklist,
// entries, or notes.
export default function ProofUploader({
  jobId,
  stepId,
  userId,
  proofs,
  media,
  editable,
  lease,
  onLeaseRefused,
  refresh,
  onBusyChange,
}: {
  jobId: string;
  stepId: string;
  userId: string;
  proofs: ProofNeed[];
  media: StepMediaItem[];
  editable: boolean;
  lease: RefObject<string | null>;
  onLeaseRefused: (reason: LeaseRefusal) => void;
  refresh: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [uploads, dispatch] = useReducer(uploadsReducer, []);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<StepMediaItem | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const canceled = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextKey = useRef(0);
  const previews = useRef(new Set<string>());

  const busy = uploads.some(isActive);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // Warn before leaving while a file is still uploading.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Stop uploads and free previews when leaving the screen.
  useEffect(() => {
    const running = controllers.current;
    const urls = previews.current;
    return () => {
      for (const c of running.values()) c.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  if (proofs.length === 0) return null;

  const update = (key: string, changes: Partial<LocalUpload>) => dispatch({ type: "update", key, changes });
  const failUpload = (key: string, error: string, keepFile = true) =>
    update(key, { phase: "failed", error, ...(keepFile ? {} : { file: null }) });

  const leaseProblem = (result: { lease?: LeaseRefusal }) => {
    if (result.lease) onLeaseRefused(result.lease);
  };

  // Prepares (if needed), gets approval or fresh links, sends the file, and
  // has the server verify it. Retry calls this again with what is kept.
  async function run(start: LocalUpload, source: File | null) {
    const { key } = start;
    const stopped = () => canceled.current.has(key);
    let file = start.file;
    let mediaId = start.mediaId;
    let duration = start.durationSeconds;
    update(key, { phase: "preparing", error: null, progress: 0 });

    try {
      if (!file && source) {
        if (start.mediaType === "picture") {
          file = await preparePhoto(source);
          const previewUrl = URL.createObjectURL(file);
          previews.current.add(previewUrl);
          update(key, { file, previewUrl });
        } else {
          duration = await readVideoDuration(source);
          file = source;
          update(key, { file, durationSeconds: duration });
        }
      }
    } catch (error) {
      failUpload(key, error instanceof PrepareError ? error.message : "Couldn’t prepare that file. Try again.", false);
      return;
    }
    if (!file || stopped()) return;

    for (let fresh = 0; ; fresh++) {
      const current = lease.current;
      if (!current) return failUpload(key, NEED_LEASE);

      const approval = mediaId
        ? await resumeMediaUpload({
            mediaId,
            lease: current,
            size: file.size,
            fileName: start.fileName,
            lastModified: start.lastModified,
          }).catch(() => null)
        : await startMediaUpload({
            stepId,
            lease: current,
            requirementId: start.requirementId,
            mediaType: start.mediaType,
            contentType: start.contentType,
            size: file.size,
            originalSize: start.originalSize,
            durationSeconds: duration === null ? null : Math.round(duration * 100) / 100,
            fileName: start.fileName,
            lastModified: start.lastModified,
          }).catch(() => null);
      if (!approval) return failUpload(key, UPLOAD_MESSAGES.offline);
      if (!approval.ok) {
        leaseProblem(approval);
        return failUpload(key, approval.error, approval.reason !== "mismatch" || Boolean(mediaId));
      }
      const grant: UploadGrant = approval.value;
      mediaId = grant.mediaId;
      update(key, { mediaId, phase: "uploading" });
      if (stopped()) {
        void removeMedia({ jobId, stepId, mediaId, lease: current });
        return;
      }

      const controller = new AbortController();
      controllers.current.set(key, controller);
      try {
        await sendGrant(grant, file, {
          signal: controller.signal,
          onProgress: (progress) => dispatch({ type: "progress", key, progress }),
        });
        break;
      } catch (error) {
        const kind = error instanceof UploadError ? error.kind : "rejected";
        if (kind === "canceled") return;
        // Links expire; get fresh ones once and continue where it stopped.
        if (kind === "expired" && fresh === 0) continue;
        return failUpload(key, UPLOAD_MESSAGES[kind]);
      } finally {
        controllers.current.delete(key);
      }
    }

    update(key, { phase: "finishing", progress: 1 });
    const current = lease.current;
    if (!current || !mediaId) return failUpload(key, NEED_LEASE);
    const finished = await finishMediaUpload({ jobId, stepId, mediaId, lease: current }).catch(() => null);
    if (!finished) return failUpload(key, UPLOAD_MESSAGES.offline);
    if (!finished.ok) {
      leaseProblem(finished);
      // A mismatched file was rejected for good; it can only be removed.
      return failUpload(key, finished.error, finished.reason !== "mismatch");
    }
    await refresh();
    dispatch({ type: "remove", key });
  }

  function enqueue(upload: LocalUpload, source: File | null) {
    queue.current = queue.current.then(() => (canceled.current.has(upload.key) ? undefined : run(upload, source)));
  }

  function newUpload(proof: ProofNeed, file: File, contentType: string, mediaId: string | null = null): LocalUpload {
    return {
      contentType,
      key: `u${++nextKey.current}`,
      requirementId: proof.id,
      mediaType: proof.mediaType,
      mediaId,
      phase: "waiting",
      progress: 0,
      error: null,
      file: null,
      fileName: file.name.slice(0, 255),
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
      originalSize: file.size,
      durationSeconds: null,
      previewUrl: null,
    };
  }

  function choose(proof: ProofNeed, list: FileList | null, rows: ProofRow[]) {
    setNotices((n) => ({ ...n, [proof.id]: "" }));
    if (!list || list.length === 0) return;
    if (!lease.current) {
      setNotices((n) => ({ ...n, [proof.id]: NEED_LEASE }));
      return;
    }
    const room = proof.allowMultiple ? 20 - filesInUse(rows) : 1;
    const files = Array.from(list).slice(0, Math.max(0, room));
    const problems: string[] = [];
    for (const file of files) {
      const check = checkFile(file, proof.mediaType);
      if (!check.ok) {
        problems.push(list.length > 1 ? `${file.name}: ${check.error}` : check.error);
        continue;
      }
      const upload = newUpload(proof, file, check.contentType);
      dispatch({ type: "add", upload });
      enqueue(upload, file);
    }
    if (list.length > files.length) problems.push("This proof can have up to 20 files.");
    if (problems.length > 0) setNotices((n) => ({ ...n, [proof.id]: problems.join(" ") }));
  }

  // After a reload: the employee chooses the same video to continue.
  function resumeWith(proof: ProofNeed, saved: StepMediaItem, list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (!lease.current) {
      setNotices((n) => ({ ...n, [proof.id]: NEED_LEASE }));
      return;
    }
    if (!sameVideo(saved, file)) {
      setNotices((n) => ({
        ...n,
        [proof.id]: "That’s a different video. Choose the same video to continue, or remove the unfinished upload.",
      }));
      return;
    }
    setNotices((n) => ({ ...n, [proof.id]: "" }));
    const check = checkFile(file, "video");
    if (!check.ok) return;
    const upload = { ...newUpload(proof, file, check.contentType, saved.id), file, durationSeconds: saved.durationSeconds };
    dispatch({ type: "add", upload });
    enqueue(upload, null);
  }

  function retry(upload: LocalUpload) {
    canceled.current.delete(upload.key);
    update(upload.key, { phase: "waiting", error: null });
    enqueue(upload, null);
  }

  // Cancels an unfinished upload on this screen. No confirmation: it never
  // counted as proof.
  async function cancel(upload: LocalUpload) {
    canceled.current.add(upload.key);
    controllers.current.get(upload.key)?.abort();
    dispatch({ type: "remove", key: upload.key });
    if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
    if (upload.mediaId && lease.current) {
      await removeMedia({ jobId, stepId, mediaId: upload.mediaId, lease: lease.current }).catch(() => null);
      await refresh();
    }
  }

  async function remove(item: StepMediaItem) {
    const current = lease.current;
    if (!current) {
      setRemoveError(NEED_LEASE);
      return false;
    }
    setRemoving(item.id);
    setRemoveError(null);
    const result = await removeMedia({ jobId, stepId, mediaId: item.id, lease: current }).catch(() => null);
    setRemoving(null);
    if (!result || !result.ok) {
      if (result) leaseProblem(result);
      setRemoveError(result?.error ?? UPLOAD_MESSAGES.offline);
      return false;
    }
    await refresh();
    return true;
  }

  return (
    <section aria-labelledby="proof" className="flex flex-col gap-4">
      <h2 id="proof" className="text-lg font-semibold text-white">
        Required proof
      </h2>

      {proofs.map((proof) => {
        const rows = proofRows(proof.id, media, uploads, userId);
        const uploaded = rows.filter((r) => r.kind === "uploaded").length;
        const satisfied = uploaded >= proof.minCount;
        const isVideo = proof.mediaType === "video";
        const Icon = isVideo ? VideoIcon : CameraIcon;
        const canAdd = editable && canAddMore(rows, proof.allowMultiple);
        const inputId = `add-${proof.id}`;

        return (
          <div
            key={proof.id}
            className={`rounded-3xl border p-4 ${satisfied ? "border-emerald-400/30 bg-emerald-400/5" : "border-gold-500/40 bg-charcoal-900"}`}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[16px] leading-snug font-semibold text-white">{proof.label}</p>
                <p className="mt-1 text-sm text-charcoal-300">
                  {isVideo
                    ? "One video, MOV or MP4, up to 3 minutes and 300 MB."
                    : proof.allowMultiple
                      ? `${proof.minCount === 1 ? "At least 1 picture" : `At least ${proof.minCount} pictures`}. Add as many as you need (up to 20).`
                      : "One picture."}
                </p>
              </div>
              {satisfied && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  <CheckIcon className="h-3.5 w-3.5" /> Done
                </span>
              )}
            </div>

            {rows.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2">
                {rows.map((row) => (
                  <ProofRowView
                    key={row.kind === "local" ? row.upload.key : row.media.id}
                    row={row}
                    editable={editable}
                    removing={removing}
                    onRetry={retry}
                    onCancel={(u) => void cancel(u)}
                    onRemoveUploaded={(m) => {
                      setRemoveError(null);
                      setConfirmRemove(m);
                    }}
                    onDiscard={(m) => void remove(m)}
                    onResume={(m, files) => resumeWith(proof, m, files)}
                  />
                ))}
              </ul>
            )}

            {notices[proof.id] && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-[15px] text-red-200">
                <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
                {notices[proof.id]}
              </p>
            )}

            {canAdd && (
              <label
                htmlFor={inputId}
                className="mt-4 flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gold-500/60 bg-charcoal-800 text-lg font-semibold text-gold-200 active:scale-[0.98]"
              >
                {rows.length === 0 ? <Icon className="h-6 w-6" /> : <PlusIcon className="h-6 w-6" />}
                {isVideo ? "Add Video" : rows.length === 0 ? "Add Picture" : "Add Another Picture"}
                <input
                  id={inputId}
                  type="file"
                  className="sr-only"
                  // "image/*" and "video/*" let phones offer the camera and
                  // the library; the file is checked after it is chosen.
                  accept={isVideo ? "video/*" : "image/*"}
                  multiple={!isVideo && proof.allowMultiple}
                  onChange={(e) => {
                    choose(proof, e.target.files, rows);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        );
      })}

      {removeError && !confirmRemove && !removing && (
        <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-[15px] text-red-100">
          {removeError}
        </p>
      )}

      {confirmRemove && (
        <Dialog
          title={`Remove this ${confirmRemove.mediaType === "video" ? "video" : "picture"}?`}
          onClose={() => setConfirmRemove(null)}
          locked={removing !== null}
        >
          <p className="text-[15px] leading-relaxed text-charcoal-300">
            It won’t count as proof for this step anymore. The removal is recorded in the job’s history.
          </p>
          {removeError && (
            <p role="alert" className="mt-3 text-[15px] text-red-200">
              {removeError}
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setConfirmRemove(null)}
              disabled={removing !== null}
              className="flex min-h-14 items-center justify-center rounded-2xl border border-charcoal-600 bg-charcoal-800 text-base font-semibold text-white disabled:opacity-50"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await remove(confirmRemove)) setConfirmRemove(null);
              }}
              disabled={removing !== null}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-red-500/90 text-base font-semibold text-white disabled:opacity-50"
            >
              {removing ? <SpinnerIcon className="h-5 w-5" /> : null}
              {removing ? "Removing…" : "Remove"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

const smallButton =
  "flex min-h-12 items-center justify-center rounded-xl px-4 text-[15px] font-semibold active:scale-[0.98] disabled:opacity-50";

function ProofRowView({
  row,
  editable,
  removing,
  onRetry,
  onCancel,
  onRemoveUploaded,
  onDiscard,
  onResume,
}: {
  row: ProofRow;
  editable: boolean;
  removing: string | null;
  onRetry: (upload: LocalUpload) => void;
  onCancel: (upload: LocalUpload) => void;
  onRemoveUploaded: (media: StepMediaItem) => void;
  onDiscard: (media: StepMediaItem) => void;
  onResume: (media: StepMediaItem, files: FileList | null) => void;
}) {
  if (row.kind === "local") {
    const { upload } = row;
    const failed = upload.phase === "failed";
    const size = upload.file?.size ?? upload.originalSize;
    const status =
      upload.phase === "waiting"
        ? "Waiting…"
        : upload.phase === "preparing"
          ? upload.mediaType === "picture"
            ? "Preparing picture…"
            : "Checking video…"
          : upload.phase === "uploading"
            ? `Uploading ${percent(upload.progress)}%`
            : upload.phase === "finishing"
              ? "Checking upload…"
              : "Upload stopped";
    return (
      <li className={`rounded-2xl border p-3 ${failed ? "border-red-400/40 bg-red-500/10" : "border-charcoal-700 bg-charcoal-800"}`}>
        <div className="flex items-center gap-3">
          <Thumb mediaType={upload.mediaType} src={upload.previewUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-white">{upload.fileName || "File"}</p>
            <p className="text-sm text-charcoal-300">
              {[
                upload.durationSeconds !== null ? formatDuration(upload.durationSeconds) : null,
                size ? formatBytes(size) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p role="status" className={`mt-0.5 flex items-center gap-1.5 text-sm font-semibold ${failed ? "text-red-200" : "text-gold-300"}`}>
              {!failed && <SpinnerIcon className="h-4 w-4" />}
              {status}
            </p>
          </div>
        </div>
        {upload.phase === "uploading" && (
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-charcoal-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(upload.progress)}
            aria-label="Upload progress"
          >
            <div className="gold-gradient h-full rounded-full transition-[width]" style={{ width: `${percent(upload.progress)}%` }} />
          </div>
        )}
        {failed && upload.error && <p className="mt-2 text-[15px] leading-snug text-red-100">{upload.error}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {failed && upload.file ? (
            <button
              type="button"
              disabled={!editable}
              onClick={() => onRetry(upload)}
              className={`${smallButton} gold-gradient text-charcoal-950`}
            >
              Retry
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={upload.phase === "finishing"}
            onClick={() => onCancel(upload)}
            className={`${smallButton} border border-charcoal-600 bg-charcoal-900 text-white`}
          >
            {failed ? "Remove" : "Cancel"}
          </button>
        </div>
      </li>
    );
  }

  const { media } = row;
  const busy = removing === media.id;
  const details = [
    media.durationSeconds !== null ? formatDuration(media.durationSeconds) : null,
    formatBytes(media.sizeBytes ?? media.declaredSizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");

  if (row.kind === "uploaded") {
    return (
      <li className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-charcoal-800 p-3">
        <a href={`/media/${media.id}`} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Open">
          <Thumb mediaType={media.mediaType} src={media.mediaType === "picture" ? `/media/${media.id}` : null} />
        </a>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-emerald-200">
            <CheckIcon className="h-4 w-4" /> {media.mediaType === "video" ? "Video uploaded" : "Picture uploaded"}
          </p>
          <p className="text-sm text-charcoal-300">{details}</p>
        </div>
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => onRemoveUploaded(media)}
          className={`${smallButton} border border-charcoal-600 bg-charcoal-900 text-white`}
        >
          Remove
        </button>
      </li>
    );
  }

  const text =
    row.kind === "failed"
      ? media.failureReason || "This upload didn’t finish."
      : row.resumable
        ? "Upload paused. Choose the same video to continue."
        : media.mediaType === "picture"
          ? "This picture didn’t finish uploading. Remove it and add it again."
          : "A teammate’s video upload didn’t finish. Remove it to add a new one.";
  const resumeId = `resume-${media.id}`;

  return (
    <li className="rounded-2xl border border-gold-500/40 bg-gold-900/30 p-3">
      <div className="flex items-center gap-3">
        <Thumb mediaType={media.mediaType} src={null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-white">{media.fileName || "File"}</p>
          <p className="text-sm text-charcoal-300">{details}</p>
        </div>
      </div>
      <p className="mt-2 text-[15px] leading-snug text-gold-100">{text}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {row.kind === "interrupted" && row.resumable && editable ? (
          <label
            htmlFor={resumeId}
            className={`${smallButton} gold-gradient cursor-pointer text-charcoal-950`}
          >
            Continue
            <input
              id={resumeId}
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => {
                onResume(media, e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => onDiscard(media)}
          className={`${smallButton} border border-charcoal-600 bg-charcoal-900 text-white`}
        >
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}

function Thumb({ mediaType, src }: { mediaType: "picture" | "video"; src: string | null }) {
  if (src) {
    return (
      // Private, short-lived links; Next's image optimizer isn't used.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" loading="lazy" className="h-16 w-16 rounded-xl bg-charcoal-700 object-cover" />
    );
  }
  const Icon = mediaType === "video" ? VideoIcon : CameraIcon;
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-charcoal-700 text-gold-300">
      <Icon className="h-7 w-7" />
    </span>
  );
}
