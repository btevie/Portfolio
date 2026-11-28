"use client";
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actions, useAppState } from "@/lib/data/store";
import { imageDimensions, imageSizeOk } from "@/lib/image-size";

const MAX_FILE = 8 * 1024 * 1024;

/** Crop to a centred square and shrink, so the saved picture stays small. */
async function toSquare(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 256, m = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, size, size);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.88);
}

export function ProfilePictureDialog({ open, onClose, name }: { open: boolean; onClose: () => void; name?: string }) {
  const user = useAppState().user;
  const file = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = removed
  const [error, setError] = useState("");
  const op = useRef(0); // the current picture operation: a read that finishes after a close, a removal or a newer pick is ignored
  const shown = draft === undefined ? user.picture : draft ?? undefined;
  const changed = draft !== undefined && (draft ?? undefined) !== user.picture;

  function close() { op.current++; setDraft(undefined); setError(""); onClose(); }

  async function pick(f: File | undefined) {
    if (!f) return;
    const mine = ++op.current; // a newer pick invalidates any read still pending, even if this one fails validation below
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setError("Choose a PNG, JPG or WebP image."); return; }
    if (f.size > MAX_FILE) { setError("That image is too large. Choose one under 8 MB."); return; }
    try {
      if (!imageSizeOk(imageDimensions(new Uint8Array(await f.arrayBuffer())))) { if (mine === op.current) setError("That image is too large in pixels. Choose a smaller one."); return; }
      const square = await toSquare(f);
      if (mine === op.current) { setDraft(square); setError(""); }
    } catch { if (mine === op.current) setError("That image could not be read."); }
    if (file.current) file.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto rounded-xl p-6 sm:max-w-xl sm:p-8">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-xl font-semibold sm:text-2xl">Change your profile picture</DialogTitle>
          <DialogDescription className="text-base">It&apos;ll be updated everywhere you use Overbill on this device.</DialogDescription>
        </DialogHeader>

        <div className="my-8 flex flex-col-reverse items-center gap-6 sm:my-10 sm:flex-row sm:justify-between">
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <button type="button" onClick={() => file.current?.click()} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-1 text-left text-base hover:bg-muted"><Upload className="size-5" aria-hidden />Upload picture</button>
            <button type="button" disabled={!shown} onClick={() => { op.current++; setDraft(null); }} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-1 text-left text-base hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"><Trash2 className="size-5" aria-hidden />Remove picture</button>
          </div>
          <Avatar name={name ?? user.name} email={user.email} picture={shown} size={176} className="sm:size-[200px]" />
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload picture file" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        {error && <p role="alert" className="-mt-4 mb-4 text-sm font-medium text-bad">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" className="h-10 min-w-24" onClick={close}>Close</Button>
          <Button variant="primary" className="h-10 min-w-24" disabled={!changed} onClick={() => { actions.updateUser({ picture: draft ?? undefined }); close(); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
