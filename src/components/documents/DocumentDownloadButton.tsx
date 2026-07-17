// E4.5 F4.5.1/F4.5.3 — one-click signed download. Every click requests a
// FRESH short-lived URL from the audited server endpoint (TE-3) and opens it;
// nothing is cached and no permanent URL ever exists client-side.
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocumentDownload } from "@/hooks/useDocuments";

export function DocumentDownloadButton({
  documentId,
  fileName,
}: {
  documentId: string;
  fileName: string;
}) {
  const downloadM = useDocumentDownload();
  const label = `Download ${fileName}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={label}
          disabled={downloadM.isPending}
          onClick={() =>
            downloadM.mutate(documentId, {
              onSuccess: (signed) => {
                window.open(signed.url, "_blank", "noopener");
              },
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Couldn't download the document"),
            })
          }
        >
          <Download className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
