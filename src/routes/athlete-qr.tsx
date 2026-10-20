import { createFileRoute, Link } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, KeyRound, Dumbbell, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { publicOrigin } from "@/lib/share-url";

export const Route = createFileRoute("/athlete-qr")({
  head: () => ({
    meta: [
      { title: "Athlete QR — Strength Lab" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AthleteQrPage,
});

function AthleteQrPage() {
  const origin = publicOrigin();
  const [size, setSize] = useState(280);

  const fullUrl = useMemo(() => `${origin}/training-view/check-in`, [origin]);
  const attendanceUrl = useMemo(() => `${origin}/training-view/attendance`, [origin]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Athlete quick-access QR codes</h1>
        <p className="text-sm text-muted-foreground">
          Print or display these on the whiteboard. Athletes scan, enter their
          6-digit PIN, and check in. Use the training code for lifting sessions
          and the attendance code for days you only need presence + bodyweight.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <QrCard
          title="Full training sign-in"
          description="Auto-logs attendance, prompts for bodyweight, then opens today's assigned workout in a restricted Training View."
          icon={<Dumbbell className="h-4 w-4" />}
          badge="Lifting day"
          url={fullUrl}
          size={size}
        />
        <QrCard
          title="Attendance & bodyweight only"
          description="Logs today's attendance and bodyweight, then signs the athlete right back out. No workout view. Ideal for conditioning, meetings, or off-lift days."
          icon={<ClipboardCheck className="h-4 w-4" />}
          badge="Check-in only"
          url={attendanceUrl}
          size={size}
        />
      </div>

      {/* The no-PIN roster check-in QR lives on the Attendance page itself
          (where the coach already is day-of) — no need to duplicate it here. */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-xs">QR size</Label>
            <Button size="sm" variant={size === 220 ? "default" : "outline"} onClick={() => setSize(220)}>S</Button>
            <Button size="sm" variant={size === 280 ? "default" : "outline"} onClick={() => setSize(280)}>M</Button>
            <Button size="sm" variant={size === 380 ? "default" : "outline"} onClick={() => setSize(380)}>L</Button>
          </div>
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground sm:max-w-md">
            <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <KeyRound className="h-3 w-3" /> First-time athletes
            </p>
            Have them sign in once with the email link from their personal
            invite, then set a PIN from their athlete dashboard. After that
            these shared QRs + PIN work forever.
          </div>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            Print page
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 text-sm">
        <Button asChild variant="outline" size="sm">
          <Link to="/rack-console"><Dumbbell className="mr-1 h-4 w-4" /> Open Training View</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/athletes">Personal invite QRs</Link>
        </Button>
      </div>
    </div>
  );
}

function QrCard({
  title,
  description,
  icon,
  badge,
  url,
  size,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge: string;
  url: string;
  size: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            {icon}
            {badge}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-center">
          <div className="rounded-md bg-white p-4 shadow-sm">
            <QRCodeSVG value={url} size={size} level="M" includeMargin={false} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Direct link</Label>
          <div className="flex gap-2">
            <Input value={url} readOnly className="text-xs" />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(url);
                toast.success("Link copied");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
