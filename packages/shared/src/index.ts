import { z } from "zod";

export const healthSchema = z.object({
  status: z.literal("ok"),
  // judgineer stop が、状態ファイルの pid と照合して別のプロセスを止めないために返す
  pid: z.number().int(),
  // 発表用デモ (DEMO=1) のときだけ入る。画面が Enter で入れる若手のセリフ
  demo_lines: z.array(z.string()).optional(),
});
export type Health = z.infer<typeof healthSchema>;

export * from "./ai";
