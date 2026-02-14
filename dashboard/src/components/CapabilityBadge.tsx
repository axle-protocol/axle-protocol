export default function CapabilityBadge({ capability }: { capability: string }) {
  return (
    <span className="inline-block rounded bg-axle-purple/20 px-2 py-0.5 text-xs font-medium text-axle-purple">
      {capability}
    </span>
  );
}
