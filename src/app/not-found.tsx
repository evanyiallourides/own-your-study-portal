import { ButtonLink } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-lg">
        <EmptyState
          title="That page does not exist"
          description="The link may be out of date, or the record may have been removed. Your dashboard is the best place to start again."
          action={<ButtonLink href="/" variant="solid">Go to your dashboard</ButtonLink>}
        />
      </div>
    </div>
  );
}
