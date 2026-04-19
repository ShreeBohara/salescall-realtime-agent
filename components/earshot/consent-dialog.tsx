import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * First-visit consent gate. Explains the audio data flow (browser →
 * OpenAI via WebRTC, no server-side persistence) and sets a "don't
 * show again" flag on accept. Treated as non-dismissible in spirit —
 * the Start talking button is disabled until this closes.
 */
export function ConsentDialog({
  open,
  onAccept,
}: {
  open: boolean;
  onAccept: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onAccept();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Before we start</DialogTitle>
          <DialogDescription>
            Earshot uses your microphone and sends real-time audio to
            OpenAI&apos;s Realtime API to power the voice conversation.
            Transcripts stay in your browser during the call; nothing is
            persisted server-side.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-1 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <span className="text-primary">·</span>
            <span>
              Audio is sent over WebRTC directly to OpenAI — never routed
              through our server.
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary">·</span>
            <span>
              You can end the call anytime. Calls auto-end after 10 minutes
              to keep costs bounded.
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary">·</span>
            <span>This is a demo app. Don&apos;t share real customer PII.</span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onAccept} className="w-full sm:w-auto">
            I understand — let&apos;s go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
