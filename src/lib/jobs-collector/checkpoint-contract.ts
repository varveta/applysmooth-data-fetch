import { z } from "zod";
export const ManifestSchema = z
  .object({
    version: z.literal(1),
    generation: z.number().int().positive(),
    rawHash: z.string().regex(/^[a-f0-9]{64}$/),
    rawBytes: z.number().int().positive().max(600_000_000),
    chunks: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().positive().max(16_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;
