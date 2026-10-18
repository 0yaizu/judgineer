import { z } from "zod";

export const healthSchema = z.object({
  status: z.literal("ok"),
  // judgineer stop が、状態ファイルの pid と照合して別のプロセスを止めないために返す
  pid: z.number().int(),
});
export type Health = z.infer<typeof healthSchema>;

export * from "./ai";
