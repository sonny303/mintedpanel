// The body of a Mission Control section whose milestone has not shipped yet.
// Each section's route file renders this until its milestone replaces the body.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SectionNotReadyProps {
  title: string;
  milestone: number;
  children: string;
}

export function SectionNotReady({ title, milestone, children }: SectionNotReadyProps) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-[15px]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-[13px] text-muted-foreground">
        <p>{children}</p>
        <p>This page arrives with Mission Control milestone {milestone}.</p>
      </CardContent>
    </Card>
  );
}
