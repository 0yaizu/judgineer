import { useEffect, useId, useRef, useState } from "react";
import { Button } from "#/components/starwind/button";
import { Label } from "#/components/starwind/label";
import { Textarea } from "#/components/starwind/textarea";
import { MIN_SKIP_REASON } from "#/lib/store";

export function SkipForm({
  openLabel,
  onSkip,
}: {
  openLabel: string;
  onSkip: (reason: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // 開いたら理由の欄に移る（押したボタンは消えるため）
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        {openLabel}
      </Button>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
      <Label htmlFor={id} className="text-sm">
        見送る理由（一言で）
      </Label>
      <Textarea
        ref={ref}
        id={id}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例: テスト用のファイルなので本番には関係ない"
      />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={reason.trim().length < MIN_SKIP_REASON}
          onClick={() => onSkip(reason)}
        >
          見送って運用を続ける
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          やめる
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        見送った結果は、この先の運用でわかります。あとから対応し直すこともできます。
      </p>
    </div>
  );
}
