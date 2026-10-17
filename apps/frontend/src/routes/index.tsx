import { createFileRoute } from "@tanstack/react-router";
import { healthSchema } from "@tka/shared";
import { useEffect, useState } from "react";
import { Button } from "#/components/starwind/button";
import { api } from "#/lib/api";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [status, setStatus] = useState("...");

  useEffect(() => {
    api.health
      .$get()
      .then((res) => res.json())
      .then((body) => setStatus(healthSchema.parse(body).status))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main className="mx-auto my-16 w-[min(42rem,calc(100%-2rem))]">
      <h1 className="text-2xl font-bold">tka_2607</h1>
      <p>backend: {status}</p>
      <Button className="mt-4">Starwind Button</Button>
    </main>
  );
}
