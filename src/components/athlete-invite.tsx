import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { Copy, Mail, QrCode } from "lucide-react";
import { publicOrigin } from "@/lib/share-url";
import { useServerFn } from "@tanstack/react-start";
import { requestAthleteAccessLink } from "@/lib/athlete-access.functions";

export function AthleteInvite({
  athleteName,
  joinToken,
  defaultEmail,
  linked,
}: {
  athleteName: string;
  joinToken: string;
  defaultEmail?: string | null;
  linked: boolean;
}) {
  const origin = publicOrigin();
  const joinUrl = `${origin}/athlete-join/${joinToken}`;
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [sending, setSending] = useState(false);

  const requestLink = useServerFn(requestAthleteAccessLink);

  const sendLink = async () => {
    if (!email.trim()) return toast.error("Enter an email first");
    setSending(true);
    try {
      await requestLink({
        data: {
          email: email.trim(),
          joinToken,
          redirectTo: `${origin}/athlete?claim=${joinToken}`,
        },
      });
      toast.success(`Magic link sent to ${email.trim()}`);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <QrCode className="h-4 w-4" /> Athlete access {linked && <span className="ml-2 text-xs font-normal text-emerald-600">● Linked</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={joinUrl} size={140} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-muted-foreground">
              {athleteName} scans this QR to link their phone. They'll enter their email, then tap a magic link to sign in.
            </p>
            <div className="flex items-center gap-2">
              <Input value={joinUrl} readOnly className="text-xs" />
              <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(joinUrl); toast.success("Link copied"); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Or email the magic link directly</Label>
          <div className="flex gap-2">
            <Input type="email" placeholder="athlete@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button onClick={sendLink} disabled={sending}>
              <Mail className="mr-2 h-4 w-4" /> {sending ? "Sending…" : "Send link"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
