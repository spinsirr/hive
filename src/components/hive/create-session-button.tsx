"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function CreateSessionButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      aria-label={pending ? "Creating task" : "Create task"}
      disabled={pending}
      type="submit"
    >
      {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      {pending ? "Creating…" : "Create task"}
    </Button>
  );
}
