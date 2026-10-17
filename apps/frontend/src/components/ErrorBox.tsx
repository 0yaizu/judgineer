import { Alert, AlertDescription } from "#/components/starwind/alert";

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Alert variant="error">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
