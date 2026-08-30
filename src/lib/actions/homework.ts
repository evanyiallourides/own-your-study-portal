"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getRepository } from "@/lib/data";
import { toActionError, type ActionResult } from "@/lib/actions/result";

const schema = z.object({
  homeworkId: z.string().min(1),
  completed: z.boolean(),
});

export async function setHomeworkCompleted(input: {
  homeworkId: string;
  completed: boolean;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That request was not valid." };

  try {
    const repo = await getRepository();
    await repo.setHomeworkCompleted(parsed.data.homeworkId, parsed.data.completed);
    revalidatePath("/student/homework");
    revalidatePath("/student");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
